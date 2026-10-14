from contextlib import asynccontextmanager

from fastapi import FastAPI

from .answer_cache import ensure_answer_cache
from .api import internal, health
from .db import ensure_embedding_cache, ensure_embedding_state, ensure_indexes


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 启动时幂等创建向量/词法索引（见 db.ensure_indexes）、嵌入缓存表
    # （embedding_cache 建表 DDL 从解析任务热路径移到启动时一次，见 db.ensure_embedding_cache）
    # 与重嵌入状态表（签名播种见 db.ensure_embedding_state）
    ensure_indexes()
    try:
        ensure_embedding_cache()
        ensure_embedding_state()
        ensure_answer_cache()
    except Exception as exc:  # noqa: BLE001
        # DB 短暂不可用时不阻塞 API 启动：首次使用时惰性兜底建表
        print(f'[lifespan] 警告：缓存/重嵌入状态表初始化失败（使用时惰性兜底）: {exc}')
    yield


app = FastAPI(
    title='AI Knowledge Base - AI Service',
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.include_router(health.router, prefix='/internal', tags=['health'])
app.include_router(internal.router, prefix='/internal', tags=['internal'])
