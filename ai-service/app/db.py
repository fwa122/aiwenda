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
]


def ensure_indexes() -> None:
    """服务启动时执行；单条失败不阻塞启动（词法路失败时检索层自动降级）"""
    for sql in _INDEX_SQL:
        try:
            execute(sql)
        except Exception as exc:  # noqa: BLE001
            print(f'[ensure_indexes] 警告：索引创建失败（{sql.splitlines()[0][:60]}...）: {exc}')


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
