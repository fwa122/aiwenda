# AI 知识库平台接入指南

## 支持的文档格式
平台支持 12 种文档格式：PDF、Word、Excel、PPT、Markdown、TXT、HTML、CSV 等。扫描件自动启用 OCR（中文模型 PaddleOCR）。

## 切片建议
长文档使用 chunk_size=512、overlap=64；FAQ 短文本使用 256/32；表格密集型建议 768/96。

## 检索链路
系统采用向量召回 + BM25 关键词召回 + Rerank 精排的三段式检索。相似度阈值默认 0.28，低于该值返回兜底话术。Rerank 开启后长尾问题命中率从 78% 提升至 94.3%。

## 发布流程
验证召回后即可发布为问答助手，支持 iframe 与 Web Component 两种嵌入方式。
