from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api import internal, health
from .db import ensure_embedding_cache, ensure_indexes


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 启动时幂等创建向量/词法索引（见 db.ensure_indexes）与嵌入缓存表
    # （embedding_cache 建表 DDL 从解析任务热路径移到启动时一次，见 db.ensure_embedding_cache）
    ensure_indexes()
    try:
        ensure_embedding_cache()
    except Exception as exc:  # noqa: BLE001
        # DB 短暂不可用时不阻塞 API 启动：首次解析任务经 embed_texts_cached 惰性兜底建表
        print(f'[lifespan] 警告：嵌入缓存表初始化失败（任务内惰性兜底）: {exc}')
    yield


app = FastAPI(
    title='AI Knowledge Base - AI Service',
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.include_router(health.router, prefix='/internal', tags=['health'])
app.include_router(internal.router, prefix='/internal', tags=['internal'])
