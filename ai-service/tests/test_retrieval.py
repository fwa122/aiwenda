"""检索模块纯函数测试：词法兜底、精排路由、rerank 失败回退、字段映射。"""
import pytest

from app import retrieval
from app.config import settings


# ===== 词法兜底分 =====

def test_bigrams_lowercased_pairs():
    assert retrieval._bigrams('AB') == {'ab'}
    assert retrieval._bigrams('') == set()
    assert retrieval._bigrams(None) == set()


def test_lexical_score_identical_text_is_one():
    assert retrieval._lexical_score('知识库检索', '知识库检索') == 1.0


def test_lexical_score_disjoint_is_zero():
    assert retrieval._lexical_score('abcd', 'efgh') == 0.0


def test_lexical_score_empty_query_is_zero():
    assert retrieval._lexical_score('', '内容') == 0.0


# ===== 自适应精排路由（v0.9.11 标定阈值）=====

def test_skip_rerank_when_gap_exceeds_threshold():
    monkey_settings = settings
    assert retrieval._skip_rerank(0.90, 0.85) is True  # gap 0.05 ≥ 0.03


def test_no_skip_when_gap_below_threshold():
    assert retrieval._skip_rerank(0.90, 0.88) is False  # gap 0.02 < 0.03


def test_route_disabled_when_gap_zero():
    settings.rerank_skip_gap = 0.0
    try:
        assert retrieval._skip_rerank(1.0, 0.1) is False  # 配置关闭永不跳过
    finally:
        settings.rerank_skip_gap = 0.03


# ===== rerank 精排：失败回退不阻断（v0.9.9 核心保证）=====

def _rows():
    return [
        {'chunk_id': 'c1', 'chunk_index': 0, 'page': 1, 'char_count': 2, 'content': '甲', 'doc_id': 'd1', 'doc_name': 'D', 'doc_type': 'md', 'kb_id': 'k1', 'kb_name': 'K', 'score': 0.9},
        {'chunk_id': 'c2', 'chunk_index': 1, 'page': 2, 'char_count': 2, 'content': '乙', 'doc_id': 'd1', 'doc_name': 'D', 'doc_type': 'md', 'kb_id': 'k1', 'kb_name': 'K', 'score': 0.8},
    ]


def test_rerank_reorders_by_model_results(monkeypatch):
    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {'results': [{'index': 1}, {'index': 0}]}
    class FakeClient:
        def __init__(self, *a, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **kw): return FakeResp()
    monkeypatch.setattr(retrieval.httpx, 'Client', FakeClient)

    rows = _rows()
    out = retrieval._rerank('q', rows)
    assert [r['chunk_id'] for r in out] == ['c2', 'c1']


def test_rerank_failure_falls_back_to_original_order(monkeypatch, capsys):
    class BrokenClient:
        def __init__(self, *a, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **kw): raise RuntimeError('网络错误')
    monkeypatch.setattr(retrieval.httpx, 'Client', BrokenClient)

    rows = _rows()
    out = retrieval._rerank('q', rows)
    assert [r['chunk_id'] for r in out] == ['c1', 'c2']  # 原序回退
    assert 'rerank 失败' in capsys.readouterr().out


def test_rerank_invalid_index_filtered(monkeypatch):
    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {'results': [{'index': 99}, {'index': 0}]}  # 99 越界
    class FakeClient:
        def __init__(self, *a, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **kw): return FakeResp()
    monkeypatch.setattr(retrieval.httpx, 'Client', FakeClient)

    out = retrieval._rerank('q', _rows())
    assert [r['chunk_id'] for r in out] == ['c1']


def test_rerank_skipped_for_single_row():
    rows = _rows()[:1]
    assert retrieval._rerank('q', rows) is rows  # ≤1 条直接原样


# ===== 字段映射 =====

def test_to_ref_maps_camel_case_and_rounds_score():
    ref = retrieval._to_ref(_rows()[0], 0.87654)
    assert ref['chunkId'] == 'c1' and ref['kbName'] == 'K' and ref['docName'] == 'D'
    assert ref['score'] == 0.8765
