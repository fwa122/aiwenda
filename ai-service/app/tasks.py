"""Celery 任务：文档解析 → 切片 → Embedding → 写 chunks"""
import io
import json
import os
import tempfile

from celery import Celery
from celery.exceptions import MaxRetriesExceededError, Retry, SoftTimeLimitExceeded
from celery.signals import worker_process_init
from minio import Minio

from .chunker import chunk_blocks
from .config import settings
from .db import HNSW_INDEX_SQL, execute, fetch_all, fetch_one, pool, vec_literal
from .embedding import embed_texts_cached
from .ids import gen_id
from .parser import caption_image, parse_file

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
        'reconcile-stuck-reembed': {
            'task': 'app.tasks.reconcile_stuck_reembed',
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


# ────────────────────────── 文档内嵌图片抽取入库（v0.9.64 方案B） ──────────────────────────

# 抽图最小尺寸：过滤装饰线/小图标（正文插图一般 ≥120px）
_IMG_MIN_SIZE = 120
_IMG_MAX_PER_DOC = 20  # 单文档图数上限，防病态 PDF 拖垮解析与存储


def _extract_pdf_images(path: str) -> list[tuple[int, bytes]]:
    """PDF 内嵌位图抽取：fitz Pixmap 统一转 PNG（兼容 CMYK/alpha），按尺寸过滤+跨页去重。
    返回 [(page_no_1based, png_bytes)]；失败返回 []（图片抽取不阻断文本解析）。"""
    import fitz

    out: list[tuple[int, bytes]] = []
    seen_xrefs: set[int] = set()
    try:
        with fitz.open(path) as doc:
            for pno, page in enumerate(doc, start=1):
                for info in page.get_images(full=True):
                    xref = info[0]
                    if xref in seen_xrefs:
                        continue
                    seen_xrefs.add(xref)
                    if len(out) >= _IMG_MAX_PER_DOC:
                        return out
                    try:
                        pix = fitz.Pixmap(doc, xref)
                        if pix.colorspace and pix.colorspace.n > 3:  # CMYK 等 → RGB
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        if pix.width < _IMG_MIN_SIZE or pix.height < _IMG_MIN_SIZE:
                            continue
                        out.append((pno, pix.tobytes('png')))
                    except Exception as exc:  # noqa: BLE001 单图失败跳过
                        print(f'[parse] 第{pno}页图片抽取失败（跳过）: {exc}')
    except Exception as exc:  # noqa: BLE001
        print(f'[parse] 图片抽取整体失败（仅文本入索引）: {exc}')
    return out


def _ingest_images(kb_id: str, doc_id: str, images: list[tuple[int, bytes]], start_index: int) -> int:
    """图片 → VLM 图说 → 向量化 → MinIO 原图 + document_images 行 + 图片切片。
    无图说的图不入库（不可检索的原图没有意义）；单图失败跳过不阻断。返回成功数。"""
    client = get_minio()
    ok = 0
    for offset, (page_no, data) in enumerate(images):
        try:
            caption = caption_image(data, page_no)
            if not caption:
                continue
            vector = embed_texts_cached([caption])[0]
            image_id = gen_id('img')
            storage_key = f'{kb_id}/{doc_id}/{image_id}.png'
            client.put_object(
                settings.minio_bucket, storage_key,
                io.BytesIO(data), length=len(data), content_type='image/png',
            )
            execute(
                'INSERT INTO document_images (id, doc_id, kb_id, page, storage_key, caption) '
                'VALUES (%s, %s, %s, %s, %s, %s)',
                (image_id, doc_id, kb_id, page_no, storage_key, caption),
            )
            content = f'【文档插图 · 图说】{caption}'
            execute(
                'INSERT INTO chunks (id, kb_id, doc_id, chunk_index, page, char_count, content, embedding, image_id) '
                'VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector, %s)',
                (gen_id('ck'), kb_id, doc_id, start_index + offset, page_no,
                 len(content), content, vec_literal(vector), image_id),
            )
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f'[parse] 第{page_no}页图片入库失败（跳过）: {exc}')
    return ok


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
            # v0.9.64 方案B：文本解析同场抽取内嵌位图（仅 PDF；失败不影响文本链路）
            raw_images = _extract_pdf_images(path) if ext == 'pdf' else []
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        # 重解析清理顺序：先删切片（图片切片 FK 指向 document_images），再删图片元数据
        execute('DELETE FROM chunks WHERE doc_id = %s', (doc_id,))
        execute('DELETE FROM document_images WHERE doc_id = %s', (doc_id,))
        set_doc_status(doc_id, 'indexing', 40)

        # 2. 切片（heading 作为首行注入切片）
        chunks = chunk_blocks(blocks, row['chunk_size'], row['chunk_overlap'])
        if not chunks and not raw_images:
            raise ValueError('切片结果为空')

        if chunks:
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

        # 4.5 图片入库（v0.9.64）：VLM 图说切片接在文本切片之后，chunk_index 顺延
        image_count = _ingest_images(kb_id, doc_id, raw_images, start_index=len(chunks)) if raw_images else 0

        execute(
            'UPDATE documents SET status=%s, progress=%s, chunk_count=%s, updated_at=NOW() WHERE id=%s',
            ('parsed', 100, len(chunks) + image_count, doc_id),
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
        return {'ok': True, 'docId': doc_id, 'chunks': len(chunks), 'images': image_count}
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


# ────────────────────────── 全库重嵌入 ──────────────────────────
# 场景：更换嵌入渠道（.env 换 provider/model/维度）后，库内旧向量与查询向量处于
# 不同语义空间，必须全库重算。流程：/internal/embedding/state 检测签名变更 →
# 前端确认成本 → /internal/embedding/reembed 按文档派发 reembed_document →
# 全部到账后 finalize（重建 HNSW 索引 + 写回新签名）→ 问答自动恢复。
# 重嵌入期间 phase != 'idle'，server 与 ai-service 双侧拒绝问答/检索（防新旧向量混检）。
# 进度记录在 embedding_state（documents.status 留给解析流转，两套状态互不干扰）。


def _maybe_finalize_reembed() -> None:
    """终态检查：全部文档到账后由唯一赢家收尾。原子 UPDATE 抢占 phase，
    并发双跑到账时只有一个任务能从 running 改成 finalizing，其余直接落空。"""
    winner = fetch_one(
        """UPDATE embedding_state SET phase = 'finalizing', updated_at = NOW()
           WHERE id = 1 AND phase = 'running' AND done_docs + failed_docs >= total_docs
           RETURNING id"""
    )
    if winner:
        finalize_reembed()


def finalize_reembed() -> None:
    """重嵌入收尾（幂等：任务赢家与对账任务都可调用）：
    重建 HNSW 索引（触发时已 DROP，IF NOT EXISTS 防重复）→ 写回新签名。
    有失败文档则停在 partial_failed 等待 admin 重跑（已完成的文档走嵌入缓存，重跑近零成本）。"""
    state = fetch_one('SELECT failed_docs FROM embedding_state WHERE id = 1')
    if not state:
        return
    try:
        execute(HNSW_INDEX_SQL)
    except Exception as exc:  # noqa: BLE001
        # 索引重建失败不阻塞状态恢复：检索层有顺序扫描兜底，下次启动 ensure_indexes 自愈
        print(f'[reembed] 警告：HNSW 索引重建失败（启动时将自愈重试）: {exc}')
    phase = 'idle' if state['failed_docs'] == 0 else 'partial_failed'
    execute(
        """UPDATE embedding_state
           SET provider = %s, model = %s, dims = %s, phase = %s,
               finished_at = NOW(), updated_at = NOW()
           WHERE id = 1""",
        (settings.embedding_provider, settings.embedding_model, settings.embedding_dimensions, phase),
    )
    print(f'[reembed] 收尾完成：phase={phase}, failed_docs={state["failed_docs"]}')


def _mark_reembed_doc_failed(doc_id: str, message: str) -> None:
    """单文档重嵌入终态失败（超时/重试耗尽）：计入失败并检查是否全部到账。"""
    execute(
        """UPDATE embedding_state SET
               failed_docs = failed_docs + 1,
               pending_doc_ids = pending_doc_ids - %s,
               error_msg = %s,
               updated_at = NOW()
           WHERE id = 1""",
        (doc_id, message),
    )
    _maybe_finalize_reembed()


@celery_app.task(bind=True, max_retries=3)
def reembed_document(self, doc_id: str):
    """重嵌入单文档：读库内切片文本 → 嵌入（内容缓存优先，未变更文本零 API 调用）→
    原位更新向量。不碰 documents.status（避免与解析/对账流转互相干扰）。"""
    state = fetch_one('SELECT phase FROM embedding_state WHERE id = 1')
    if not state or state['phase'] != 'running':
        # 非 running（迟到重试/对账重投落在收尾后）直接跳过，其进度已被计入
        return {'ok': False, 'reason': 'reembed not running'}

    chunks = fetch_all('SELECT id, content FROM chunks WHERE doc_id = %s', (doc_id,))
    try:
        if chunks:
            vectors = embed_texts_cached([c['content'] for c in chunks])
            rows = [(vec_literal(v), c['id']) for c, v in zip(chunks, vectors)]
            with pool.connection() as conn:
                with conn.cursor() as cur:
                    cur.executemany('UPDATE chunks SET embedding = %s::vector WHERE id = %s', rows)
        execute(
            """UPDATE embedding_state SET
                   done_docs = done_docs + 1,
                   done_chunks = done_chunks + %s,
                   pending_doc_ids = pending_doc_ids - %s,
                   updated_at = NOW()
               WHERE id = 1""",
            (len(chunks), doc_id),
        )
        _maybe_finalize_reembed()
        return {'ok': True, 'docId': doc_id, 'chunks': len(chunks)}
    except SoftTimeLimitExceeded:
        # 与解析任务同理：超时属确定性失败，重跑大概率仍超时，直接计失败不进重试
        _mark_reembed_doc_failed(doc_id, '重嵌入超时（超过 30 分钟），已中止')
        raise
    except Exception as exc:  # noqa: BLE001
        # 瞬时错误（限流/网络）：指数退避重试；重试耗尽才计失败
        try:
            raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))
        except Retry:
            raise
        except MaxRetriesExceededError:
            _mark_reembed_doc_failed(doc_id, str(exc)[:500])
            raise


# 对账参数：running 无心跳 40 分钟（> 任务时限 35min + 余量）；finalizing 是轻量同步
# 操作，10 分钟未完成即视为 worker 中途崩溃。单批上限 20 防惊群，与文档对账口径一致。
_REEMBED_STUCK_AFTER = '40 minutes'
_REEMBED_FINALIZING_AFTER = '10 minutes'
_REEMBED_REDISPATCH_BATCH = 20


@celery_app.task
def reconcile_stuck_reembed():
    """重嵌入对账自愈：worker 崩溃遗留的 running/finalizing 状态恢复。
    - finalizing 超 10 分钟：幂等重跑收尾（重建索引 + 恢复状态）
    - running 超 40 分钟无心跳且仍有在途文档：按 pending_doc_ids 重投（上限 20）"""
    state = fetch_one('SELECT phase, pending_doc_ids FROM embedding_state WHERE id = 1')
    if not state or state['phase'] == 'idle':
        return {'action': None}

    if state['phase'] == 'finalizing':
        stale = fetch_one(
            'SELECT 1 FROM embedding_state WHERE id = 1 AND updated_at < NOW() - (%s)::interval',
            (_REEMBED_FINALIZING_AFTER,),
        )
        if stale:
            finalize_reembed()
            return {'action': 'finalized'}
        return {'action': None}

    # running：pending 为空说明全部任务在途/已到账（finalize 条件会自然触发），只看心跳
    pending = state['pending_doc_ids'] or []
    if not pending:
        return {'action': None}
    stale = fetch_one(
        'SELECT 1 FROM embedding_state WHERE id = 1 AND updated_at < NOW() - (%s)::interval',
        (_REEMBED_STUCK_AFTER,),
    )
    if not stale:
        return {'action': None}
    batch = [str(d) for d in pending[:_REEMBED_REDISPATCH_BATCH]]
    for doc_id in batch:
        reembed_document.delay(doc_id)
    execute('UPDATE embedding_state SET updated_at = NOW() WHERE id = 1')
    print(f'[reembed] 重投 {len(batch)} 个卡死文档: {batch}')
    return {'action': 'redispatched', 'count': len(batch)}
