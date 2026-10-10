import time

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# open=False：不在导入时建连。Celery prefork 主进程先 import 再 fork 子进程，
# 若导入时已建连，池内 socket fd 会被多个子进程共享（协议错乱、随机失败）。
# 惰性开池对 API 进程 / prefork 子进程 / solo 进程统一成立：各自首次用库时开池。
pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=5,
    kwargs={'row_factory': dict_row},
    open=False,
    check=ConnectionPool.check_connection,  # 借出前探活：PG 重启后死连接自动丢弃重建
)


def _ensure_pool_open() -> None:
    """惰性开池（幂等）：fork 子进程/启动后首次 DB 访问时各自建立连接。
    wait=False：连接由后台线程异步建立，DB 短暂不可用不阻塞任务进程；
    首次 pool.connection() 自带等待超时，配合 check 探活丢弃死连接。"""
    if pool.closed:
        pool.open(wait=False)

# 索引与扩展统一在此幂等创建（Prisma 迁移不管理向量/trigram 索引，
# 此前 HNSW 索引曾被自动迁移误删，故由检索层所有方在启动时自建）
_INDEX_SQL = [
    # 中文词法召回依赖（trusted extension，库 owner 可装）
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    # 向量余弦 HNSW 索引
    """CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks
       USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)""",
    # 词法召回 GIN 索引：支持 content %> query（word_similarity）快速过滤
    """CREATE INDEX IF NOT EXISTS chunks_content_trgm_idx ON chunks
       USING gin (content gin_trgm_ops)""",
    # 跨会话全局搜索：消息内容 trigram GIN 索引
    """CREATE INDEX IF NOT EXISTS messages_content_trgm_idx ON messages
       USING gin (content gin_trgm_ops)""",
    # 切片唯一约束：解析任务重投后可能与残留任务并发重跑，唯一索引 + ON CONFLICT
    # 让并发双跑退化为无害的插入去重（解析先 DELETE 旧切片，正常路径不受影响）
    """CREATE UNIQUE INDEX IF NOT EXISTS chunks_doc_chunk_uniq ON chunks (doc_id, chunk_index)""",
]


def ensure_indexes() -> None:
    """服务启动时执行；单条失败不阻塞启动（词法路失败时检索层自动降级）"""
    for sql in _INDEX_SQL:
        try:
            execute(sql)
        except Exception as exc:  # noqa: BLE001
            print(f'[ensure_indexes] 警告：索引创建失败（{sql.splitlines()[0][:60]}...）: {exc}')


# 缓存清理节流：ensure_embedding_cache 在每个解析任务都会调用，DELETE 最多 1 小时执行一次
_cache_cleanup_last = 0.0
CACHE_TTL_DAYS = 30


def ensure_embedding_cache() -> None:
    """嵌入缓存表幂等创建（api 启动与 worker 任务内都会调用）。
    DDL 按当前维度建列：若 settings.embedding_dimensions 变更，需删表重建并全库重嵌入。
    事务级 advisory lock 串行化 DDL：prefork 多子进程并发首跑时，并发 CREATE TABLE
    IF NOT EXISTS 会撞 pg_type 目录唯一约束（UniqueViolation）导致任务无谓重试。"""
    with pool.connection() as conn:
        conn.execute('SELECT pg_advisory_xact_lock(860425001)')
        conn.execute(
            f"""CREATE TABLE IF NOT EXISTS embedding_cache (
                hash TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                dim INT NOT NULL,
                embedding vector({settings.embedding_dimensions}) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"""
        )
    # P2 改造：过期缓存定期清理（换 provider/model 后旧 hash 不会再命中，防表无限增长）
    global _cache_cleanup_last
    if time.time() - _cache_cleanup_last > 3600:
        _cache_cleanup_last = time.time()
        try:
            execute(
                f"DELETE FROM embedding_cache "
                f"WHERE created_at < NOW() - INTERVAL '{CACHE_TTL_DAYS} days'"
            )
        except Exception as exc:  # noqa: BLE001
            print(f'[embedding_cache] cleanup failed (non-fatal): {exc}')


def fetch_all(sql: str, params: tuple | None = None) -> list[dict]:
    _ensure_pool_open()
    with pool.connection() as conn:
        cur = conn.execute(sql, params or ())
        return cur.fetchall()


def fetch_one(sql: str, params: tuple | None = None) -> dict | None:
    _ensure_pool_open()
    with pool.connection() as conn:
        cur = conn.execute(sql, params or ())
        return cur.fetchone()


def execute(sql: str, params: tuple | None = None) -> int:
    _ensure_pool_open()
    with pool.connection() as conn:
        cur = conn.execute(sql, params or ())
        return cur.rowcount


def vec_literal(vector: list[float]) -> str:
    """向量 → pgvector 字面量 '[0.1,0.2,...]'，SQL 中以 %s::vector 使用"""
    return '[' + ','.join(f'{x:.6f}' for x in vector) + ']'
