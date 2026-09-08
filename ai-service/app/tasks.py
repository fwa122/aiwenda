"""Celery 任务：文档解析 → 切片 → Embedding → 写 chunks"""
import os

from celery import Celery

from .chunker import chunk_blocks
from .config import settings
from .db import execute, fetch_one, pool, vec_literal
from .embedding import embed_texts
from .ids import gen_id
from .parser import parse_file

celery_app = Celery('ai_service', broker=settings.celery_broker_url)
celery_app.conf.update(
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    imports=('app.tasks',),
)


def set_doc_status(doc_id: str, status: str, progress: int, extra_sql: str = '', params: tuple = ()):
    execute(
        f'UPDATE documents SET status=%s, progress=%s, error_msg=NULL{extra_sql} WHERE id=%s',
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
        # 路径穿越防护：规范化后必须仍位于 upload_root 内
        root = os.path.abspath(settings.upload_root)
        path = os.path.abspath(os.path.join(root, *storage_key.split('/')))
        if not path.startswith(root + os.sep):
            raise ValueError(f'非法的文件路径: {storage_key}')
        ext = storage_key.rsplit('.', 1)[-1]
        blocks = parse_file(path, ext)
        execute('DELETE FROM chunks WHERE doc_id = %s', (doc_id,))
        set_doc_status(doc_id, 'indexing', 40)

        # 2. 切片（heading 作为首行注入切片）
        chunks = chunk_blocks(blocks, row['chunk_size'], row['chunk_overlap'])
        if not chunks:
            raise ValueError('切片结果为空')

        # 3. 批量向量化
        vectors = embed_texts([c['content'] for c in chunks])

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
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)""",
                    rows,
                )
        execute(
            'UPDATE documents SET status=%s, progress=%s, chunk_count=%s WHERE id=%s',
            ('parsed', 100, len(chunks), doc_id),
        )

        # 5. 知识库计数 + 草稿转就绪
        execute(
            """UPDATE knowledge_bases
               SET chunk_count = (SELECT COUNT(*) FROM chunks WHERE kb_id = %s),
                   status = CASE WHEN status IN ('draft', 'indexing') THEN 'ready' ELSE status END
               WHERE id = %s""",
            (kb_id, kb_id),
        )
        return {'ok': True, 'docId': doc_id, 'chunks': len(chunks)}
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
