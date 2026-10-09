"""内部接口纯函数测试：鉴权、查询改写、相邻合并、上下文预算、SSE、轻量端点回退。"""
import json

import pytest
from fastapi import HTTPException

from app.api import internal
from app.config import settings


# ===== verify_internal（fail-closed 鉴权）=====

def test_verify_internal_503_when_token_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, 'internal_token', '')
    with pytest.raises(HTTPException) as e:
        internal.verify_internal('Bearer whatever')
    assert e.value.status_code == 503


def test_verify_internal_401_without_bearer(monkeypatch):
    monkeypatch.setattr(settings, 'internal_token', 'tok')
    with pytest.raises(HTTPException) as e:
        internal.verify_internal('tok')
    assert e.value.status_code == 401
    assert '缺少' in e.value.detail


def test_verify_internal_401_wrong_token(monkeypatch):
    monkeypatch.setattr(settings, 'internal_token', 'tok')
    with pytest.raises(HTTPException) as e:
        internal.verify_internal('Bearer wrong')
    assert e.value.status_code == 401


def test_verify_internal_passes(monkeypatch):
    monkeypatch.setattr(settings, 'internal_token', 'tok')
    assert internal.verify_internal('Bearer tok') is None


# ===== needs_rewrite：指代信号词 / 短问题才改写 =====

def test_needs_rewrite_short_question():
    assert internal.needs_rewrite('怎么做') is True  # ≤10 字


def test_needs_rewrite_coref_word():
    assert internal.needs_rewrite('它的作者是谁') is True  # 含「它」
    assert internal.needs_rewrite('上述流程的第二步是什么') is True


def test_needs_rewrite_self_contained_skipped():
    assert internal.needs_rewrite('请介绍向量数据库的混合检索原理') is False


# ===== rewrite_query：无历史/自包含跳过，异常回退 =====

def test_rewrite_query_no_history_returns_original(monkeypatch):
    called = []
    monkeypatch.setattr(internal.llm, 'chat_once', lambda *a, **kw: called.append(1) or 'x')
    assert internal.rewrite_query('它的作者', []) == '它的作者'
    assert called == []  # 无历史不调 LLM


def test_rewrite_query_self_contained_skips_llm(monkeypatch):
    called = []
    monkeypatch.setattr(internal.llm, 'chat_once', lambda *a, **kw: called.append(1) or 'x')
    q = '请介绍向量数据库的混合检索原理'
    assert internal.rewrite_query(q, [{'role': 'user', 'content': 'a'}]) == q
    assert called == []  # 自包含问题省一次调用


def test_rewrite_query_uses_llm_and_strips_quotes(monkeypatch):
    from types import SimpleNamespace
    history = [SimpleNamespace(role='user', content='提到张三')]  # HistoryMessage 形状
    monkeypatch.setattr(internal.llm, 'chat_once', lambda *a, **kw: '"它的作者是张三"')
    out = internal.rewrite_query('它的作者', history)
    assert out == '它的作者是张三'


def test_rewrite_query_llm_failure_falls_back(monkeypatch, capsys):
    from types import SimpleNamespace
    def boom(*a, **kw): raise RuntimeError('超时')
    monkeypatch.setattr(internal.llm, 'chat_once', boom)
    q = '它的作者'
    history = [SimpleNamespace(role='user', content='a')]  # 真正走到 LLM 调用再失败
    assert internal.rewrite_query(q, history) == q  # 不阻断


# ===== merge_adjacent：同文档连续 chunk 合并 =====

def _ref(doc, idx, content):
    return {'docId': doc, 'chunkIndex': idx, 'content': content, 'charCount': len(content), 'page': 1, 'kbId': 'k', 'kbName': 'K', 'docName': 'D', 'docType': 'md', 'score': 0.9, 'chunkId': f'{doc}_{idx}'}


def test_merge_adjacent_combines_consecutive_chunks():
    out = internal.merge_adjacent([_ref('d1', 0, 'AAA'), _ref('d1', 1, 'BBB')])
    assert len(out) == 1
    assert out[0]['content'] == 'AAA\nBBB'
    assert out[0]['chunkIndex'] == 1  # 区间终点
    assert out[0]['charCount'] == 7


def test_merge_adjacent_gap_not_merged():
    out = internal.merge_adjacent([_ref('d1', 0, 'AAA'), _ref('d1', 2, 'BBB')])
    assert len(out) == 2


def test_merge_adjacent_cross_doc_not_merged():
    out = internal.merge_adjacent([_ref('d1', 0, 'AAA'), _ref('d2', 1, 'BBB')])
    assert len(out) == 2


def test_merge_adjacent_three_chain():
    out = internal.merge_adjacent([_ref('d1', 0, 'A'), _ref('d1', 1, 'B'), _ref('d1', 2, 'C')])
    assert len(out) == 1
    assert out[0]['content'] == 'A\nB\nC'


# ===== build_context：编号 + 预算截断 =====

def test_build_context_numbered_segments():
    ctx = internal.build_context([_ref('d1', 0, '内容甲'), _ref('d1', 1, '内容乙')])
    assert ctx.startswith('[1] 来源：D 第1页\n内容甲')
    assert '[2] 来源：D 第1页' in ctx
    assert ctx.count('\n\n') == 1


def test_build_context_budget_truncation():
    big = [{'docId': f'd{i}', 'chunkIndex': 0, 'content': 'x' * 3000, 'charCount': 3000, 'page': 1, 'kbId': 'k', 'kbName': 'K', 'docName': f'文档{i}', 'docType': 'md', 'score': 0.9, 'chunkId': f'c{i}'} for i in range(5)]
    ctx = internal.build_context(big)
    assert len(ctx) <= internal.CONTEXT_CHAR_BUDGET + 10  # 截断加省略号
    assert '[1]' in ctx


# ===== SSE 帧 =====

def test_sse_format():
    frame = internal.sse('delta', {'content': '你好'})
    assert frame.startswith('data: ') and frame.endswith('\n\n')
    payload = json.loads(frame[6:])
    assert payload == {'type': 'delta', 'data': {'content': '你好'}}


# ===== 轻量端点：异常一律空回退（前端静默降级）=====

def test_suggestions_empty_input():
    assert internal.chat_suggestions(internal.SuggestionsRequest()) == {'suggestions': []}


def test_suggestions_llm_failure_returns_empty(monkeypatch):
    def boom(*a, **kw): raise RuntimeError('x')
    monkeypatch.setattr(internal.llm, 'chat_once', boom)
    out = internal.chat_suggestions(internal.SuggestionsRequest(question='q', answer='a'))
    assert out == {'suggestions': []}


def test_title_empty_question_returns_empty():
    assert internal.chat_title(internal.TitleRequest(answer='a')) == {'title': ''}


def test_title_llm_failure_returns_empty(monkeypatch):
    def boom(*a, **kw): raise RuntimeError('x')
    monkeypatch.setattr(internal.llm, 'chat_once', boom)
    assert internal.chat_title(internal.TitleRequest(question='q')) == {'title': ''}
