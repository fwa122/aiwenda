"""检索：向量召回 + 词法召回双路独立召回，RRF 融合，可选 Rerank 精排。

检索模式：
- 纯向量（默认）：1 - cosine distance 排序 + 阈值过滤。
- 融合（hybrid / rerank 开启）：向量 top-N 与词法 top-N **独立召回**后取并集，
  用 Reciprocal Rank Fusion（RRF, k=60）融合重排。

- Rerank（rerank=true）：RRF 候选再经智谱 rerank 模型精排（query-doc 交叉打分），
  失败时回退 RRF 排名，不阻断检索。score 字段保持原语义（向量分优先），
  rerank 只影响排序。

词法召回基于 pg_trgm 的 word_similarity（短查询对长文本友好，无需分词器），
GIN 索引（chunks_content_trgm_idx，启动时由 db.ensure_indexes 创建）加速过滤。
词法路失败（如扩展不可用）时自动降级为向量候选池内的字符二元组 Jaccard 兜底。
"""
import httpx

from .config import settings
from .db import pool, fetch_all, vec_literal
from .embedding import embed_query

# 向量召回：取候选池（top-N，N 远大于 topK）用于后续融合
VECTOR_SQL = """
SELECT c.id AS chunk_id, c.chunk_index, c.page, c.char_count, c.content,
       d.id AS doc_id, d.name AS doc_name, d.type AS doc_type, d.kb_id,
       kb.name AS kb_name,
       1 - (c.embedding <=> %s::vector) AS score
FROM chunks c
JOIN documents d ON d.id = c.doc_id
JOIN knowledge_bases kb ON kb.id = c.kb_id
WHERE c.kb_id = ANY(%s) AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> %s::vector
LIMIT %s
"""

# 词法召回：独立一路，与向量路取并集
# %%> 即 pg_trgm 的 %> 操作符（psycopg3 中 % 需转义为 %%），走 GIN 索引
LEXICAL_SQL = """
SELECT c.id AS chunk_id, c.chunk_index, c.page, c.char_count, c.content,
       d.id AS doc_id, d.name AS doc_name, d.type AS doc_type, d.kb_id,
       kb.name AS kb_name,
       word_similarity(c.content, %s) AS lex_score
FROM chunks c
JOIN documents d ON d.id = c.doc_id
JOIN knowledge_bases kb ON kb.id = c.kb_id
WHERE c.kb_id = ANY(%s) AND c.content %%> %s
ORDER BY word_similarity(c.content, %s) DESC
LIMIT %s
"""

# RRF 常数
RRF_K = 60
# 词法兜底准入线：融合模式下，向量分低于 threshold 的切片必须达到该词法强度才保留
LEX_MIN = 0.2
# pg_trgm word_similarity 准入阈值（短查询对长文本需放宽，默认 0.6 会几乎全过滤）
WORD_SIM_THRESHOLD = '0.1'


def _bigrams(text: str) -> set:
    text = (text or '').lower()
    return {text[i:i + 2] for i in range(len(text) - 1)}


def _lexical_score(query: str, content: str) -> float:
    """字符二元组 Jaccard，仅作 pg_trgm 不可用时的池内降级兜底。"""
    q, c = _bigrams(query), _bigrams(content)
    if not q or not c:
        return 0.0
    inter = len(q & c)
    union = len(q | c)
    return inter / union if union else 0.0


def _lexical_recall(kb_ids: list[str], query: str, pool_size: int) -> list[dict]:
    """词法独立召回。SET 与 SELECT 必须同连接（阈值仅影响 %> 操作符，
    会话残留对其他查询无副作用）。pg_trgm 不可用时返回 [] 触发降级。"""
    try:
        with pool.connection() as conn:
            conn.execute(f"SET pg_trgm.word_similarity_threshold = '{WORD_SIM_THRESHOLD}'")
            cur = conn.execute(
                LEXICAL_SQL,
                (query, kb_ids, query, query, pool_size),
            )
            return cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        print(f'[retrieval] 词法召回失败，降级为池内词法: {exc}')
        return []


def _rerank(query: str, rows: list[dict]) -> list[dict]:
    """智谱 rerank 精排（query-doc 交叉打分）。失败时返回 RRF 原序，不阻断检索。"""
    if len(rows) <= 1:
        return rows
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                f'{settings.zhipu_base_url}/rerank',
                headers={'Authorization': f'Bearer {settings.zhipu_api_key}'},
                json={
                    'model': settings.rerank_model,
                    'query': query[:4000],
                    'documents': [(r['content'] or '')[:4000] for r in rows],
                },
            )
            resp.raise_for_status()
            results = resp.json().get('results', [])
        ordered: list[dict] = []
        for item in results:
            idx = item.get('index')
            if isinstance(idx, int) and 0 <= idx < len(rows):
                ordered.append(rows[idx])
        return ordered if ordered else rows
    except Exception as exc:  # noqa: BLE001
        print(f'[retrieval] rerank 失败，回退 RRF 排序: {exc}')
        return rows


def _to_ref(row: dict, score: float) -> dict:
    return {
        'chunkId': row['chunk_id'],
        'chunkIndex': row['chunk_index'],
        'kbId': row['kb_id'],
        'kbName': row['kb_name'],
        'docId': row['doc_id'],
        'docName': row['doc_name'],
        'docType': row['doc_type'],
        'page': row['page'],
        'charCount': row['char_count'],
        'score': round(score, 4),
        'content': row['content'],
    }


def search(
    kb_ids: list[str],
    query: str,
    top_k: int = 5,
    threshold: float = 0.28,
    hybrid: bool = False,
    rerank: bool = False,
) -> list[dict]:
    if not kb_ids or not query.strip():
        return []

    vector = embed_query(query)
    vstr = vec_literal(vector)

    # 候选池：两路各取 top-N
    pool_size = max(top_k * 4, 30)
    rows = fetch_all(VECTOR_SQL, (vstr, kb_ids, vstr, pool_size))
    if not rows:
        return []

    use_fusion = bool(hybrid or rerank)

    # 纯向量模式：沿用阈值过滤，行为不变
    if not use_fusion:
        results = []
        for r in rows:
            score = float(r['score'])
            if score < threshold:
                continue
            results.append(_to_ref(r, score))
        return results[:top_k]

    # —— 融合模式：词法独立召回 → 并集 → 双路排名 → RRF ——
    lex_rows = _lexical_recall(kb_ids, query, pool_size)

    if lex_rows:
        # 并集：词法独有命中（向量路未召回）补进候选
        by_id = {r['chunk_id']: dict(r) for r in rows}
        for lr in lex_rows:
            row = by_id.setdefault(lr['chunk_id'], dict(lr))
            row['_lex'] = float(lr['lex_score'])
        merged = list(by_id.values())
    else:
        # 降级：仅在向量候选池内计算词法分
        merged = [dict(r) for r in rows]
        for r in merged:
            r['_lex'] = _lexical_score(query, r['content'] or '')

    vec_rank = {
        r['chunk_id']: i
        for i, r in enumerate(
            sorted((r for r in merged if r.get('score') is not None),
                   key=lambda r: -float(r['score'])),
        )
    }
    lex_rank = {
        r['chunk_id']: i
        for i, r in enumerate(
            sorted((r for r in merged if r.get('_lex') is not None),
                   key=lambda r: -float(r['_lex'])),
        )
    }

    fused = []
    for r in merged:
        vec_score = float(r['score']) if r.get('score') is not None else 0.0
        lex_score = float(r.get('_lex') or 0.0)
        # 淘汰条件：向量分低于阈值 且 词法强度不足（阈值过滤在融合模式下依然有效）
        if vec_score < threshold and lex_score < LEX_MIN:
            continue
        cid = r['chunk_id']
        rrf = 0.0
        if cid in vec_rank:
            rrf += 1.0 / (RRF_K + vec_rank[cid])
        if cid in lex_rank:
            rrf += 1.0 / (RRF_K + lex_rank[cid])
        if rrf <= 0:
            continue
        fused.append((rrf, r))

    fused.sort(key=lambda x: x[0], reverse=True)

    ordered = [r for _, r in fused]
    if rerank:
        # 交叉精排：RRF 候选 → rerank 模型 → 最终排序
        ordered = _rerank(query, ordered)

    # 展示分：优先向量分，词法独有命中回退词法分
    def display_score(r: dict) -> float:
        return float(r['score']) if r.get('score') is not None else float(r.get('_lex') or 0.0)

    return [_to_ref(r, display_score(r)) for r in ordered[:top_k]]
