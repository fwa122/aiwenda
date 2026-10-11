"""LLM client 缓存测试：key 变更时按 (provider, key) 重建 client，缺 key 报可读错误。"""
import pytest

from app import llm
from app.config import settings


@pytest.fixture(autouse=True)
def _clean_clients():
    """每个用例独立缓存状态"""
    llm._clients.clear()
    yield
    llm._clients.clear()


def test_client_cache_keyed_by_key(monkeypatch):
    """换 key 后不复用旧 client 实例：缓存键 (provider, key)"""
    monkeypatch.setattr(settings, 'zhipu_api_key', 'key-v1')
    monkeypatch.setattr(llm, 'resolve_key', lambda p: 'key-v1')
    c1 = llm._get_client('zhipu')
    assert llm._clients[('zhipu', 'key-v1')] is c1

    monkeypatch.setattr(llm, 'resolve_key', lambda p: 'key-v2')
    c2 = llm._get_client('zhipu')
    assert c2 is not c1
    assert llm._clients[('zhipu', 'key-v2')] is c2


def test_same_key_reuses_client(monkeypatch):
    monkeypatch.setattr(llm, 'resolve_key', lambda p: 'stable-key')
    assert llm._get_client('zhipu') is llm._get_client('zhipu')


def test_missing_key_raises_readable_error(monkeypatch):
    """未配置时抛业务可读错误（safe_error_message 白名单透传给管理员）"""
    monkeypatch.setattr(llm, 'resolve_key', lambda p: '')
    with pytest.raises(ValueError, match='ZHIPU_API_KEY 未配置'):
        llm._get_client('zhipu')
    with pytest.raises(ValueError, match='MOONSHOT_API_KEY 未配置'):
        llm._get_client('moonshot')


def test_cache_eviction_on_key_churn(monkeypatch):
    """反复换 key（配置试错）触发清空重建，client 数量有上界"""
    for i in range(8):
        monkeypatch.setattr(llm, 'resolve_key', lambda p, i=i: f'k{i}')
        llm._get_client('zhipu')
    assert len(llm._clients) <= 7
