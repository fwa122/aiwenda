import time

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=5,
    kwargs={'row_factory': dict_row},
    open=True,
)

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
    DDL 按当前维度建列：若 settings.embedding_dimensions 变更，需删表重建并全库重嵌入。"""
    execute(
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
    with pool.connection() as conn:
        cur = conn.execute(sql, params or ())
        return cur.fetchall()


def fetch_one(sql: str, params: tuple | None = None) -> dict | None:
    with pool.connection() as conn:
        cur = conn.execute(sql, params or ())
        return cur.fetchone()


def execute(sql: str, params: tuple | None = None) -> int:
    with pool.connection() as conn:
        cur = conn.execute(sql, params or ())
        return cur.rowcount


def vec_literal(vector: list[float]) -> str:
    """向量 → pgvector 字面量 '[0.1,0.2,...]'，SQL 中以 %s::vector 使用"""
    return '[' + ','.join(f'{x:.6f}' for x in vector) + ']'
