"""Celery 任务：文档解析 → 切片 → Embedding → 写 chunks"""
import os
import tempfile

from celery import Celery
from celery.exceptions import SoftTimeLimitExceeded
from celery.signals import worker_process_init
from minio import Minio

from .chunker import chunk_blocks
from .config import settings
from .db import execute, fetch_all, fetch_one, pool, vec_literal
from .embedding import embed_texts_cached
from .ids import gen_id
from .parser import parse_file

celery_app = Celery('ai_service', broker=settings.celery_broker_url)
celery_app.conf.update(
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    imports=('app.tasks',),
    # 任务时长护栏：扫描件 OCR 上限 20 页 × 单页 120s 超时，理论最坏可跑 40+ 分钟，
    # 无限制会堵死并发 2 的 worker 队列。软限制触发可捕获异常走失败标记；
    # 硬限制由 brokerman 强杀兜底。注：soft 限制仅 prefork 池生效（依赖主线程信号）
    task_soft_time_limit=1800,  # 30 分钟
    task_time_limit=2100,       # 35 分钟
    # 对账任务：由 beat 周期调度（worker 启动命令带 -B，beat 内嵌主进程，单实例标准做法）
    beat_schedule={
        'reconcile-stuck-documents': {
            'task': 'app.tasks.reconcile_stuck_documents',
            'schedule': 300.0,  # 5 分钟
        },
    },
)

_minio: Minio | None = None


@worker_process_init.connect
def init_worker_process(**_kwargs):
    """prefork 子进程启动时建嵌入缓存表（DDL 从任务热路径移到启动时，见 db.ensure_embedding_cache）。
    失败不阻塞 worker：首次任务经 embed_texts_cached 惰性兜底。
    注意 solo 池不发该信号——由任务内幂等调用兜底。"""
    from .db import ensure_embedding_cache

    try:
        ensure_embedding_cache()
    except Exception as exc:  # noqa: BLE001
        print(f'[worker_init] 警告：嵌入缓存表初始化失败（任务内惰性兜底）: {exc}')


def get_minio() -> Minio:
    """MinIO 客户端（惰性单例）：worker 进程内复用连接配置。"""
    global _minio
    if _minio is None:
        _minio = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
    return _minio


def fetch_doc_to_temp(storage_key: str) -> str:
    """从 MinIO 拉取原始文档到临时文件。

    S3 响应流不可 seek 而 PyMuPDF 需要随机访问，故先落临时文件再解析；
    调用方负责在解析后删除（配合 try/finally）。临时文件保留原始扩展名，
    便于按类型排查（parse_file 实际按显式 ext 参数分流）。
    """
    ext = storage_key.rsplit('.', 1)[-1]
    fd, tmp_path = tempfile.mkstemp(suffix=f'.{ext}', prefix='kbdoc-')
    os.close(fd)
    try:
        get_minio().fget_object(settings.minio_bucket, storage_key, tmp_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return tmp_path


def set_doc_status(doc_id: str, status: str, progress: int, extra_sql: str = '', params: tuple = ()):
    # updated_at=NOW() 兼作心跳：raw SQL 不触发 Prisma @updatedAt，对账任务据此判断卡死
    execute(
        f'UPDATE documents SET status=%s, progress=%s, error_msg=NULL, updated_at=NOW(){extra_sql} WHERE id=%s',
        (status, progress, *params, doc_id),
    )


@celery_app.task(bind=True, max_retries=3)
def parse_document(self, doc_id: str):
    row = fetch_one(
        """SELECT d.id, d.kb_id, d.storage_key, kb.chunk_size, kb.chunk_overlap
           FROM documents d
           JOIN knowledge_bases kb ON kb.id = d.kb_id
           WHERE d.id = %s""",
        (doc_id,),
    )
    if not row:
        return {'ok': False, 'reason': 'document not found'}

    kb_id: str = row['kb_id']
    storage_key: str = row['storage_key']
    set_doc_status(doc_id, 'parsing', 10)

    try:
        # 1. 解析（输出带标题路径的 blocks；重解析前清掉旧切片）
        # MinIO 拉取到临时文件（S3 流不可 seek），解析后立即清理（try/finally 防残留）
        ext = storage_key.rsplit('.', 1)[-1]
        path = fetch_doc_to_temp(storage_key)
        try:
            blocks = parse_file(path, ext)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        execute('DELETE FROM chunks WHERE doc_id = %s', (doc_id,))
        set_doc_status(doc_id, 'indexing', 40)

        # 2. 切片（heading 作为首行注入切片）
        chunks = chunk_blocks(blocks, row['chunk_size'], row['chunk_overlap'])
        if not chunks:
            raise ValueError('切片结果为空')

        # 3. 批量向量化（内容 hash 缓存：未变更文本不再重复调嵌入 API）
        vectors = embed_texts_cached([c['content'] for c in chunks])

        # 4. 批量写入 chunks（executemany，含向量）
        rows = [
            (
                gen_id('ck'), kb_id, doc_id, i, chunk['page'],
                len(chunk['content']), chunk['content'], vec_literal(vector),
            )
            for i, (chunk, vector) in enumerate(zip(chunks, vectors))
        ]
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO chunks (id, kb_id, doc_id, chunk_index, page, char_count, content, embedding)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)
                       ON CONFLICT (doc_id, chunk_index) DO NOTHING""",
                    rows,
                )
        execute(
            'UPDATE documents SET status=%s, progress=%s, chunk_count=%s, updated_at=NOW() WHERE id=%s',
            ('parsed', 100, len(chunks), doc_id),
        )

        # 5. 知识库计数 + 状态自愈：仅当库内已无任何进行中的文档时才归位 ready，
        #    防止"最后一个任务完成后又被并发的入库/重建请求打回 indexing"的乱序问题
        execute(
            """UPDATE knowledge_bases
               SET chunk_count = (SELECT COUNT(*) FROM chunks WHERE kb_id = %s),
                   status = CASE
                       WHEN EXISTS (
                           SELECT 1 FROM documents
                           WHERE kb_id = %s AND status IN ('pending', 'parsing', 'indexing')
                       ) THEN status
                       ELSE 'ready'
                   END
               WHERE id = %s""",
            (kb_id, kb_id, kb_id),
        )
        return {'ok': True, 'docId': doc_id, 'chunks': len(chunks)}
    except SoftTimeLimitExceeded:
        # 解析超时（>30 分钟）视为确定性失败，不进重试空转——
        # 同一文档重跑大概率仍超时（病态大文档/失控 OCR）；对账任务也不会重复捞它
        execute(
            "UPDATE documents SET status='failed', error_msg='解析超时（超过 30 分钟），已中止', updated_at=NOW() WHERE id=%s",
            (doc_id,),
        )
        raise
    except ValueError as exc:
        # 确定性错误（非法路径、空切片等）：永久失败，不重试
        execute(
            "UPDATE documents SET status='failed', error_msg=%s WHERE id=%s",
            (str(exc)[:500], doc_id),
        )
        raise
    except Exception as exc:  # noqa: BLE001
        # 瞬时错误（网络、限流等）：指数退避重试（Celery 默认最多 3 次）
        execute(
            "UPDATE documents SET status='failed', error_msg=%s WHERE id=%s",
            (str(exc)[:500], doc_id),
        )
        countdown = 60 * (2 ** self.request.retries)
        raise self.retry(exc=exc, countdown=countdown) from exc


# ────────────────────────── 对账：恢复卡死文档 ──────────────────────────
# beat 每 5 分钟调度（worker 启动命令带 -B）：
# - pending 超过 10 分钟：提交链路失败遗留（server 投递时 ai 服务不可用，fire-and-forget 丢弃）
# - parsing/indexing 心跳超过 40 分钟（> task_time_limit 35min + 余量）：worker 崩溃/强杀遗留
# 单批上限 20，防长时间故障恢复后惊群；重投后即使与残留任务并发双跑，
# 唯一索引 chunks_doc_chunk_uniq + ON CONFLICT 保证切片数据不重复
_RECONCILE_PENDING_AFTER = '10 minutes'
_RECONCILE_STUCK_AFTER = '40 minutes'
_RECONCILE_BATCH = 20


@celery_app.task
def reconcile_stuck_documents():
    stale = fetch_all(
        """SELECT id, status FROM documents
           WHERE (status = 'pending' AND updated_at < NOW() - (%s)::interval)
              OR (status IN ('parsing', 'indexing') AND updated_at < NOW() - (%s)::interval)
           LIMIT %s""",
        (_RECONCILE_PENDING_AFTER, _RECONCILE_STUCK_AFTER, _RECONCILE_BATCH),
    )
    if not stale:
        return {'redispatched': 0}
    for row in stale:
        if row['status'] != 'pending':
            execute(
                "UPDATE documents SET status='pending', progress=0, updated_at=NOW() WHERE id=%s",
                (row['id'],),
            )
        parse_document.delay(row['id'])
    print(f'[reconcile] 重新投递 {len(stale)} 个卡死文档: {[r["id"] for r in stale]}')
    return {'redispatched': len(stale)}
