"""运行时 API Key 仓库：system_settings.api_keys（JSONB 单行表）→ 进程内 TTL 缓存

key 优先级：DB 覆盖值（前端设置页配置）> .env 默认值（config.settings）。
- Node 保存 key 后调 POST /internal/keys/reload 使缓存立即失效（本模块 invalidate）
- Celery worker 收不到 HTTP 推送，靠 TTL 自然过期读到新值
- DB 不可用/表未迁移时 fail-soft 返回空，回落 .env，不阻断服务
- 缓存只在进程内：web 进程与 worker 各自持有，互不影响
"""
import json
import time

from .config import settings
from .db import fetch_one

# 缓存 TTL（秒）：更换 key 后 worker 侧最迟此延迟生效
TTL_SECONDS = 45

PROVIDERS = ('zhipu', 'qianwen', 'moonshot', 'minimax')

_cache: tuple[float, dict] | None = None  # (loaded_at, {provider: key})


def _load_keys() -> dict:
    """读取 DB 覆盖值（带 TTL 缓存）。返回 {provider: key}，仅含非空项。"""
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < TTL_SECONDS:
        return _cache[1]
    keys: dict = {}
    try:
        row = fetch_one('SELECT api_keys FROM system_settings WHERE id = 1')
        raw = row.get('api_keys') if row else None
        if isinstance(raw, str):  # 兼容未自动解析的 JSON 字面量
            raw = json.loads(raw)
        if isinstance(raw, dict):
            keys = {
                p: str(raw.get(p) or '').strip() for p in PROVIDERS
                if str(raw.get(p) or '').strip()
            }
    except Exception as exc:  # noqa: BLE001
        print(f'[keystore] 读取 system_settings.api_keys 失败，回落 .env: {exc}')
        keys = {}
    _cache = (now, keys)
    return keys


def invalidate() -> None:
    """清空缓存：下次读取重查 DB（/internal/keys/reload 触发）"""
    global _cache
    _cache = None


def resolve_key(provider: str) -> str:
    """生效 key：DB 覆盖值 > .env 默认值；都没有返回空串（调用方按未配置处理）"""
    override = _load_keys().get(provider, '')
    if override:
        return override
    return (getattr(settings, f'{provider}_api_key', '') or '').strip()


def presence() -> dict:
    """各 provider key 在场状态（不含 key 本身）：{p: {configured, source}}
    source: db（设置页覆盖）| env（.env 默认）| none（未配置）"""
    out: dict = {}
    db_keys = _load_keys()
    for p in PROVIDERS:
        if db_keys.get(p):
            out[p] = {'configured': True, 'source': 'db'}
        elif (getattr(settings, f'{p}_api_key', '') or '').strip():
            out[p] = {'configured': True, 'source': 'env'}
        else:
            out[p] = {'configured': False, 'source': 'none'}
    return out
