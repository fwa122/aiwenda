"""切片：按标题块切分 + 单块内递归字符切分 + 相邻小段合并，保留页码。

入参 blocks: [{page, text, heading}]（parser 输出）。
heading 非空时作为切片首行注入，使 embedding 携带章节上下文，
显著提升"章节标题式问题"的语义可检索性。
"""


def chunk_blocks(blocks: list[dict], chunk_size: int, overlap: int) -> list[dict]:
    """入参 [{page, text, heading}]，出参 [{content, page}]"""
    segments: list[dict] = []
    for block in blocks:
        page = block.get('page', 1)
        heading = (block.get('heading') or '').strip()
        text = (block.get('text') or '').strip()
        if not text:
            continue
        for part in _split_text(text, chunk_size, overlap):
            segments.append({'page': page, 'heading': heading, 'part': part})

    # 相邻小段合并：仅限同标题（不同标题的正文不跨块合并，保持语义边界）；
    # 跨页时只合并小尾巴（len(prev) < chunk_size // 3），页码取首页
    merged: list[dict] = []
    for seg in segments:
        if merged:
            prev = merged[-1]
            if (
                prev['heading'] == seg['heading']
                and len(prev['part']) + len(seg['part']) + 2 <= chunk_size
                and (prev['page'] == seg['page'] or len(prev['part']) < chunk_size // 3)
            ):
                prev['part'] = prev['part'] + '\n\n' + seg['part']
                continue
        merged.append(dict(seg))

    chunks = []
    for seg in merged:
        content = f"{seg['heading']}\n{seg['part']}" if seg['heading'] else seg['part']
        chunks.append({'content': content, 'page': seg['page']})
    return chunks


def _split_text(text: str, size: int, overlap: int) -> list[str]:
    if len(text) <= size:
        return [text]

    separators = ['\n\n', '\n', '。', '；', '，', ' ', '']
    for sep in separators:
        if sep == '' or sep in text:
            parts = [p for p in (text.split(sep) if sep else [text])]
            break

    chunks: list[str] = []
    cur = ''
    for part in parts:
        candidate = f'{cur}{sep}{part}' if cur else part
        if len(candidate) <= size:
            cur = candidate
            continue
        if cur.strip():
            chunks.append(cur)
        tail = cur[-overlap:] if overlap and len(cur) > overlap else ''
        cur = f'{tail}{sep}{part}' if tail else part
        while len(cur) > size:
            chunks.append(cur[:size])
            cur = cur[size - overlap:] if overlap else cur[size:]
    if cur.strip():
        chunks.append(cur)
    return [c.strip() for c in chunks if c.strip()]
