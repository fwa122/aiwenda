"""嵌入模块测试：多 provider 批量上限、指数退避重试、内容缓存键隔离。"""
import types

import pytest

from app import embedding
from app.config import settings


class _FakeResp:
    def __init__(self, texts, dimensions):
        self.data = [
            types.SimpleNamespace(embedding=[0.0] * dimensions) for _ in texts
        ]


class _FakeEmbeddings:
    def __init__(self, fail_times=0, exc_msg='限流', status_code=None):
        self.calls: list[int] = []
        self.fail_times = fail_times
        self.exc_msg = exc_msg
        self.status_code = status_code

    def create(self, model, input, dimensions):
        self.calls.append(len(input))
        if self.fail_times > 0:
            self.fail_times -= 1
            exc = RuntimeError(self.exc_msg)
            if self.status_code is not None:
                exc.status_code = self.status_code
            raise exc
        return _FakeResp(input, dimensions)


class _FakeClient:
    def __init__(self, fail_times=0, exc_msg='限流', status_code=None):
        self.embeddings = _FakeEmbeddings(fail_times, exc_msg, status_code)


def test_batch_size_zhipu_32(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    embedding.embed_texts(['x'] * 70)
    assert client.embeddings.calls == [32, 32, 6]  # 70 = 32+32+6


def test_batch_size_qianwen_20(monkeypatch):
    # 千问批量上限 20（实测 32 报 InvalidParameter）——上限变更会被此用例拦截
    client = _FakeClient()
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'qianwen')
    embedding.embed_texts(['x'] * 70)
    assert client.embeddings.calls == [20, 20, 20, 10]


def test_retry_succeeds_after_transient_failures(monkeypatch):
    client = _FakeClient(fail_times=2)  # 前 2 次失败，第 3 次成功
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)  # 测试不真等退避
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    out = embedding.embed_texts(['hello'])
    assert len(out) == 1
    assert client.embeddings.calls == [1, 1, 1]  # 同一批重试 3 次


def test_retry_exhausted_raises_actionable_error(monkeypatch):
    client = _FakeClient(fail_times=99, exc_msg='随机故障')  # unknown 类：重试耗尽后失败
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(embedding, 'record_health', lambda *a, **kw: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    with pytest.raises(embedding.EmbeddingError, match='嵌入渠道调用失败'):
        embedding.embed_texts(['hello'])
    assert client.embeddings.calls == [1, 1, 1, 1]  # unknown 类保留 4 次退避重试


# ===== 错误分类与零重试（v0.9.42）：欠费/鉴权为确定性失败，重试无意义 =====

def test_billing_error_no_retry(monkeypatch):
    # 欠费/额度文案关键词（智谱 1113 常挂非 429 状态码，靠文案兜底识别）
    client = _FakeClient(fail_times=99, exc_msg='余额不足或无可用资源包,请充值')
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(embedding, 'record_health', lambda *a, **kw: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    with pytest.raises(embedding.EmbeddingError) as e:
        embedding.embed_texts(['hello'])
    assert e.value.kind == 'billing'
    assert '余额不足' in e.value.user_message
    assert client.embeddings.calls == [1]  # 零重试：确定性错误立即失败，省 7s+ 盲等


def test_rate_limit_429_no_retry(monkeypatch):
    client = _FakeClient(fail_times=99, exc_msg='rate limit', status_code=429)
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(embedding, 'record_health', lambda *a, **kw: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    with pytest.raises(embedding.EmbeddingError) as e:
        embedding.embed_texts(['hello'])
    assert e.value.kind == 'billing'
    assert client.embeddings.calls == [1]


def test_auth_error_no_retry(monkeypatch):
    client = _FakeClient(fail_times=99, exc_msg='invalid api key', status_code=401)
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(embedding, 'record_health', lambda *a, **kw: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    with pytest.raises(embedding.EmbeddingError) as e:
        embedding.embed_texts(['hello'])
    assert e.value.kind == 'auth'
    assert client.embeddings.calls == [1]


def test_failure_records_health(monkeypatch):
    seen: list[tuple] = []
    monkeypatch.setattr(embedding, 'record_health', lambda ok, kind=None, msg=None: seen.append((ok, kind)))
    client = _FakeClient(fail_times=99, exc_msg='余额不足')
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    with pytest.raises(embedding.EmbeddingError):
        embedding.embed_texts(['hello'])
    assert seen == [(False, 'billing')]


def test_success_records_health(monkeypatch):
    seen: list[bool] = []
    monkeypatch.setattr(embedding, 'record_health', lambda ok, kind=None, msg=None: seen.append(ok))
    client = _FakeClient()
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    embedding.embed_texts(['hello'])
    assert seen == [True]


def test_classify_error_mapping():
    # 状态码优先：429 → billing、401/403 → auth
    e429 = RuntimeError('x')
    e429.status_code = 429
    e403 = RuntimeError('x')
    e403.status_code = 403
    assert embedding._classify_error(e429)[0] == 'billing'
    assert embedding._classify_error(e403)[0] == 'auth'
    # 文案兜底：欠费关键词（可能挂任意状态码）
    assert embedding._classify_error(RuntimeError('欠费请充值'))[0] == 'billing'
    assert embedding._classify_error(RuntimeError('quota exceeded'))[0] == 'billing'
    # network：SDK 超时/连接异常类型
    import httpx
    from openai import APITimeoutError
    timeout = APITimeoutError(request=httpx.Request('POST', 'https://api.example.com'))
    assert embedding._classify_error(timeout)[0] == 'network'
    # 其余 → unknown
    assert embedding._classify_error(RuntimeError('随机故障'))[0] == 'unknown'


def test_empty_input_returns_empty(monkeypatch):
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    assert embedding.embed_texts([]) == []


def test_content_hash_isolated_by_provider_model_dim(monkeypatch):
    base = {
        'embedding_provider': 'zhipu',
        'embedding_model': 'embedding-3',
        'embedding_dimensions': 1024,
    }
    for k, v in base.items():
        setattr(settings, k, v)
    h1 = embedding._content_hash('同一段文本')
    monkeypatch.setattr(settings, 'embedding_model', 'qwen3.7-text-embedding')
    h2 = embedding._content_hash('同一段文本')
    monkeypatch.setattr(settings, 'embedding_dimensions', 512)
    h3 = embedding._content_hash('同一段文本')
    assert len({h1, h2, h3}) == 3  # 换渠道/模型/维度后 hash 全变 → 天然全量未命中
