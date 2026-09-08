# AI 知识库问答系统

基于 RAG（检索增强生成）的企业知识库问答系统。用户上传企业文档，系统完成解析、切片、向量化后，即可通过自然语言提问并获得**可溯源**的回答。

> 当前阶段：**全栈已交付**。前端（Vue 3）、Node BFF（NestJS）、Python AI 服务（FastAPI + Celery）全部完成并联调通过，RAG 全链路真实跑通（解析 → 切片 → 向量化 → 混合检索 → LLM 流式生成 → 引用溯源），并已完成一轮安全专项加固。

---

## 快速开始

### 一键启动（Windows，推荐）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
# 停止
powershell -ExecutionPolicy Bypass -File scripts\stop-all.ps1
```

脚本按端口精确启停、幂等（已在运行的服务自动跳过）：Docker 基础设施 → Python AI 服务（uvicorn + Celery worker）→ Node BFF → 前端 Vite。

访问入口：前端 http://localhost:5173 · 后端 http://localhost:3000/api/v1 · AI 健康检查 http://127.0.0.1:8000/internal/health

### 分模块手动启动

```bash
# 0. 基础设施（PostgreSQL 16 + pgvector / Redis 7；MinIO 可选）
docker compose -f docker-compose.infra.yml up -d

# 1. 前端
cd frontend
npm install
npm run dev          # http://localhost:5173

# 2. Node BFF（首次需先迁移 + 种子）
cd server
npm install
npx prisma migrate deploy && npx prisma db seed
npm run build && npm start     # http://localhost:3000/api/v1

# 3. Python AI 服务（首次需先创建 venv 并安装 requirements.txt）
cd ai-service
uvicorn app.main:app --host 127.0.0.1 --port 8000
celery -A app.tasks:celery_app worker --pool=solo --loglevel=info
```

### 演示账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 超级管理员 |

> 真实后端由 `server/prisma/seed.ts` 创建 admin；editor/viewer 可通过注册页（强制 viewer）或 `POST /api/v1/users` 创建。

---

## 已实现功能

| 模块 | 功能 |
| --- | --- |
| 认证与用户 | 登录/注册/改密/用户管理、JWT 鉴权、RolesGuard（admin）、注册开关与审计 |
| 知识库问答 | SSE 流式输出、Markdown 渲染 + 代码高亮 + 代码块复制、内联引用 `[n]` 点击定位原文、来源折叠列表、消息复制/重新生成/点赞点踩、停止生成、会话置顶/重命名/删除、导出 Markdown、推荐问题与快捷引导词 |
| 多模型 | 会话级模型选择下拉（GLM-4-Flash / Kimi K2.6），按模型名前缀路由到智谱 / Moonshot，选择随会话持久化 |
| 附件问答 | 提问时可附带文件（≤5MB，pdf/docx/txt/md/csv），文本提取后仅作为本次回答上下文，不入库 |
| 知识库管理 | 卡片列表、新建/配置（切片参数 + 检索参数）、重建索引、删除；可见性权限（internal/public/private，IDOR 防护） |
| 知识库详情 | 文档表格（解析进度/失败原因）、上传（20MB 白名单）、重新解析、切片查看、检索测试（Top K/阈值/混合检索/Rerank 实时调参）、使用统计 |
| RAG 内核 | PDF（标题启发式 + 表格转 Markdown + 扫描件 OCR 兜底）/docx/md/txt/csv 解析；标题层级切片；智谱 embedding-3（1024 维）+ pgvector HNSW；向量 + pg_trgm 词法双路召回 + RRF 融合 + 智谱 rerank 精排；多轮查询改写（指代消解）；相邻片段合并；context 字符预算截断；三道防幻觉机制 |
| 系统设置 | 模型/检索/安全/存储分区配置、API 密钥（哈希存储 + 脱敏）、用量统计（daily_stats 闭环 + 月度配额）、操作日志、用户配额 |
| 安全加固 | 内部接口令牌鉴权（fail-closed）、越权（IDOR）修复、上传白名单 + 大小限制、CORS 白名单、JWT 强密钥启动校验、路径穿越防护、XSS/反向标签劫持防护 |

---

## 技术栈

- **前端**：Vue 3（组合式 API）、Vite 6、Vue Router、Pinia、Element Plus、markdown-it、highlight.js、DOMPurify、dayjs
- **Node BFF**：NestJS 12 + TypeScript 5.9 + Prisma 6 + JWT（bcrypt）+ Multer
- **AI 服务**：Python FastAPI + Celery 5（Redis broker）+ psycopg3 + PyMuPDF + python-docx + OpenAI 兼容 SDK
- **存储**：PostgreSQL 16 + pgvector（业务数据 + 向量，HNSW 索引）+ Redis 7（队列）+ 本地磁盘（`server/uploads/`，MinIO 为可选演进）
- **模型**：智谱 BigModel（GLM 生成 + embedding-3 向量 + rerank 精排 + glm-ocr）；Moonshot Kimi K2.6（可选生成模型）

---

## 目录结构

```
AI问答/
├── docs/
│   ├── 开发文档.md          # 架构、目录、进度、模块设计、UI 规范、踩坑记录
│   ├── 接口文档.md          # 前后端接口契约（含 SSE 协议、内部接口、差异清单）
│   └── 后端开发方案.md      # 架构设计、选型分析、数据库设计、实施记录
├── docker-compose.infra.yml # kb-postgres(pgvector) + kb-redis（MinIO 可选）
├── scripts/                 # 一键启动/停止脚本（PowerShell）
├── server/                  # Node BFF（NestJS 12 + Prisma 6）
│   ├── src/
│   │   ├── auth/ user/ knowledge-base/ document/
│   │   ├── conversation/ chat/          # 会话 CRUD、SSE 编排、附件
│   │   ├── settings/ api-key/ stats/ log/
│   │   ├── integrations/ai-service.client.ts   # Python 服务转发（含令牌）
│   │   └── common/kb-access.ts          # 知识库统一权限模型
│   ├── prisma/              # schema（11 表）+ seed + migrations
│   └── uploads/<kbId>/      # 文档落盘目录（.gitignore）
├── ai-service/              # Python AI 服务（FastAPI + Celery）
│   └── app/
│       ├── api/             # /internal/*（令牌鉴权）+ /internal/health
│       ├── llm.py           # 多 Provider 注册表（glm-*→智谱，kimi-*→Kimi）
│       ├── parser.py        # 解析（PDF/docx/md/txt/csv + OCR 兜底）
│       ├── chunker.py       # 标题层级切片
│       ├── retrieval.py     # 向量+词法双路召回、RRF、rerank
│       ├── tasks.py         # Celery 解析任务（重试策略 + 路径防护）
│       └── db.py config.py embedding.py ids.py
└── frontend/
    └── src/
        ├── api/             # 接口层（Mock 与真实请求双分支）
        ├── mock/            # 模拟数据（联调已切换真实后端，保留可离线演示）
        ├── store/           # Pinia：chat / knowledge / user
        ├── views/ components/ layouts/ utils/ styles/
```

---

## 文档

- [开发文档](./docs/开发文档.md)：架构设计、进度总览、模块设计、UI 规范、开发规范、踩坑记录
- [接口文档](./docs/接口文档.md)：通用约定、数据模型、全量接口清单、SSE 流式协议、内部服务接口、联调检查清单
- [后端开发方案](./docs/后端开发方案.md)：技术选型分析、数据库设计、核心链路设计、部署方案

---

## 后续规划

| 阶段 | 内容 |
| --- | --- |
| P3 · 效果优化 | 查询改写效果评估、专用 Rerank 模型扩展、引用高亮原文定位、答案评价闭环分析 |
| P4 · 运营能力 | 知识库成员权限细化、审计看板、成本统计、A/B 实验 |
| 生产化 | 全栈 Docker Compose 化（Nginx 容器托管前端 dist + 反向代理）、MinIO 对象存储接入、限流（429 + Retry-After）、解析任务对账恢复 |
