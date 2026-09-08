"""文档解析：统一输出 blocks [{page, text, heading}]，heading 为标题路径。

- PDF：字号启发式 + 常见标题模式识别，按标题分块（保留页码）；
  线框表格转 Markdown 文本；无文本层页（扫描件）走智谱 glm-ocr 兜底
- docx：按 Heading 样式层级维护标题栈；表格按 body 顺序转 Markdown 融合进正文
- Markdown：按 # 层级维护标题栈（代码块内不误判）
- txt/csv：无标题，整文件单块
"""
import re

import httpx

from .config import settings

_HEADING_PATTERN = re.compile(r'^(第[一二三四五六七八九十百\d]+[章节条款部分篇]|[（(]?\d+(?:\.\d+)*[)）]?[\s、.．]|[一二三四五六七八九十]+[、.．])')


def parse_file(path: str, ext: str) -> list[dict]:
    ext = (ext or '').lower().lstrip('.')
    if ext == 'pdf':
        return _parse_pdf(path)
    if ext == 'docx':
        return _parse_docx(path)
    if ext == 'md':
        return _parse_markdown(path)
    if ext in ('txt', 'csv'):
        return _parse_text(path)
    raise ValueError(f'暂不支持的文档格式: {ext}（支持 pdf/docx/txt/md/csv）')


def _read_text(path: str) -> str:
    raw = open(path, 'rb').read()
    for enc in ('utf-8', 'gb18030'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError('无法识别文件编码')


def _table_to_markdown(rows: list[list[str]]) -> str:
    """二维表格 → Markdown 文本（表头 + 分隔行），便于切片与检索。"""
    cleaned = [[(c or '').replace('\n', ' ').strip() for c in row] for row in rows]
    cleaned = [r for r in cleaned if any(r)]
    if not cleaned:
        return ''
    width = max(len(r) for r in cleaned)
    cleaned = [r + [''] * (width - len(r)) for r in cleaned]
    lines = [
        '| ' + ' | '.join(cleaned[0]) + ' |',
        '| ' + ' | '.join(['---'] * width) + ' |',
    ]
    lines += ['| ' + ' | '.join(r) + ' |' for r in cleaned[1:]]
    return '\n'.join(lines)


# ============================== PDF ==============================

def _parse_pdf(path: str) -> list[dict]:
    import fitz  # PyMuPDF
    from collections import Counter

    blocks: list[dict] = []
    empty_pages: list[tuple[int, object]] = []  # 无文本层页（可能是扫描件）

    with fitz.open(path) as doc:
        for pno, page in enumerate(doc, start=1):
            data = page.get_text('dict')
            lines: list[tuple[str, float]] = []
            for blk in data.get('blocks', []):
                if blk.get('type') != 0:  # 跳过图片块
                    continue
                for line in blk.get('lines', []):
                    spans = line.get('spans', [])
                    text = ''.join(s.get('text', '') for s in spans).strip()
                    if not text:
                        continue
                    size = max((s.get('size', 0.0) for s in spans), default=0.0)
                    lines.append((text, size))
            if not lines:
                empty_pages.append((pno, page))
                continue

            # 正文字号 = 出现频次最高的字号
            body_size = Counter(round(s, 1) for _, s in lines).most_common(1)[0][0]

            sections: list[tuple[str, list[str]]] = [('', [])]  # [(heading, 行列表)]
            for text, size in lines:
                if _is_pdf_heading(text, size, body_size):
                    sections.append((text, []))
                else:
                    sections[-1][1].append(text)

            for heading, seg_lines in sections:
                joined = '\n'.join(seg_lines).strip()
                if joined:
                    blocks.append({'page': pno, 'text': joined, 'heading': heading})

            # 线框表格 → Markdown（追加在该页文本块之后）
            for tb in _pdf_tables(page):
                md = _table_to_markdown(tb)
                if md:
                    blocks.append({'page': pno, 'text': md, 'heading': ''})

        # 扫描件兜底：无文本层页走 OCR
        if empty_pages:
            blocks.extend(_ocr_pdf_pages(empty_pages))

    if not blocks:
        raise ValueError('PDF 无可提取文本（可能为扫描件；若已开启 OCR 请查看服务日志）')
    return blocks


def _pdf_tables(page) -> list[list[list[str]]]:
    try:
        tables = page.find_tables()
        return [t.extract() for t in tables]
    except Exception:  # noqa: BLE001  表格识别失败不影响正文
        return []


def _is_pdf_heading(text: str, size: float, body_size: float) -> bool:
    t = text.strip()
    if len(t) > 40:
        return False
    if t.replace('.', '').replace(' ', '').isdigit():  # 排除页码/纯数字
        return False
    # 显著大于正文字号的短行
    if body_size and size >= body_size * 1.15:
        return True
    # 字号判断兜底：常见中文标题模式（第一章 / 1.2 / 一、）
    if bool(_HEADING_PATTERN.match(t)):
        return True
    return False


def _ocr_pdf_pages(pages: list[tuple[int, object]]) -> list[dict]:
    """扫描件兜底：整页渲染为 PNG → 智谱 glm-ocr → Markdown 文本。"""
    if not settings.ocr_enabled:
        print(f'[parser] {len(pages)} 页无文本层且 OCR 未启用（OCR_ENABLED=false），跳过')
        return []
    if len(pages) > settings.ocr_max_pages:
        raise ValueError(
            f'扫描页数 {len(pages)} 超过 OCR 上限 {settings.ocr_max_pages}，'
            '请调大 OCR_MAX_PAGES 或拆分文档'
        )
    print(f'[parser] 检测到 {len(pages)} 页无文本层，启动 OCR...')
    blocks: list[dict] = []
    for pno, page in pages:
        text = _ocr_page_image(page)
        if text:
            blocks.append({'page': pno, 'text': text, 'heading': ''})
    return blocks


def _ocr_page_image(page) -> str:
    import base64

    pix = page.get_pixmap(dpi=150)  # 150dpi 足够 OCR，控制体积
    b64 = base64.b64encode(pix.tobytes('png')).decode()
    try:
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                f'{settings.zhipu_base_url}/layout_parsing',
                headers={'Authorization': f'Bearer {settings.zhipu_api_key}'},
                json={'model': 'glm-ocr', 'file': f'data:image/png;base64,{b64}'},
            )
            resp.raise_for_status()
            md = resp.json().get('md_results') or ''
    except Exception as exc:  # noqa: BLE001  单页失败不阻断整档
        print(f'[parser] OCR 第 {page.number + 1} 页失败: {exc}')
        return ''
    return md.strip()


# ============================== docx ==============================

def _parse_docx(path: str) -> list[dict]:
    from docx import Document as DocxDocument
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = DocxDocument(path)
    stack: dict[int, str] = {}
    blocks: list[dict] = []
    cur_text: list[str] = []
    cur_heading = ''

    def flush():
        text = '\n'.join(cur_text).strip()
        if text:
            blocks.append({'page': 1, 'text': text, 'heading': cur_heading})

    def body_items(parent):
        """按文档真实顺序遍历段落与表格（doc.paragraphs 会漏表格）。"""
        for child in parent.element.body.iterchildren():
            if child.tag == qn('w:p'):
                yield Paragraph(child, parent)
            elif child.tag == qn('w:tbl'):
                yield Table(child, parent)

    for item in body_items(doc):
        if isinstance(item, Table):
            md = _table_to_markdown([[c.text for c in row.cells] for row in item.rows])
            if md:
                cur_text.append(md)
            continue
        t = item.text.strip()
        if not t:
            continue
        level = _docx_heading_level(item)
        if level:
            flush()
            cur_text = []
            stack = {k: v for k, v in stack.items() if k < level}
            stack[level] = t
            cur_heading = ' > '.join(stack[k] for k in sorted(stack))
        else:
            cur_text.append(t)
    flush()

    if not blocks:
        raise ValueError('docx 无可提取文本')
    return blocks


def _docx_heading_level(p) -> int | None:
    style = (p.style.name or '') if p.style is not None else ''
    if style == 'Title':
        return 1
    if style.startswith('Heading'):
        try:
            return int(style.split()[-1])
        except ValueError:
            return 1
    return None


# ============================== Markdown / 纯文本 ==============================

def _parse_markdown(path: str) -> list[dict]:
    stack: dict[int, str] = {}
    blocks: list[dict] = []
    cur_text: list[str] = []
    cur_heading = ''
    in_code = False

    def flush():
        text = '\n'.join(cur_text).strip()
        if text:
            blocks.append({'page': 1, 'text': text, 'heading': cur_heading})

    for line in _read_text(path).splitlines():
        stripped = line.strip()
        if stripped.startswith('```'):
            in_code = not in_code
            cur_text.append(line)
            continue
        if in_code:
            cur_text.append(line)
            continue
        m = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if m:
            flush()
            cur_text = []
            level = len(m.group(1))
            stack = {k: v for k, v in stack.items() if k < level}
            stack[level] = m.group(2).strip()
            cur_heading = ' > '.join(stack[k] for k in sorted(stack))
        else:
            cur_text.append(line)
    flush()

    if not blocks:
        raise ValueError('Markdown 无可提取文本')
    return blocks


def _parse_text(path: str) -> list[dict]:
    text = _read_text(path).strip()
    if not text:
        raise ValueError('文件内容为空')
    return [{'page': 1, 'text': text, 'heading': ''}]
