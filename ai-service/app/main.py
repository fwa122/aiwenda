from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api import internal, health
from .db import ensure_indexes


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 启动时幂等创建向量/词法索引（见 db.ensure_indexes）
    ensure_indexes()
    yield


app = FastAPI(
    title='AI Knowledge Base - AI Service',
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.include_router(health.router, prefix='/internal', tags=['health'])
app.include_router(internal.router, prefix='/internal', tags=['internal'])
