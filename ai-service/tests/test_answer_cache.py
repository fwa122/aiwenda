"""答案语义缓存：kb_hash/归一化纯函数、lookup/store/invalidate 分发、
/chat 缓存链路（命中重放 / 未命中透传向量并写缓存 / 多轮与附件跳过 / 开关关闭）。"""
import json
from types import SimpleNamespace

import pytest

from app import answer_cache
from app.api import internal
from app.config import settings


# ===== 纯函数 =====

def test_kb_hash_order_and_dup_insensitive():
    assert answer_cache._kb_hash(['kb2', 'kb1']) == answer_cache._kb_hash(['kb1', 'kb2'])
    assert answer_cache._kb_hash(['kb1', 'kb1']) == answer_cache._kb_hash(['kb1'])


def test_norm_question_strips_space_and_lower():
    assert answer_cache._norm_question('  怎么 申请 A\n') == '怎么申请a'


def test_ddl_uses_current_dimensions(monkeypatch):
    monkeypatch.setattr(settings, 'embedding_dimensions', 512)
    assert 'vector(512)' in answer_cache._answer_cache_ddl()


# ===== lookup / store / invalidate（DB 层 mock）=====

def test_lookup_maps_row(monkeypatch):
    row = {'id': 'uuid-x', 'question': 'q', 'answer': 'a', 'refs': [{'x': 1}], 'model': 'm',
           'prompt_tokens': 1, 'completion_tokens': 2, 'distance': 0.05}
    monkeypatch.setattr(answer_cache, 'ensure_answer_cache', lambda: None)
    monkeypatch.setattr(answer_cache, 'fetch_one', lambda sql, params=None: row)
    out = answer_cache.lookup(['kb1'], [0.1], 0.12)
    assert out['id'] == 'uuid-x'
    assert out['refs'] == [{'x': 1}]
    assert out['promptTokens'] == 1 and out['completionTokens'] == 2


def test_lookup_db_failure_returns_none(monkeypatch):
    def boom(sql, params=None):
        raise RuntimeError('db down')
    monkeypatch.setattr(answer_cache, 'ensure_answer_cache', lambda: None)
    monkeypatch.setattr(answer_cache, 'fetch_one', boom)
    assert answer_cache.lookup(['kb1'], [0.1], 0.12) is None  # 缓存故障不阻断主链路


def test_store_builds_upsert_with_ttl(monkeypatch):
    captured = {}
    monkeypatch.setattr(answer_cache, 'ensure_answer_cache', lambda: None)

    def fake_execute(sql, params=None):
        captured['sql'], captured['params'] = sql, params
        return 1

    monkeypatch.setattr(answer_cache, 'execute', fake_execute)
    answer_cache.store(['kb1'], '怎么申请', [0.1, 0.2], '答案', [{'x': 1}], 'glm-4-flash', 3, 4, ttl_days=7)
    assert 'ON CONFLICT (kb_hash, question_norm)' in captured['sql']
    p = captured['params']
    assert p[1] == answer_cache._kb_hash(['kb1'])
    assert p[5] == '[0.100000,0.200000]'  # vec_literal
    assert p[11] == 7  # ttl_days


def test_invalidate_dispatch(monkeypatch):
    calls = []
    monkeypatch.setattr(answer_cache, 'ensure_answer_cache', lambda: None)
    monkeypatch.setattr(answer_cache, 'execute', lambda sql, params=None: calls.append((sql, params)) or 3)
    assert answer_cache.invalidate(['kb1', 'kb2']) == 3
    assert '?|' in calls[0][0] and calls[0][1] == (['kb1', 'kb2'],)
    assert answer_cache.invalidate(None) == 3
    assert calls[1][0].strip() == 'DELETE FROM answer_cache'


def test_invalidate_endpoint(monkeypatch):
    monkeypatch.setattr(answer_cache, 'invalidate', lambda kb: 2)
    out = internal.cache_invalidate(internal.CacheInvalidateRequest(kbIds=['kb1']))
    assert out == {'ok': True, 'deleted': 2}


# ===== /chat 缓存链路 =====

def _ref(content='内容'):
    return {'kbId': 'kb1', 'kbName': '测试库', 'docId': 'd1', 'docName': '测试文档',
            'docType': 'md', 'chunkId': 'c1', 'chunkIndex': 0, 'page': 1,
            'charCount': len(content), 'score': 0.9, 'content': content}


def _fake_llm_stream(pieces):
    """llm.stream_chat 返回值形状：choices[].delta.content + usage + close()"""
    chunks = [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=p))], usage=None)
        for p in pieces
    ]

    class _Stream:
        def __iter__(self):
            return iter(chunks)

        def close(self):
            pass

    return _Stream()


def _collect(resp):
    """starlette 新版把同步生成器包成 async iterator（iterate_in_threadpool），两种都兼容"""
    import anyio

    frames: list[str] = []

    async def _drain():
        async for chunk in resp.body_iterator:
            frames.append(chunk)

    if hasattr(resp.body_iterator, '__aiter__'):
        anyio.run(_drain)
        out = frames
    else:
        out = list(resp.body_iterator)
    for chunk in out:
        assert chunk.startswith('data: ')
    return [json.loads(c[6:]) for c in out]


def _patch_base(monkeypatch):
    monkeypatch.setattr(settings, 'internal_token', 'tok')
    monkeypatch.setattr(internal, 'embed_query', lambda text: [0.1, 0.2, 0.3])
    monkeypatch.setattr(internal.retrieval, 'search', lambda *a, **kw: [_ref()])
    monkeypatch.setattr(internal.llm, 'stream_chat', lambda *a, **kw: _fake_llm_stream(['答案甲', '答案乙']))


def test_chat_cache_hit_replays_without_search_or_llm(monkeypatch):
    calls = {'hit': 0, 'search': 0, 'llm': 0, 'store': 0}
    _patch_base(monkeypatch)
    monkeypatch.setattr(internal.retrieval, 'search', lambda *a, **kw: calls.__setitem__('search', calls['search'] + 1) or [])
    monkeypatch.setattr(internal.llm, 'stream_chat', lambda *a, **kw: calls.__setitem__('llm', calls['llm'] + 1) or _fake_llm_stream([]))
    refs = [_ref('命中内容')]
    monkeypatch.setattr(internal.answer_cache, 'lookup', lambda kb, vec, th: {
        'id': 'c1', 'question': 'q', 'answer': '缓存答案第一段，第二段。', 'refs': refs,
        'model': 'glm-4-flash', 'promptTokens': 10, 'completionTokens': 5, 'distance': 0.05,
    })
    monkeypatch.setattr(internal.answer_cache, 'record_hit', lambda cid: calls.__setitem__('hit', calls['hit'] + 1))
    monkeypatch.setattr(internal.answer_cache, 'store', lambda *a, **kw: calls.__setitem__('store', calls['store'] + 1))

    events = _collect(internal.chat(internal.ChatRequest(question='怎么申请', kbIds=['kb1'])))

    assert [e['type'] for e in events] == ['references', 'delta', 'done']
    assert events[0]['data'] == refs
    deltas = ''.join(e['data']['content'] for e in events if e['type'] == 'delta')
    assert deltas == '缓存答案第一段，第二段。'
    meta = events[-1]['data']['meta']
    assert meta['cacheHit'] is True and meta['model'] == 'glm-4-flash'
    assert meta['tokens'] == {'prompt': 10, 'completion': 5}
    assert calls == {'hit': 1, 'search': 0, 'llm': 0, 'store': 0}  # 不走检索/LLM/写缓存


def test_chat_cache_miss_passes_query_vec_and_stores(monkeypatch):
    seen = {'search_kw': None, 'store': None}
    _patch_base(monkeypatch)

    def fake_search(kb, q, k, t, **kw):
        seen['search_kw'] = kw
        return [_ref()]

    def fake_store(**kw):
        seen['store'] = kw

    monkeypatch.setattr(internal.retrieval, 'search', fake_search)
    monkeypatch.setattr(internal.answer_cache, 'lookup', lambda kb, vec, th: None)
    monkeypatch.setattr(internal.answer_cache, 'store', fake_store)

    events = _collect(internal.chat(internal.ChatRequest(
        question='怎么申请', kbIds=['kb1'], forceCitation=False)))

    assert seen['search_kw'].get('query_vec') == [0.1, 0.2, 0.3]  # 复用嵌入，不二次嵌入
    meta = events[-1]['data']['meta']
    assert 'cacheHit' not in meta  # 未命中不标记
    deltas = ''.join(e['data']['content'] for e in events if e['type'] == 'delta')
    assert seen['store'] is not None
    assert seen['store']['answer'] == deltas  # 缓存完整答案（含追加段）
    assert seen['store']['embedding'] == [0.1, 0.2, 0.3]
    assert seen['store']['model'] == 'glm-4-flash'


def test_chat_no_refs_fallback_not_cached(monkeypatch):
    stored = []
    _patch_base(monkeypatch)
    monkeypatch.setattr(internal.retrieval, 'search', lambda *a, **kw: [])
    monkeypatch.setattr(internal.answer_cache, 'lookup', lambda kb, vec, th: None)
    monkeypatch.setattr(internal.answer_cache, 'store', lambda **kw: stored.append(kw))

    events = _collect(internal.chat(internal.ChatRequest(question='怎么申请', kbIds=['kb1'])))

    meta = events[-1]['data']['meta']
    assert meta['model'] == 'fallback'
    assert stored == []  # 兜底回复不写缓存


def test_chat_with_history_skips_cache_and_rewrites(monkeypatch):
    calls = {'lookup': 0, 'embed': 0}
    _patch_base(monkeypatch)

    def fail_embed(text):
        calls['embed'] += 1
        return [0.1]

    monkeypatch.setattr(internal, 'embed_query', fail_embed)
    monkeypatch.setattr(internal.answer_cache, 'lookup', lambda *a: calls.__setitem__('lookup', calls['lookup'] + 1))
    monkeypatch.setattr(internal.llm, 'chat_once', lambda *a, **kw: '申请流程是什么')

    history = [{'role': 'user', 'content': '提到年假'}]
    events = _collect(internal.chat(internal.ChatRequest(question='它怎么申请', kbIds=['kb1'], history=history)))

    assert calls == {'lookup': 0, 'embed': 0}  # 多轮不走缓存（上下文相关）
    search_q = None
    # 改写后的查询传给检索：通过 meta.rewrittenQuery 验证
    meta = events[-1]['data']['meta']
    search_q = meta.get('rewrittenQuery')
    assert search_q == '申请流程是什么'
    assert 'cacheHit' not in meta


def test_chat_use_cache_off_goes_direct(monkeypatch):
    calls = {'embed': 0, 'lookup': 0}
    _patch_base(monkeypatch)

    def fail_embed(text):
        calls['embed'] += 1
        return [0.1]

    monkeypatch.setattr(internal, 'embed_query', fail_embed)
    monkeypatch.setattr(internal.answer_cache, 'lookup', lambda *a: calls.__setitem__('lookup', calls['lookup'] + 1))
    seen = {}
    monkeypatch.setattr(internal.retrieval, 'search', lambda *a, **kw: seen.update(kw) or [_ref()])

    events = _collect(internal.chat(internal.ChatRequest(question='怎么申请', kbIds=['kb1'], useCache=False)))

    assert calls == {'embed': 0, 'lookup': 0}  # 关闭时连预嵌入都不做
    assert seen.get('query_vec') is None
    assert 'cacheHit' not in events[-1]['data']['meta']


def test_chat_attachments_skip_cache(monkeypatch):
    calls = {'lookup': 0}
    _patch_base(monkeypatch)
    monkeypatch.setattr(internal.answer_cache, 'lookup', lambda *a: calls.__setitem__('lookup', calls['lookup'] + 1))

    events = _collect(internal.chat(internal.ChatRequest(
        question='附件里写了什么', kbIds=['kb1'],
        attachments=[internal.Attachment(name='a.txt', text='附件内容')])))

    assert calls['lookup'] == 0  # 附件问答不读缓存（依赖本次上传内容）
    assert 'cacheHit' not in events[-1]['data']['meta']
