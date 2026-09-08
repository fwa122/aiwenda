from fastapi import APIRouter

from ..config import settings
from ..db import fetch_one

router = APIRouter()


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
