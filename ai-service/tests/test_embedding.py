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
    def __init__(self, fail_times=0):
        self.calls: list[int] = []
        self.fail_times = fail_times

    def create(self, model, input, dimensions):
        self.calls.append(len(input))
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError('限流')
        return _FakeResp(input, dimensions)


class _FakeClient:
    def __init__(self, fail_times=0):
        self.embeddings = _FakeEmbeddings(fail_times)


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
    client = _FakeClient(fail_times=99)  # 永远失败
    monkeypatch.setattr(embedding, '_get_client', lambda: client)
    monkeypatch.setattr(embedding.time, 'sleep', lambda s: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    with pytest.raises(RuntimeError, match='额度'):
        embedding.embed_texts(['hello'])  # 报错信息含可操作提示（余额/额度）


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
