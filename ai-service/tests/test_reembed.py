"""全库重嵌入：状态判定、触发校验、任务推进与收尾的纯函数级测试（DB 交互全 mock）。"""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api import internal
from app import tasks


# ===== reembed_active：禁答判定 =====

def _patch_state_row(monkeypatch, row):
    monkeypatch.setattr(internal, 'fetch_one', lambda *a, **kw: row)


def test_reembed_active_true_when_running(monkeypatch):
    _patch_state_row(monkeypatch, {'phase': 'running'})
    assert internal.reembed_active() is True


def test_reembed_active_true_for_finalizing_and_partial(monkeypatch):
    for phase in ('finalizing', 'partial_failed'):
        _patch_state_row(monkeypatch, {'phase': phase})
        assert internal.reembed_active() is True


def test_reembed_active_false_when_idle_or_missing(monkeypatch):
    _patch_state_row(monkeypatch, {'phase': 'idle'})
    assert internal.reembed_active() is False
    _patch_state_row(monkeypatch, None)
    assert internal.reembed_active() is False


def test_reembed_active_false_on_db_error(monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError('relation does not exist')
    monkeypatch.setattr(internal, 'fetch_one', boom)
    assert internal.reembed_active() is False  # 表缺失不阻塞主链路


# ===== /internal/embedding/state：变更检测 =====

def test_state_reports_mismatch(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(internal.settings, 'embedding_provider', 'qianwen')
    monkeypatch.setattr(internal.settings, 'embedding_model', 'qwen3.7-text-embedding')
    monkeypatch.setattr(internal.settings, 'embedding_dimensions', 1024)
    monkeypatch.setattr(
        internal, 'fetch_one',
        lambda *a, **kw: (
            {'provider': 'zhipu', 'model': 'embedding-3', 'dims': 1024,
             'phase': 'idle', 'total_docs': 0, 'done_docs': 0, 'failed_docs': 0,
             'done_chunks': 0, 'total_chunks': 0, 'pending_doc_ids': [],
             'error_msg': None, 'started_at': None, 'finished_at': None}
            if a[0].startswith('SELECT *') else
            {'doc_count': 2, 'chunk_count': 30, 'total_chars': 40000}
        ),
    )
    out = internal.embedding_state()
    assert out['needsReembed'] is True
    assert out['signature']['provider'] == 'zhipu'
    assert out['config']['provider'] == 'qianwen'
    assert out['preview']['estimatedTokens'] == 20000  # char/2 粗估
    assert out['progress'] is None  # idle 无进度


# ===== POST /internal/embedding/reembed：触发校验 =====

def test_trigger_rejects_when_running(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    _patch_state_row(monkeypatch, {'phase': 'running', 'provider': 'a', 'model': 'b', 'dims': 1})
    with pytest.raises(HTTPException) as e:
        internal.trigger_reembed()
    assert e.value.status_code == 409


def test_trigger_rejects_when_channel_unchanged(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(internal.settings, 'embedding_provider', 'zhipu')
    monkeypatch.setattr(internal.settings, 'embedding_model', 'embedding-3')
    monkeypatch.setattr(internal.settings, 'embedding_dimensions', 1024)
    _patch_state_row(monkeypatch, {'phase': 'idle', 'provider': 'zhipu', 'model': 'embedding-3', 'dims': 1024})
    with pytest.raises(HTTPException) as e:
        internal.trigger_reembed()
    assert e.value.status_code == 400
    assert '未变更' in e.value.detail


def test_trigger_allows_rerun_on_partial_failed(monkeypatch):
    """partial_failed 重跑放行「无变更」拦截：只重试失败文档（已完成走缓存）。"""
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(internal.settings, 'embedding_provider', 'zhipu')
    monkeypatch.setattr(internal.settings, 'embedding_model', 'embedding-3')
    monkeypatch.setattr(internal.settings, 'embedding_dimensions', 1024)
    _patch_state_row(monkeypatch, {'phase': 'partial_failed', 'provider': 'zhipu', 'model': 'embedding-3', 'dims': 1024})
    monkeypatch.setattr(internal, 'fetch_all', lambda *a, **kw: [{'id': 'doc_1', 'cnt': 5}])
    dispatched = []
    monkeypatch.setattr(internal.reembed_document, 'delay', lambda doc_id: dispatched.append(doc_id))
    executed = []
    monkeypatch.setattr(internal, 'execute', lambda sql, params=None: executed.append(sql) or 1)
    out = internal.trigger_reembed()
    assert out == {'ok': True, 'totalDocs': 1, 'totalChunks': 5, 'dimChanged': False}
    assert dispatched == ['doc_1']
    # 无维度变更：不执行清空/改列宽 DDL
    assert not any('ALTER TABLE' in sql for sql in executed)


def test_trigger_rejects_when_no_parsed_docs(monkeypatch):
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    _patch_state_row(monkeypatch, {'phase': 'idle', 'provider': 'a', 'model': 'b', 'dims': 1})
    monkeypatch.setattr(internal, 'fetch_all', lambda *a, **kw: [])
    with pytest.raises(HTTPException) as e:
        internal.trigger_reembed()
    assert e.value.status_code == 400
    assert '没有已解析' in e.value.detail


def test_trigger_dim_change_prepares_schema(monkeypatch):
    """维度变更：清空旧向量 → 改列宽 → 重建缓存表 → 摘除 HNSW。"""
    monkeypatch.setattr(internal, 'ensure_embedding_state', lambda: None)
    monkeypatch.setattr(internal.settings, 'embedding_provider', 'qianwen')
    monkeypatch.setattr(internal.settings, 'embedding_model', 'qwen')
    monkeypatch.setattr(internal.settings, 'embedding_dimensions', 1536)
    _patch_state_row(monkeypatch, {'phase': 'idle', 'provider': 'zhipu', 'model': 'embedding-3', 'dims': 1024})
    monkeypatch.setattr(internal, 'fetch_all', lambda *a, **kw: [{'id': 'doc_1', 'cnt': 2}])
    monkeypatch.setattr(internal.reembed_document, 'delay', lambda doc_id: None)

    conn = MagicMock()
    ctx = MagicMock()
    ctx.__enter__.return_value = conn
    ctx.__exit__.return_value = False
    monkeypatch.setattr(internal.pool, 'connection', lambda: ctx)

    executed = []
    monkeypatch.setattr(internal, 'execute', lambda sql, params=None: executed.append(sql) or 1)
    internal.trigger_reembed()
    joined = '\n'.join(executed)
    assert 'UPDATE chunks SET embedding = NULL' in joined
    assert 'ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1536)' in joined
    assert 'DROP INDEX IF EXISTS chunks_embedding_hnsw_idx' in joined
    # 缓存表重建走 pool 连接（advisory lock 同锁）：DROP + 按新维度 CREATE
    conn_sql = '\n'.join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert 'DROP TABLE IF EXISTS embedding_cache' in conn_sql
    assert 'CREATE TABLE IF NOT EXISTS embedding_cache' in conn_sql
    assert 'vector(1536)' in conn_sql


# ===== reembed_document：任务推进 =====

def test_reembed_document_skips_when_not_running(monkeypatch):
    monkeypatch.setattr(tasks, 'fetch_one', lambda *a, **kw: {'phase': 'idle'})
    out = tasks.reembed_document('doc_1')
    assert out == {'ok': False, 'reason': 'reembed not running'}


def test_reembed_document_empty_chunks_counts_done(monkeypatch):
    monkeypatch.setattr(tasks, 'fetch_one', lambda *a, **kw: {'phase': 'running'})
    monkeypatch.setattr(tasks, 'fetch_all', lambda *a, **kw: [])
    executed = []
    monkeypatch.setattr(tasks, 'execute', lambda sql, params=None: executed.append((sql, params)) or 1)
    finalized = []
    monkeypatch.setattr(tasks, '_maybe_finalize_reembed', lambda: finalized.append(1))
    out = tasks.reembed_document('doc_1')
    assert out == {'ok': True, 'docId': 'doc_1', 'chunks': 0}
    # done_docs +1，pending 移除本 doc
    progress_sql, progress_params = executed[0]
    assert 'done_docs = done_docs + 1' in progress_sql
    assert progress_params == (0, 'doc_1')
    assert finalized == [1]


def test_reembed_document_updates_chunk_vectors(monkeypatch):
    monkeypatch.setattr(tasks, 'fetch_one', lambda *a, **kw: {'phase': 'running'})
    monkeypatch.setattr(
        tasks, 'fetch_all',
        lambda *a, **kw: [{'id': 'ck_1', 'content': '甲'}, {'id': 'ck_2', 'content': '乙'}],
    )
    monkeypatch.setattr(tasks, 'embed_texts_cached', lambda texts: [[0.1, 0.2], [0.3, 0.4]])
    fake_cur = MagicMock()
    fake_conn = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur
    fake_conn.__enter__.return_value = fake_conn
    fake_pool = MagicMock()
    fake_pool.connection.return_value.__enter__.return_value = fake_conn
    monkeypatch.setattr(tasks, 'pool', fake_pool)
    monkeypatch.setattr(tasks, 'execute', lambda *a, **kw: 1)
    monkeypatch.setattr(tasks, '_maybe_finalize_reembed', lambda: None)
    out = tasks.reembed_document('doc_1')
    assert out == {'ok': True, 'docId': 'doc_1', 'chunks': 2}
    rows = fake_cur.executemany.call_args[0][1]
    assert rows == [('[0.100000,0.200000]', 'ck_1'), ('[0.300000,0.400000]', 'ck_2')]


def test_reembed_document_timeout_marks_failed(monkeypatch):
    monkeypatch.setattr(tasks, 'fetch_one', lambda *a, **kw: {'phase': 'running'})
    monkeypatch.setattr(tasks, 'fetch_all', lambda *a, **kw: [{'id': 'ck_1', 'content': 'x'}])

    def raise_timeout(texts):
        raise tasks.SoftTimeLimitExceeded()
    monkeypatch.setattr(tasks, 'embed_texts_cached', raise_timeout)
    marked = []
    monkeypatch.setattr(tasks, '_mark_reembed_doc_failed', lambda doc_id, msg: marked.append((doc_id, msg)))
    with pytest.raises(tasks.SoftTimeLimitExceeded):
        tasks.reembed_document('doc_1')
    assert marked == [('doc_1', '重嵌入超时（超过 30 分钟），已中止')]


# ===== 终态与收尾 =====

def test_maybe_finalize_only_when_all_done(monkeypatch):
    calls = {'finalized': 0}

    def fetch_one(sql, params=None):
        # 赢家查询带 RETURNING：首次命中（phase running → finalizing），此后不命中
        if 'RETURNING' in sql:
            return {'id': 1} if calls['finalized'] == 0 else None
        return None

    monkeypatch.setattr(tasks, 'fetch_one', fetch_one)
    monkeypatch.setattr(tasks, 'finalize_reembed', lambda: calls.__setitem__('finalized', calls['finalized'] + 1))
    tasks._maybe_finalize_reembed()
    assert calls['finalized'] == 1
    tasks._maybe_finalize_reembed()  # 第二次无赢家（phase 已变），不再收尾
    assert calls['finalized'] == 1


def test_finalize_writes_signature_and_idle(monkeypatch):
    monkeypatch.setattr(tasks, 'fetch_one', lambda *a, **kw: {'failed_docs': 0})
    executed = []
    monkeypatch.setattr(tasks, 'execute', lambda sql, params=None: executed.append((sql, params)) or 1)
    tasks.finalize_reembed()
    final_sql, final_params = executed[-1]
    assert 'phase = %s' in final_sql
    assert final_params[-1] == 'idle'
    assert final_params[0] == tasks.settings.embedding_provider


def test_finalize_partial_failed_keeps_disabled(monkeypatch):
    monkeypatch.setattr(tasks, 'fetch_one', lambda *a, **kw: {'failed_docs': 2})
    executed = []
    monkeypatch.setattr(tasks, 'execute', lambda sql, params=None: executed.append((sql, params)) or 1)
    tasks.finalize_reembed()
    assert executed[-1][1][-1] == 'partial_failed'


def test_mark_failed_increments_and_checks_final(monkeypatch):
    executed = []
    monkeypatch.setattr(tasks, 'execute', lambda sql, params=None: executed.append((sql, params)) or 1)
    checked = []
    monkeypatch.setattr(tasks, '_maybe_finalize_reembed', lambda: checked.append(1))
    tasks._mark_reembed_doc_failed('doc_9', '嵌入 API 调用失败')
    sql, params = executed[0]
    assert 'failed_docs = failed_docs + 1' in sql
    assert params == ('doc_9', '嵌入 API 调用失败')
    assert checked == [1]
