"""Embedding：智谱 embedding-3（显式 dimensions=1024）/ mock 两档"""
import random
import time

from openai import OpenAI

from .config import settings

_client: OpenAI | None = None

# 单批调用重试参数（针对限流/网络抖动；指数退避）
_MAX_ATTEMPTS = 4
_BASE_BACKOFF = 1.0


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        if not settings.zhipu_api_key:
            raise ValueError('ZHIPU_API_KEY 未配置')
        _client = OpenAI(
            api_key=settings.zhipu_api_key,
            base_url=settings.zhipu_base_url,
            timeout=60.0,
            max_retries=2,  # SDK 内置重试（网络层），外层再兜批量级失败
        )
    return _client


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
    raise last_exc  # type: ignore[misc]


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
    batch = 32
    for i in range(0, len(texts), batch):
        out.extend(_create_with_retry(client, texts[i:i + batch]))
    return out


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
