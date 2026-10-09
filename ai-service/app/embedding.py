"""Embedding：多 Provider（zhipu embedding-3 / qianwen qwen3.7-text-embedding / mock）

维度统一 1024（pgvector 列宽）；换 provider 必须全库重建索引。
批量上限：千问 20/批（实测 32 报 400 InvalidParameter），智谱 32/批。
"""
import hashlib
import random
import time

from openai import OpenAI

from .config import settings
from .db import ensure_embedding_cache, fetch_all, pool, vec_literal

_clients: dict[str, OpenAI] = {}

# 单批调用重试参数（针对限流/网络抖动；指数退避）
_MAX_ATTEMPTS = 4
_BASE_BACKOFF = 1.0


def _get_client() -> OpenAI:
    provider = settings.embedding_provider
    if provider not in _clients:
        if provider == 'qianwen':
            if not settings.qianwen_api_key:
                raise ValueError('QIANWEN_API_KEY 未配置')
            _clients[provider] = OpenAI(
                api_key=settings.qianwen_api_key,
                base_url=settings.qianwen_base_url,
                timeout=60.0,
                max_retries=2,  # SDK 内置重试（网络层），外层再兜批量级失败
            )
        else:  # zhipu
            if not settings.zhipu_api_key:
                raise ValueError('ZHIPU_API_KEY 未配置')
            _clients[provider] = OpenAI(
                api_key=settings.zhipu_api_key,
                base_url=settings.zhipu_base_url,
                timeout=60.0,
                max_retries=2,
            )
    return _clients[provider]


def _create_with_retry(client: OpenAI, batch: list[str]) -> list[list[float]]:
    last_exc: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            resp = client.embeddings.create(
                model=settings.embedding_model,
                input=batch,
                dimensions=settings.embedding_dimensions,
            )
            return [d.embedding for d in resp.data]
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < _MAX_ATTEMPTS - 1:
                backoff = _BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 0.5)
                print(f'[embedding] 第 {attempt + 1} 次调用失败，{backoff:.1f}s 后重试: {exc}')
                time.sleep(backoff)
    # 包装报错信息：文档状态里能看到可操作的提示（额度/欠费类错误高频）
    raise RuntimeError(
        f'嵌入 API 调用失败（已重试 {_MAX_ATTEMPTS} 次）: {last_exc}；'
        '若为欠费/额度不足，请检查对应平台控制台余额或更换 API Key'
    ) from last_exc


def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量向量化（内部按 32/批），返回与输入同序的向量数组"""
    if not texts:
        return []
    if settings.embedding_provider == 'mock':
        return [
            [random.uniform(-0.01, 0.01) for _ in range(settings.embedding_dimensions)]
            for _ in texts
        ]

    client = _get_client()
    out: list[list[float]] = []
    # qwen3.7-text-embedding 批量上限 20（实测 32 报 InvalidParameter），智谱 32
    batch = 20 if settings.embedding_provider == 'qianwen' else 32
    for i in range(0, len(texts), batch):
        out.extend(_create_with_retry(client, texts[i:i + batch]))
    return out


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]


# ===== 内容级嵌入缓存：hash(provider:model:dim:content) → 向量 =====
# 免费额度场景下重解析/重复文本不再重复调 API；换 provider/model/dim 后 hash 全变，天然全量未命中


def _content_hash(text: str) -> str:
    key = (
        f'{settings.embedding_provider}:{settings.embedding_model}:'
        f'{settings.embedding_dimensions}:{text}'
    )
    return hashlib.sha256(key.encode('utf-8')).hexdigest()


def _load_cached(hashes: list[str]) -> dict[str, list[float]]:
    if not hashes:
        return {}
    rows = fetch_all(
        'SELECT hash, embedding FROM embedding_cache WHERE hash = ANY(%s)', (hashes,)
    )
    out: dict[str, list[float]] = {}
    for r in rows:
        raw = r['embedding']
        # 未注册 pgvector 适配器时返回 '[0.1,...]' 字面量字符串；已注册则为 list
        out[r['hash']] = (
            [float(x) for x in str(raw).strip('[]').split(',')]
            if isinstance(raw, str) else [float(x) for x in raw]
        )
    return out


def _save_cached(pairs: list[tuple[str, list[float]]]) -> None:
    if not pairs:
        return
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO embedding_cache (hash, provider, model, dim, embedding)
                   VALUES (%s, %s, %s, %s, %s::vector) ON CONFLICT (hash) DO NOTHING""",
                [
                    (h, settings.embedding_provider, settings.embedding_model,
                     settings.embedding_dimensions, vec_literal(v))
                    for h, v in pairs
                ],
            )


def embed_texts_cached(texts: list[str]) -> list[list[float]]:
    """带内容级缓存的批量向量化（parse 任务用）：命中缓存直接复用向量，
    仅未命中的切片调 API。检索 query 不走缓存（单条且几乎不重复）。"""
    if not texts:
        return []
    if settings.embedding_provider == 'mock':
        return embed_texts(texts)
    ensure_embedding_cache()  # worker 不走 api lifespan：任务内幂等建表
    hashes = [_content_hash(t) for t in texts]
    first_idx: dict[str, int] = {}  # 同批内去重：重复文本只嵌入一次
    for i, h in enumerate(hashes):
        first_idx.setdefault(h, i)
    cached = _load_cached(list(first_idx))
    missing = [h for h in first_idx if h not in cached]
    fresh = (
        dict(zip(missing, embed_texts([texts[first_idx[h]] for h in missing])))
        if missing
        else {}
    )
    _save_cached([(h, fresh[h]) for h in missing])
    print(f'[embedding] 共 {len(texts)} 片：缓存命中 {len(texts) - len(missing)}，API 嵌入 {len(missing)}')
    return [cached[h] if h in cached else fresh[h] for h in hashes]
