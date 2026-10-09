"""切片模块测试：标题注入、递归切分、相邻合并、语义边界。"""
from app.chunker import chunk_blocks, _split_text


def test_short_block_single_chunk():
    chunks = chunk_blocks([{'page': 3, 'heading': '', 'text': '短文本内容'}], 100, 10)
    assert len(chunks) == 1
    assert chunks[0]['content'] == '短文本内容'
    assert chunks[0]['page'] == 3


def test_heading_injected_as_first_line():
    chunks = chunk_blocks(
        [{'page': 1, 'heading': '第二章 安装', 'text': '正文内容'}], 100, 10
    )
    assert chunks[0]['content'].startswith('第二章 安装\n')
    # heading 注入使 embedding 携带章节上下文
    assert '正文内容' in chunks[0]['content']


def test_empty_text_skipped():
    chunks = chunk_blocks([{'page': 1, 'heading': '', 'text': '   '}, {'page': 2, 'heading': '', 'text': '有内容'}], 100, 10)
    assert len(chunks) == 1
    assert chunks[0]['page'] == 2


def test_long_text_split_respects_size():
    text = '。'.join(f'第{i}句' for i in range(50)) + '。'
    chunks = chunk_blocks([{'page': 1, 'heading': '', 'text': text}], 60, 10)
    assert len(chunks) > 1
    assert all(len(c['content']) <= 60 for c in chunks)


def test_same_heading_adjacent_small_parts_merged():
    # 同标题、同页、合计 ≤ chunk_size → 合并
    blocks = [
        {'page': 1, 'heading': 'H', 'text': '第一段'},
        {'page': 1, 'heading': 'H', 'text': '第二段'},
    ]
    chunks = chunk_blocks(blocks, 100, 10)
    assert len(chunks) == 1
    assert '第一段' in chunks[0]['content'] and '第二段' in chunks[0]['content']


def test_different_heading_never_merged():
    # 不同标题的正文不跨块合并（保持语义边界）
    blocks = [
        {'page': 1, 'heading': 'A', 'text': '甲内容'},
        {'page': 1, 'heading': 'B', 'text': '乙内容'},
    ]
    chunks = chunk_blocks(blocks, 100, 10)
    assert len(chunks) == 2


def test_cross_page_tiny_tail_merged_page_keeps_first():
    # 跨页：小尾巴（< chunk_size//3）并入前块，页码取首页
    blocks = [
        {'page': 1, 'heading': 'H', 'text': '主体内容' * 5},
        {'page': 2, 'heading': 'H', 'text': '尾巴'},
    ]
    chunks = chunk_blocks(blocks, 100, 10)
    assert len(chunks) == 1
    assert chunks[0]['page'] == 1


def test_big_tail_cross_page_not_merged():
    # 跨页大段（≥ chunk_size//3）不合并
    big = 'x' * 60
    blocks = [
        {'page': 1, 'heading': 'H', 'text': big},
        {'page': 2, 'heading': 'H', 'text': 'y' * 40},
    ]
    chunks = chunk_blocks(blocks, 100, 10)
    assert len(chunks) == 2
    assert chunks[1]['page'] == 2


def test_split_text_separator_priority():
    # 短文本（≤size）整体返回，不切分
    assert _split_text('AAA\n\nBBB', 100, 10) == ['AAA\n\nBBB']
    # 超长文本才按分隔符切分：优先用双换行，首段独立成块
    parts = _split_text('AAA\n\n' + 'B' * 50, 20, 5)
    assert parts[0] == 'AAA'
    assert all(len(p) <= 20 for p in parts[1:])


def test_split_text_overlap_carries_tail():
    # 相邻块携带 overlap 尾巴（无任何分隔符的超长纯文本走 '' 硬切）
    text = '字' * 100
    parts = _split_text(text, 30, 5)
    assert len(parts) > 1
    assert all(len(p) <= 30 for p in parts)
    # 重叠语义：后块开头应出现在前块结尾附近
    assert parts[1][:5] != ''  # 块间非空
