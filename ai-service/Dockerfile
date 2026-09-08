# Python AI 服务（FastAPI API 与 Celery worker 共用此镜像）
# 依赖全为有 manylinux wheel 的纯 pip 包（OCR 走智谱云端 API），无需系统编译依赖

FROM python:3.12-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

# API：uvicorn app.main:app（compose 内仅内网可达，不经 nginx）
# worker 由 compose 以 command 覆盖：celery -A app.tasks worker
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
