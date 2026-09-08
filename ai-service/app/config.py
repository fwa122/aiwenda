from pathlib import Path

from pydantic_settings import BaseSettings

# .env 锚定到 ai-service/ 目录：服务/Celery worker 无论从哪个 cwd 启动都能读到
_BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """环境变量配置（大小写不敏感，自动读 .env）"""

    # 智谱 BigModel（OpenAI 兼容）
    zhipu_api_key: str = ''
    zhipu_base_url: str = 'https://open.bigmodel.cn/api/paas/v4'

    # Moonshot Kimi（OpenAI 兼容；仅对话生成，embedding/rerank/OCR 仍走智谱）
    moonshot_api_key: str = ''
    moonshot_base_url: str = 'https://api.moonshot.cn/v1'
    # K2.6 思考模式：disabled 保证问答响应速度；enabled 时思考内容不进 SSE 正文（回答前长空白）
    moonshot_thinking: str = 'disabled'  # disabled | enabled

    # Embedding：维度必须与库内 vector(1024) 一致，换模型需全库重建索引
    embedding_provider: str = 'zhipu'  # zhipu | mock
    embedding_model: str = 'embedding-3'
    embedding_dimensions: int = 1024

    # Rerank：智谱 /paas/v4/rerank，当前模型 ID 固定为 rerank
    rerank_model: str = 'rerank'

    # OCR：扫描件 PDF 兜底（智谱 /paas/v4/layout_parsing，glm-ocr）
    ocr_enabled: bool = True
    ocr_max_pages: int = 20  # 单文档 OCR 页数上限，防失控

    # LLM
    llm_model: str = 'glm-4-flash'
    llm_temperature: float = 0.3

    # 基础
    database_url: str = 'postgresql://kb:kb123456@127.0.0.1:5432/kb'
    celery_broker_url: str = 'redis://127.0.0.1:6379/1'
    upload_root: str = './server/uploads'
    internal_token: str = ''

    class Config:
        env_file = str(_BASE_DIR / '.env')
        env_file_encoding = 'utf-8-sig'  # 兼容 Windows 生成的 BOM
        extra = 'ignore'


settings = Settings()
