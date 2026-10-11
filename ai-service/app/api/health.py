from fastapi import APIRouter, Depends

from .. import llm
from ..config import settings
from ..db import fetch_one
from ..keystore import presence, resolve_key
from .internal import verify_internal

# P2 改造：与 /internal/* 同级鉴权——健康接口原本匿名可达，会泄露 provider/model 拓扑
router = APIRouter(dependencies=[Depends(verify_internal)])


@router.get('/health')
def health():
    db_ok = True
    try:
        fetch_one('SELECT 1')
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        'ok': db_ok,
        'service': 'ai-service',
        'embedding': {'provider': settings.embedding_provider, 'model': settings.embedding_model, 'dimensions': settings.embedding_dimensions},
        # keyConfigured 取「默认渠道」的生效 key（DB 覆盖 > .env），与实际对话调用一致
        'llm': {'model': settings.llm_model, 'keyConfigured': bool(resolve_key(llm.resolve_default_provider()))},
        # 各渠道 key 在场状态（不含 key 本身），供设置页展示「来源：设置页/.env」
        'keyPresence': presence(),
        'db': db_ok,
    }
