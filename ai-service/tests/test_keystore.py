"""keystore 测试：DB 覆盖优先于 .env、DB 异常 fail-soft、TTL 缓存与 invalidate。"""
import json

import pytest

from app import keystore
from app.config import settings


@pytest.fixture(autouse=True)
def _fresh_cache():
    """每个用例独立缓存状态，互不污染"""
    keystore.invalidate()
    yield
    keystore.invalidate()


def test_db_override_wins_over_env(monkeypatch):
    monkeypatch.setattr(settings, 'zhipu_api_key', 'env-key')
    monkeypatch.setattr(
        keystore, 'fetch_one', lambda sql, params=None: {'api_keys': {'zhipu': 'db-key'}}
    )
    assert keystore.resolve_key('zhipu') == 'db-key'


def test_json_string_payload(monkeypatch):
    """兼容 JSONB 未自动解析为 dict 的场景（字符串字面量）"""
    monkeypatch.setattr(settings, 'zhipu_api_key', '')
    monkeypatch.setattr(
        keystore,
        'fetch_one',
        lambda sql, params=None: {'api_keys': json.dumps({'zhipu': 'db-key'})},
    )
    assert keystore.resolve_key('zhipu') == 'db-key'


def test_fallback_to_env_when_db_empty(monkeypatch):
    monkeypatch.setattr(settings, 'zhipu_api_key', 'env-key')
    monkeypatch.setattr(keystore, 'fetch_one', lambda sql, params=None: {'api_keys': None})
    assert keystore.resolve_key('zhipu') == 'env-key'
    assert keystore.resolve_key('qianwen') == ''


def test_db_failure_is_fail_soft(monkeypatch):
    """DB 不可用/表未迁移：回落 .env，不抛异常阻断服务"""

    def boom(sql, params=None):
        raise RuntimeError('db down')

    monkeypatch.setattr(settings, 'zhipu_api_key', 'env-key')
    monkeypatch.setattr(keystore, 'fetch_one', boom)
    assert keystore.resolve_key('zhipu') == 'env-key'
    assert keystore.presence()['zhipu'] == {'configured': True, 'source': 'env'}


def test_invalidate_forces_reread(monkeypatch):
    """TTL 内走缓存；invalidate 后重查 DB（reload 端点路径）"""
    monkeypatch.setattr(settings, 'zhipu_api_key', '')
    rows = [{'api_keys': {'zhipu': 'db-v1'}}]
    monkeypatch.setattr(keystore, 'fetch_one', lambda sql, params=None: rows[0])
    assert keystore.resolve_key('zhipu') == 'db-v1'
    rows[0] = {'api_keys': {'zhipu': 'db-v2'}}
    assert keystore.resolve_key('zhipu') == 'db-v1'  # TTL 内命中缓存
    keystore.invalidate()
    assert keystore.resolve_key('zhipu') == 'db-v2'


def test_presence_source_db_env_none(monkeypatch):
    """在场状态：db（设置页覆盖）> env（.env 默认）> none"""
    monkeypatch.setattr(settings, 'zhipu_api_key', 'env-zhipu')
    monkeypatch.setattr(settings, 'qianwen_api_key', '')
    monkeypatch.setattr(settings, 'moonshot_api_key', '')  # 屏蔽本地 .env 实际配置
    monkeypatch.setattr(settings, 'minimax_api_key', '')
    monkeypatch.setattr(
        keystore, 'fetch_one', lambda sql, params=None: {'api_keys': {'qianwen': 'db-qw'}}
    )
    p = keystore.presence()
    assert p['zhipu'] == {'configured': True, 'source': 'env'}
    assert p['qianwen'] == {'configured': True, 'source': 'db'}
    assert p['moonshot'] == {'configured': False, 'source': 'none'}


def test_minimax_provider_registered(monkeypatch):
    """minimax 渠道走统一 keystore：DB 覆盖 > .env（MINIMAX_API_KEY）"""
    monkeypatch.setattr(settings, 'minimax_api_key', '')
    monkeypatch.setattr(
        keystore, 'fetch_one', lambda sql, params=None: {'api_keys': {'minimax': 'db-mm'}}
    )
    assert keystore.resolve_key('minimax') == 'db-mm'
    assert keystore.presence()['minimax'] == {'configured': True, 'source': 'db'}
