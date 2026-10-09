from fastapi import APIRouter, Depends

from ..config import settings
from ..db import fetch_one
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
        'llm': {'model': settings.llm_model, 'keyConfigured': bool(settings.zhipu_api_key)},
        'db': db_ok,
    }
