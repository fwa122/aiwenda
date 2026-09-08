"""内部接口：解析任务入队、检索、SSE 问答"""
import re
import secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import llm, parser, retrieval
from ..config import settings
from ..tasks import parse_document


def verify_internal(authorization: str = Header(default='')) -> None:
    """内部接口鉴权（fail-closed：未配置令牌时一律拒绝，而非静默放行）。"""
    expected = settings.internal_token
    if not expected:
        raise HTTPException(status_code=503, detail='内部接口未配置访问令牌（INTERNAL_TOKEN）')
    if not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='缺少内部访问令牌')
    if not secrets.compare_digest(authorization[7:], expected):
        raise HTTPException(status_code=401, detail='内部访问令牌无效')


router = APIRouter(dependencies=[Depends(verify_internal)])

DEFAULT_SYSTEM_PROMPT = (
    '你是企业知识库助手。请严格依据给定的知识库片段回答问题，使用简洁专业的中文。'
    '若片段中没有答案，请明确说明，不要编造。回答中需标注引用编号，如 [1]。'
)
DEFAULT_FALLBACK = '抱歉，我未在知识库中检索到相关内容，建议您换个问法或补充更多背景信息。'

# context 字符预算（中文 ≈ 2 字符/token，约 3000 token），按相关性排名截断
CONTEXT_CHAR_BUDGET = 6000

# 多轮查询改写：把指代/省略问题改写为可独立检索的完整查询
REWRITE_SYSTEM_PROMPT = (
    '你是检索查询改写器。根据对话历史，把用户最新问题改写为不依赖上下文、'
    '可独立理解的完整检索查询（消解指代、补全省略主体）。'
    '只输出改写后的查询本身，不要任何解释或前缀。若问题已完整清晰，则原样输出。'
)


def rewrite_query(question: str, history: list) -> str:
    """有历史时用 LLM 改写检索查询；改写失败回退原问题，不阻断。"""
    if not history:
        return question
    try:
        messages: list[dict] = [{'role': 'system', 'content': REWRITE_SYSTEM_PROMPT}]
        messages.extend({'role': h.role, 'content': h.content} for h in history[-6:])
        messages.append({'role': 'user', 'content': question})
        rewritten = llm.chat_once(messages, temperature=0.1, max_tokens=100)
        rewritten = rewritten.strip().strip('"“”').strip()
        return rewritten or question
    except Exception as exc:  # noqa: BLE001
        print(f'[chat] 查询改写失败，使用原问题: {exc}')
        return question


def merge_adjacent(results: list[dict]) -> list[dict]:
    """同文档 chunkIndex 连续的片段合并：消除 overlap 重复、压缩引用条数。
    保留组头（排名最高片段）的元信息。"""
    merged: list[dict] = []
    for r in results:
        if merged:
            last = merged[-1]
            if r['docId'] == last['docId'] and r['chunkIndex'] == last['chunkIndex'] + 1:
                last['content'] = last['content'].rstrip() + '\n' + r['content'].lstrip()
                last['charCount'] = len(last['content'])
                last['chunkIndex'] = r['chunkIndex']  # 区间终点，供后续相邻判断
                continue
        merged.append(dict(r))
    return merged


def build_context(results: list[dict]) -> str:
    """按排名组装带编号的 context，超出字符预算后截断（尾部丢弃优于半截）。"""
    parts: list[str] = []
    used = 0
    for i, r in enumerate(results):
        seg = f"[{i + 1}] 来源：{r['docName']} 第{r['page']}页\n{r['content']}"
        if used + len(seg) > CONTEXT_CHAR_BUDGET:
            remain = CONTEXT_CHAR_BUDGET - used
            if remain > 200:  # 剩余空间充足则截断本段收尾
                parts.append(seg[:remain].rstrip() + '…')
            break
        parts.append(seg)
        used += len(seg)
    return '\n\n'.join(parts)


class ParseTaskRequest(BaseModel):
    docId: str


class SearchRequest(BaseModel):
    kbIds: list[str]
    query: str
    topK: int = 5
    threshold: float = 0.28
    hybrid: bool = False
    rerank: bool = False


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    kbIds: list[str] = Field(default_factory=list)
    model: str | None = None
    history: list[HistoryMessage] = Field(default_factory=list)
    topK: int = 5
    threshold: float = 0.28
    systemPrompt: str | None = None
    fallbackReply: str | None = None
    # 采样参数（由 Node 从系统设置读取后传入）
    temperature: float | None = None
    topP: float | None = None
    maxTokens: int | None = None
    # 强制引用：回答无 [n] 编号时自动追加来源列表
    forceCitation: bool = True
    # 混合检索：向量 + 词法召回 + RRF 融合重排
    hybrid: bool = False
    # 重排（与 hybrid 等价开启 RRF 融合；后续可接专用重排模型）
    rerank: bool = False
    # 用户上传附件（Node 侧已提取文本）：仅本次回答有效，不进知识库
    attachments: list['Attachment'] = Field(default_factory=list)


class Attachment(BaseModel):
    name: str
    text: str


class ExtractRequest(BaseModel):
    """附件同步提取请求：文件以 base64 随 JSON 传输（无需 multipart 依赖）"""
    name: str
    base64Content: str


def sse(event_type: str, data) -> str:
    import json

    return f'data: {json.dumps({"type": event_type, "data": data}, ensure_ascii=False)}\n\n'


@router.post('/tasks/parse')
def submit_parse_task(body: ParseTaskRequest):
    result = parse_document.delay(body.docId)
    return {'ok': True, 'taskId': result.id, 'docId': body.docId}


# 附件提取：允许的扩展名与知识库上传一致；单文件上限 5MB、文本截取 6000 字
ALLOWED_ATTACH_EXTS = {'pdf', 'docx', 'txt', 'md', 'csv'}
ATTACH_MAX_BYTES = 5 * 1024 * 1024
ATTACH_MAX_CHARS = 6000


@router.post('/extract')
def extract(body: ExtractRequest):
    """同步提取附件文本（临时问答上下文用）：解 base64 → 存临时文件 → parser 提取 → 用后即删"""
    import base64 as _b64
    import os
    import tempfile

    from fastapi import HTTPException

    ext = body.name.rsplit('.', 1)[-1].lower() if '.' in body.name else ''
    if ext not in ALLOWED_ATTACH_EXTS:
        raise HTTPException(status_code=400, detail=f'不支持的附件格式 .{ext or "(无扩展名)"}')
    raw = _b64.b64decode(body.base64Content, validate=False)
    if len(raw) > ATTACH_MAX_BYTES:
        raise HTTPException(status_code=413, detail='附件超过 5MB 上限')

    fd, tmp_path = tempfile.mkstemp(prefix='attach_', suffix=f'.{ext}')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
        pages = parser.parse_file(tmp_path, ext)
        text = '\n'.join((p.get('text') or '').strip() for p in pages if p.get('text')).strip()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'附件解析失败：{e}')
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    truncated = len(text) > ATTACH_MAX_CHARS
    return {'name': body.name, 'text': text[:ATTACH_MAX_CHARS], 'chars': min(len(text), ATTACH_MAX_CHARS), 'truncated': truncated}


@router.post('/search')
def search(body: SearchRequest):
    start = time.time()
    results = retrieval.search(
        body.kbIds, body.query, body.topK, body.threshold,
        hybrid=body.hybrid, rerank=body.rerank,
    )
    return {
        'results': results,
        'elapsedMs': int((time.time() - start) * 1000),
        'total': len(results),
    }


@router.post('/chat')
def chat(body: ChatRequest):
    def gen():
        started = time.time()
        try:
            # 多轮改写：有历史时先消解指代，再检索（原问题仍用于生成）
            search_query = rewrite_query(body.question, body.history)
            results = retrieval.search(
                body.kbIds, search_query, body.topK, body.threshold,
                hybrid=body.hybrid, rerank=body.rerank,
            )
            results = merge_adjacent(results)

            refs = [
                {
                    'kbId': r['kbId'], 'docId': r['docId'], 'chunkId': r['chunkId'],
                    'chunkIndex': r['chunkIndex'], 'page': r['page'], 'score': r['score'],
                    'content': r['content'],
                }
                for r in results
            ]
            yield sse('references', refs)

            if not refs and not body.attachments:
                # 兜底：不调 LLM（防幻觉第一道防线）；有附件时附件文本可作答，不触发兜底
                fallback = body.fallbackReply or DEFAULT_FALLBACK
                yield sse('delta', {'content': fallback})
                yield sse('done', {'meta': {'model': 'fallback', 'elapsedMs': int((time.time() - started) * 1000), 'tokens': {'prompt': 0, 'completion': 0}}})
                return

            # Prompt 组装：编号引用 + 预算截断（见 build_context）
            context = build_context(results)
            # 附件文本作为上下文前置段（不占知识库引用编号，模型按文件名自然引用）
            for i, att in enumerate(body.attachments[:2]):
                context = f'【用户上传附件{i + 1}：{att.name}】\n{att.text[:6000]}{context}'
            # 强制引用：在系统提示词中追加硬约束
            system_prompt = body.systemPrompt or DEFAULT_SYSTEM_PROMPT
            if body.forceCitation:
                if results:
                    system_prompt += '\n严格要求：回答中必须标注引用编号，格式为 [编号]，例如 [1]。'
                    if body.attachments:
                        # 附件不进编号序列：悬空的 [n] 会指向不存在的来源
                        system_prompt += '\n注意：引用编号仅对应知识库来源列表；用户上传附件中的内容请直接提及附件文件名，不要为它标注编号。'
                elif body.attachments:
                    # 纯附件问答：无知识库来源可编号，避免悬空引用
                    system_prompt += '\n请依据用户上传的附件内容回答，并在回答中自然提及所依据的附件文件名（不要使用 [编号] 引用格式）。'

            messages: list[dict] = [{'role': 'system', 'content': system_prompt}]
            messages.extend({'role': h.role, 'content': h.content} for h in body.history)
            user_content = f'{context}\n\n---\n问题：{body.question}'
            # 引用覆盖指令放在 user 消息末尾（就近生效），压过系统设置里"必须标注 [n]"的要求
            if body.attachments and body.forceCitation:
                if results:
                    user_content += '\n\n（注：[编号] 仅对应知识库来源列表；用户上传附件中的内容请直接提及附件文件名，不要为它标注编号。）'
                else:
                    user_content += '\n\n（注：请基于用户上传的附件内容回答，并自然提及附件文件名；本次没有知识库来源，不要使用 [编号] 引用格式。）'
            messages.append({'role': 'user', 'content': user_content})

            prompt_tokens = sum(len(m['content']) for m in messages) // 2
            completion_tokens = 0
            # 按模型注册表路由（glm-*→智谱，kimi-/moonshot-*→Kimi）；未注册模型回落全局默认
            model_used = (
                body.model if body.model and llm.resolve_provider(body.model) else settings.llm_model
            )

            stream = llm.stream_chat(
                messages,
                model=model_used,
                temperature=body.temperature,
                top_p=body.topP,
                max_tokens=body.maxTokens,
            )
            answer_parts: list[str] = []
            try:
                for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                        piece = chunk.choices[0].delta.content
                        answer_parts.append(piece)
                        completion_tokens += len(piece)
                        yield sse('delta', {'content': piece})
                    usage = getattr(chunk, 'usage', None)
                    if usage is not None:
                        prompt_tokens = usage.prompt_tokens
                        completion_tokens = usage.completion_tokens
            finally:
                stream.close()

            # 强制引用校验：回答中无 [n] 编号时自动追加来源列表
            if body.forceCitation and results and not re.search(r'\[\d+\]', ''.join(answer_parts)):
                appendix = '\n\n参考来源：\n' + '\n'.join(
                    f"[{i + 1}] {r['docName']} 第{r['page']}页" for i, r in enumerate(results)
                )
                yield sse('delta', {'content': appendix})

            yield sse('done', {'meta': {
                'model': model_used,
                'elapsedMs': int((time.time() - started) * 1000),
                'tokens': {'prompt': prompt_tokens, 'completion': completion_tokens},
                # 改写生效时记录改写后的检索查询（调试可见；原样检索时为 None）
                'rewrittenQuery': search_query if search_query != body.question else None,
            }})
        except Exception as exc:  # noqa: BLE001
            yield sse('error', {'message': str(exc)[:300]})

    return StreamingResponse(gen(), media_type='text/event-stream')
