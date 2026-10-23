"""嵌入渠道健康：状态派生、state 接口 health 区块、主动探测、search 错误转换。"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import embedding
from app.api import internal
from app.config import settings
from app.embedding import EmbeddingError


# ===== _derive_health：down 判定（最近失败晚于最近成功） =====

def test_derive_health_down_when_error_newer():
    ok_at = datetime(2026, 10, 23, 10, 0, tzinfo=timezone.utc)
    err_at = ok_at + timedelta(minutes=5)
    health = internal._derive_health({'last_ok_at': ok_at, 'last_error_at': err_at,
                                      'last_error_kind': 'billing', 'last_error_msg': '余额不足'})
    assert health['status'] == 'down'
    assert health['userMessage'] == '余额不足'


def test_derive_health_ok_when_ok_newer_or_no_error():
    ok_at = datetime(2026, 10, 23, 10, 0, tzinfo=timezone.utc)
    err_at = ok_at - timedelta(minutes=5)
    # 成功晚于失败：已恢复
    health = internal._derive_health({'last_ok_at': ok_at, 'last_error_at': err_at,
                                      'last_error_kind': 'billing', 'last_error_msg': '余额不足'})
    assert health['status'] == 'ok'
    assert health['userMessage'] is None
    # 从未失败
    assert internal._derive_health({'last_ok_at': ok_at, 'last_error_at': None,
                                    'last_error_kind': None, 'last_error_msg': None})['status'] == 'ok'


def test_derive_health_missing_row_or_keys():
    assert internal._derive_health(None)['status'] == 'ok'
    # 老版本行缺健康列：全部 None → ok（不误报）
    assert internal._derive_health({})['status'] == 'ok'


# ===== GET /internal/embedding/state：health 区块 =====

def test_state_includes_health_block(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(internal.settings, 'embedding_provider', 'zhipu')
    monkeypatch.setattr(internal.settings, 'embedding_model', 'embedding-3')
    monkeypatch.setattr(internal.settings, 'embedding_dimensions', 1024)
    err_at = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        internal, 'fetch_one',
        lambda *a, **kw: (
            {'provider': 'zhipu', 'model': 'embedding-3', 'dims': 1024,
             'phase': 'idle', 'last_ok_at': None, 'last_error_at': err_at,
             'last_error_kind': 'billing', 'last_error_msg': '余额不足'}
            if a[0].startswith('SELECT *') else
            {'doc_count': 0, 'chunk_count': 0, 'total_chars': 0}
        ),
    )
    out = internal.embedding_state()
    assert out['health']['status'] == 'down'
    assert out['health']['lastErrorKind'] == 'billing'
    assert out['health']['userMessage'] == '余额不足'


# ===== POST /internal/embedding/probe：主动探测 =====

def test_probe_mock_provider_ok(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'mock')
    out = internal.embedding_probe()
    assert out['ok'] is True
    assert out['checkedAt']


def test_probe_real_failure_returns_ok_false(monkeypatch):
    # 探测失败是「结论」非异常：一律 200，由 ok/userMessage 承载
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    seen: list[tuple] = []
    monkeypatch.setattr(internal, 'record_health', lambda ok, kind=None, msg=None: seen.append((ok, kind)))
    monkeypatch.setattr(
        internal, 'embed_texts',
        lambda texts: (_ for _ in ()).throw(EmbeddingError('billing', '嵌入渠道余额不足')),
    )
    out = internal.embedding_probe()
    assert out['ok'] is False
    assert out['kind'] == 'billing'
    assert out['userMessage'] == '嵌入渠道余额不足'
    assert seen == [(False, 'billing')]


def test_probe_real_success(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(settings, 'embedding_provider', 'zhipu')
    seen: list[bool] = []
    monkeypatch.setattr(internal, 'record_health', lambda ok, kind=None, msg=None: seen.append(ok))
    monkeypatch.setattr(internal, 'embed_texts', lambda texts: [[0.0] * 1024])
    out = internal.embedding_probe()
    assert out['ok'] is True
    assert seen == [True]


# ===== POST /internal/search：嵌入渠道不可用转 503 + 可读 detail =====

def test_search_converts_embedding_error_to_503(monkeypatch):
    monkeypatch.setattr(internal, 'reembed_active', lambda: False)

    def boom(*a, **kw):
        raise EmbeddingError('billing', '嵌入渠道余额不足或触发限流，知识库问答暂不可用，请联系管理员')

    monkeypatch.setattr(internal.retrieval, 'search', boom)
    with pytest.raises(HTTPException) as e:
        internal.search(internal.SearchRequest(kbIds=['kb1'], query='q'))
    assert e.value.status_code == 503
    assert '余额不足' in e.value.detail


def test_record_health_writes_silently_ignores_db_error(monkeypatch):
    # 表不存在等 DB 异常一律吞掉：健康记录绝不能反噬主链路
    def boom(*a, **kw):
        raise RuntimeError('relation "embedding_state" does not exist')

    monkeypatch.setattr(embedding, 'execute', boom)
    embedding.record_health(ok=False, kind='billing', msg='x')  # 不应抛出
    embedding.record_health(ok=True)  # 不应抛出
