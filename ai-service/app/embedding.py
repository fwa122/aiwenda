"""Embedding：多 Provider（zhipu embedding-3 / qianwen qwen3.7-text-embedding / mock）

维度统一 1024（pgvector 列宽）；换 provider 必须全库重建索引。
批量上限：千问 20/批（实测 32 报 400 InvalidParameter），智谱 32/批。
"""
import hashlib
import random
import time

from openai import (
    APITimeoutError,
    APIConnectionError,
    AuthenticationError,
    OpenAI,
    PermissionDeniedError,
    RateLimitError,
)

from .config import settings
from .db import ensure_embedding_cache, execute, fetch_all, pool, vec_literal
from .keystore import resolve_key

# 缓存键 (provider, key)：key 由 keystore 动态解析（DB 覆盖 > .env），换 key 自动建新 client
_clients: dict[tuple[str, str], OpenAI] = {}

# 单批调用重试参数（针对限流/网络抖动；指数退避）
_MAX_ATTEMPTS = 4
_BASE_BACKOFF = 1.0

# 健康记录节流：成功写库最短间隔（批量嵌入一批一次 UPDATE，无需每次都写）
_OK_WRITE_INTERVAL = 30.0
_last_ok_write = 0.0


class EmbeddingError(RuntimeError):
    """嵌入调用失败（已分类）：kind 用于健康记录与前端文案映射。

    - billing/auth：确定性错误（欠费/额度/密钥），零重试立即抛出
    - network/unknown：瞬时错误，按指数退避重试后抛出
    user_message 是面向最终用户的可读文案（经 SSE error 透传，不含内部堆栈）。
    """

    def __init__(self, kind: str, user_message: str, detail: str = ''):
        super().__init__(user_message if not detail else f'{user_message}（{detail}）')
        self.kind = kind
        self.user_message = user_message
        self.detail = detail


_BILLING_MSG = '嵌入渠道余额不足或触发限流，知识库问答暂不可用，请联系管理员'
_AUTH_MSG = '嵌入渠道鉴权失败，请联系管理员'
_NETWORK_MSG = '嵌入服务网络异常，请稍后重试'
_UNKNOWN_MSG = '嵌入渠道调用失败，请稍后重试或联系管理员'


def _classify_error(exc: Exception) -> tuple[str, str]:
    """异常 → (kind, user_message)。分类依据：SDK 异常类型 / HTTP 状态码 / 报错文案关键词。"""
    text = str(exc)
    status = getattr(exc, 'status_code', None) or getattr(exc, 'status', None)
    if isinstance(exc, (RateLimitError,)) or status == 429:
        return 'billing', _BILLING_MSG
    if isinstance(exc, (AuthenticationError, PermissionDeniedError)) or status in (401, 403):
        return 'auth', _AUTH_MSG
    # 欠费/额度类渠道可能用非 429 状态码回包（如智谱 1113 挂 400），按文案兜底识别
    if any(kw in text for kw in ('额度', '欠费', '余额', 'quota', 'insufficient', 'billing')):
        return 'billing', _BILLING_MSG
    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        return 'network', _NETWORK_MSG
    return 'unknown', _UNKNOWN_MSG


def record_health(ok: bool, kind: str | None = None, msg: str | None = None) -> None:
    """嵌入调用成败写入 embedding_state 健康列（供 state 接口与页面预警派生状态）。

    只写健康列不动 updated_at（重嵌入对账以其为心跳，健康写入不得干扰）；
    表不存在等异常一律吞掉——健康记录绝不能反噬主链路。
    """
    global _last_ok_write
    try:
        if ok:
            now = time.time()
            if now - _last_ok_write < _OK_WRITE_INTERVAL:
                return
            _last_ok_write = now
            execute('UPDATE embedding_state SET last_ok_at = NOW() WHERE id = 1')
        else:
            execute(
                """UPDATE embedding_state
                   SET last_error_at = NOW(), last_error_kind = %s, last_error_msg = %s
                   WHERE id = 1""",
                (kind, (msg or '')[:500]),
            )
    except Exception as exc:  # noqa: BLE001
        print(f'[embedding] 健康记录写入失败（忽略）: {exc}')


def _get_client() -> OpenAI:
    provider = settings.embedding_provider
    key = resolve_key(provider)
    cache_key = (provider, key)
    if cache_key not in _clients:
        if provider == 'qianwen':
            if not key:
                raise ValueError('QIANWEN_API_KEY 未配置')
            _clients[cache_key] = OpenAI(
                api_key=key,
                base_url=settings.qianwen_base_url,
                timeout=60.0,
                max_retries=2,  # SDK 内置重试（网络层），外层再兜批量级失败
            )
        else:  # zhipu
            if not key:
                raise ValueError('ZHIPU_API_KEY 未配置')
            _clients[cache_key] = OpenAI(
                api_key=key,
                base_url=settings.zhipu_base_url,
                timeout=60.0,
                max_retries=2,
            )
    return _clients[cache_key]


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
            kind, user_msg = _classify_error(exc)
            if kind in ('billing', 'auth'):
                # 确定性错误（欠费/额度/密钥）：重试无意义，立即失败省 7s+ 盲等
                print(f'[embedding] {kind} 类错误不重试，直接失败: {exc}')
                raise EmbeddingError(kind, user_msg, f'{type(exc).__name__}: {exc}') from exc
            if attempt < _MAX_ATTEMPTS - 1:
                backoff = _BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 0.5)
                print(f'[embedding] 第 {attempt + 1} 次调用失败，{backoff:.1f}s 后重试: {exc}')
                time.sleep(backoff)
    # 包装报错信息：文档状态里能看到可操作的提示（额度/欠费类错误高频）
    kind, user_msg = _classify_error(last_exc)
    raise EmbeddingError(
        kind, user_msg, f'{type(last_exc).__name__}: {last_exc}（已重试 {_MAX_ATTEMPTS} 次）'
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
    try:
        for i in range(0, len(texts), batch):
            out.extend(_create_with_retry(client, texts[i:i + batch]))
    except EmbeddingError as exc:
        record_health(ok=False, kind=exc.kind, msg=exc.user_message)
        raise
    record_health(ok=True)
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
    ensure_embedding_cache()  # 进程内幂等一次：正常路径已在启动时建表，此处是 solo 池/启动失败的惰性兜底
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
