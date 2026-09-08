"""LLM：OpenAI 兼容多 Provider（智谱 GLM / Moonshot Kimi）

仅对话生成层多 Provider；Embedding/Rerank/OCR 固定走智谱。
路由规则：按模型名前缀匹配注册表，未识别的模型回落全局默认（llm_model）。
"""
from openai import OpenAI

from .config import settings

# 模型名前缀 → Provider 注册表（小写匹配）
PROVIDER_PREFIXES: dict[str, str] = {
    'glm': 'zhipu',
    'kimi': 'moonshot',
    'moonshot': 'moonshot',
}

_clients: dict[str, OpenAI] = {}


def resolve_provider(model: str | None) -> str | None:
    """解析模型所属 Provider；未注册的模型名返回 None（调用方应回落默认模型）。"""
    name = (model or '').lower()
    for prefix, provider in PROVIDER_PREFIXES.items():
        if name.startswith(prefix):
            return provider
    return None


def resolve_default_provider() -> str:
    return resolve_provider(settings.llm_model) or 'zhipu'


def _get_client(provider: str) -> OpenAI:
    if provider in _clients:
        return _clients[provider]
    if provider == 'moonshot':
        if not settings.moonshot_api_key:
            raise ValueError('MOONSHOT_API_KEY 未配置')
        client = OpenAI(
            api_key=settings.moonshot_api_key,
            base_url=settings.moonshot_base_url,
            timeout=60.0,
        )
    else:
        if not settings.zhipu_api_key:
            raise ValueError('ZHIPU_API_KEY 未配置')
        client = OpenAI(
            api_key=settings.zhipu_api_key,
            base_url=settings.zhipu_base_url,
            timeout=60.0,
        )
    _clients[provider] = client
    return client


def _base_kwargs(messages: list[dict], model: str | None, temperature: float | None) -> dict:
    return {
        'model': model or settings.llm_model,
        'messages': messages,
        'temperature': settings.llm_temperature if temperature is None else temperature,
    }


def _apply_provider_kwargs(kwargs: dict, provider: str) -> None:
    """按 Provider 追加/覆盖特殊参数（在通用参数之后调用）。"""
    if provider == 'moonshot':
        kwargs['temperature'] = 0.6  # kimi-k2.6 仅允许 0.6，其余值 400
        # K2.6 思考模式为非标准字段：经 extra_body 透传（openai SDK 不接受裸 kwarg）
        kwargs['extra_body'] = {'thinking': {'type': settings.moonshot_thinking}}


def stream_chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
):
    """返回流式迭代器；调用方遍历 chunk.choices[0].delta.content，
    最后的 chunk 可能带 usage（prompt_tokens/completion_tokens）。
    采样参数由 Node 从系统设置传入，为 None 时回落 .env 配置。"""
    provider = resolve_provider(model) or resolve_default_provider()
    kwargs = _base_kwargs(messages, model, temperature)
    kwargs['stream'] = True
    if top_p is not None:
        kwargs['top_p'] = top_p
    if max_tokens is not None:
        kwargs['max_tokens'] = max_tokens
    _apply_provider_kwargs(kwargs, provider)
    return _get_client(provider).chat.completions.create(**kwargs)


def chat_once(
    messages: list[dict],
    model: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> str:
    """非流式调用（查询改写等轻量场景），返回完整回复文本。"""
    provider = resolve_provider(model) or resolve_default_provider()
    kwargs = _base_kwargs(messages, model, temperature)
    kwargs['stream'] = False
    if max_tokens is not None:
        kwargs['max_tokens'] = max_tokens
    _apply_provider_kwargs(kwargs, provider)
    resp = _get_client(provider).chat.completions.create(**kwargs)
    if not resp.choices:
        return ''
    return resp.choices[0].message.content or ''
