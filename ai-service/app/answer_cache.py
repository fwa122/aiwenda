"""答案语义缓存：同库组合下语义相近的问题直接复用已生成答案（毫秒级、省 LLM 调用）。

- 表结构仿 embedding_cache 惯例：advisory lock 幂等建表 + 维度变更 drop 重建
- 命中判定：kb_hash 等值（kbIds 去重排序后 md5）+ cosine 距离 ≤ 阈值 + 未过期
- 判定复用 /chat 必做的问题嵌入，不增加嵌入成本；未命中时向量透传检索层
- 失效：知识库文档增删/重建索引/重嵌入后由 Node 调 /internal/cache/invalidate
- 所有查询/写入失败一律按未命中/跳过处理：缓存层故障不阻断问答主链路
"""
import hashlib
import re
import uuid

from .config import settings
from .db import _ensure_pool_open, execute, fetch_one, pool, vec_literal

# 进程内幂等标志（同 embedding_cache 惯例：进程生命周期内只执行一次 DDL）
_answer_cache_ensured = False
ANSWER_TTL_DAYS = 7

# advisory lock 键：与 embedding_cache（...001）、embedding_state（...002）并列
_ADVISORY_LOCK_KEY = 860425003


def _answer_cache_ddl() -> str:
    """答案缓存建表 DDL（按当前维度建列；换维度需 drop 后按新维度重建）"""
    return f"""CREATE TABLE IF NOT EXISTS answer_cache (
        id UUID PRIMARY KEY,
        kb_hash TEXT NOT NULL,
        kb_ids JSONB NOT NULL,
        question TEXT NOT NULL,
        question_norm TEXT NOT NULL,
        embedding vector({settings.embedding_dimensions}) NOT NULL,
        answer TEXT NOT NULL,
        refs JSONB NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INT NOT NULL DEFAULT 0,
        completion_tokens INT NOT NULL DEFAULT 0,
        hit_count INT NOT NULL DEFAULT 0,
        last_hit_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
    )"""


# 同库组合内同一问题 upsert 去重 + 向量近邻 HNSW 索引（参数与 chunks 索引一致）
_ANSWER_CACHE_INDEX_SQL = [
    """CREATE UNIQUE INDEX IF NOT EXISTS answer_cache_kbq_uniq
       ON answer_cache (kb_hash, question_norm)""",
    """CREATE INDEX IF NOT EXISTS answer_cache_embedding_hnsw_idx ON answer_cache
       USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)""",
]


def ensure_answer_cache() -> None:
    """答案缓存表幂等创建（进程内一次）：API lifespan 启动时调用，/chat 首次使用惰性兜底。
    事务级 advisory lock 串行化 DDL，防多进程并发 CREATE TABLE 撞 pg_type 唯一约束。"""
    global _answer_cache_ensured
    if _answer_cache_ensured:
        return
    _ensure_pool_open()
    with pool.connection() as conn:
        conn.execute(f'SELECT pg_advisory_xact_lock({_ADVISORY_LOCK_KEY})')
        conn.execute(_answer_cache_ddl())
        for sql in _ANSWER_CACHE_INDEX_SQL:
            conn.execute(sql)
    _answer_cache_ensured = True
    # 过期条目清理：随建表执行一次（7 天 TTL 无需高频清理）
    try:
        execute('DELETE FROM answer_cache WHERE expires_at < NOW()')
    except Exception as exc:  # noqa: BLE001
        print(f'[answer_cache] 过期清理失败（不影响服务）: {exc}')


def drop_for_dimension_change() -> None:
    """嵌入维度变更：删表重建（HNSW/唯一索引随表删除），重置进程内标志，
    下次使用时按新维度重建。全库重嵌入 dim_changed 分支调用。"""
    global _answer_cache_ensured
    _ensure_pool_open()
    with pool.connection() as conn:
        conn.execute(f'SELECT pg_advisory_xact_lock({_ADVISORY_LOCK_KEY})')
        conn.execute('DROP TABLE IF EXISTS answer_cache')
    _answer_cache_ensured = False


def _kb_hash(kb_ids: list[str]) -> str:
    """库组合指纹：去重排序后 md5（顺序无关，等值匹配用）"""
    return hashlib.md5(','.join(sorted(set(kb_ids))).encode('utf-8')).hexdigest()


def _norm_question(question: str) -> str:
    """归一化问题文本：仅用于同问 upsert 去重（唯一索引），语义判定走向量距离"""
    return re.sub(r'\s+', '', question or '').lower()


_LOOKUP_SQL = """
SELECT id, question, answer, refs, model, prompt_tokens, completion_tokens,
       embedding <=> %s::vector AS distance
FROM answer_cache
WHERE kb_hash = %s AND expires_at > NOW()
  AND embedding <=> %s::vector <= %s
ORDER BY embedding <=> %s::vector
LIMIT 1
"""


def lookup(kb_ids: list[str], query_vec: list[float], threshold: float) -> dict | None:
    """同库组合下最近邻命中（cosine 距离 ≤ threshold 且未过期），未命中返回 None。"""
    try:
        ensure_answer_cache()
        row = fetch_one(
            _LOOKUP_SQL,
            (vec_literal(query_vec), _kb_hash(kb_ids), vec_literal(query_vec), threshold,
             vec_literal(query_vec)),
        )
    except Exception as exc:  # noqa: BLE001
        print(f'[answer_cache] 查询失败（按未命中处理）: {exc}')
        return None
    if not row:
        return None
    return {
        'id': str(row['id']),
        'question': row['question'],
        'answer': row['answer'],
        'refs': row['refs'],
        'model': row['model'],
        'promptTokens': row['prompt_tokens'],
        'completionTokens': row['completion_tokens'],
        'distance': float(row['distance']),
    }


def record_hit(cache_id: str) -> None:
    """命中计数（失败不影响问答）"""
    try:
        execute(
            'UPDATE answer_cache SET hit_count = hit_count + 1, last_hit_at = NOW() WHERE id = %s',
            (cache_id,),
        )
    except Exception as exc:  # noqa: BLE001
        print(f'[answer_cache] 命中计数失败（不影响问答）: {exc}')


_STORE_SQL = """
INSERT INTO answer_cache
    (id, kb_hash, kb_ids, question, question_norm, embedding, answer, refs,
     model, prompt_tokens, completion_tokens, expires_at)
VALUES (%s, %s, %s, %s, %s, %s::vector, %s, %s, %s, %s, %s,
        NOW() + (%s || ' days')::interval)
ON CONFLICT (kb_hash, question_norm) DO UPDATE SET
    embedding = EXCLUDED.embedding,
    answer = EXCLUDED.answer,
    refs = EXCLUDED.refs,
    model = EXCLUDED.model,
    prompt_tokens = EXCLUDED.prompt_tokens,
    completion_tokens = EXCLUDED.completion_tokens,
    hit_count = 0,
    last_hit_at = NULL,
    created_at = NOW(),
    expires_at = EXCLUDED.expires_at
"""


def store(
    kb_ids: list[str],
    question: str,
    embedding: list[float],
    answer: str,
    refs: list[dict],
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    ttl_days: int = ANSWER_TTL_DAYS,
) -> None:
    """写入/刷新缓存条目：同库同问 upsert（重置命中计数与 TTL）"""
    ensure_answer_cache()
    execute(
        _STORE_SQL,
        (
            str(uuid.uuid4()), _kb_hash(kb_ids), kb_ids, question, _norm_question(question),
            vec_literal(embedding), answer, refs, model,
            int(prompt_tokens), int(completion_tokens), int(ttl_days),
        ),
    )


def invalidate(kb_ids: list[str] | None = None) -> int:
    """清缓存：指定库（kb_ids 数组相交）或全库（kbIds 为 None/空）。返回删除行数。"""
    ensure_answer_cache()
    if kb_ids:
        return execute('DELETE FROM answer_cache WHERE kb_ids ?| %s', (kb_ids,))
    return execute('DELETE FROM answer_cache')
