# AI 知识库问答系统

[![CI](https://github.com/fwa122/aiwenda/actions/workflows/ci.yml/badge.svg)](https://github.com/fwa122/aiwenda/actions/workflows/ci.yml)

基于 RAG（检索增强生成）的企业知识库问答系统。用户上传企业文档，系统完成解析、切片、向量化后，即可通过自然语言提问并获得**可溯源**的回答。

> 当前阶段：**全栈已交付，支持一键 Docker 部署**。前端（Vue 3）、Node BFF（NestJS）、Python AI 服务（FastAPI + Celery）全部完成并联调通过，RAG 全链路真实跑通（解析 → 切片 → 向量化 → 混合检索 → LLM 流式生成 → 引用溯源）。项目持续迭代至 v0.9.23：完成两轮安全专项加固（Redis 认证、防爆破、JWT 刷新轮换）、建成检索评测体系（20 条 golden QA + 精排路由可观测）、接入千问多模型渠道与嵌入内容级缓存、数据库每日自动备份、**自动化测试 76 用例 + GitHub Actions CI/CD**（四 job 并行 + tag 自动发版），并提供开箱即用的 Docker Compose 全栈编排（首启自动迁移 + 播种）。详见[更新日志](#更新日志)。

---

## 快速开始

### 方式一：使用现成镜像（推荐，免构建）

镜像已发布到 Docker Hub（`gujinyi666/aiwenda-frontend` / `aiwenda-server` / `aiwenda-ai`），克隆仓库后直接拉取运行。整个系统打包为 6 个容器（前端 nginx / Node BFF / Python AI 服务 / Celery worker / PostgreSQL+pgvector / Redis），**只需安装 Docker，无需 Node/Python 环境，也不需要本地构建**（postgres/redis 用公共镜像自动拉取）。

**前提**：Docker Desktop（Windows/Mac）或 Docker Engine（Linux）、git、一个智谱 API Key（[开放平台](https://open.bigmodel.cn/) 注册申请，有免费额度；默认生成/向量/rerank/OCR 渠道）。推荐再配一个千问 DashScope API Key（[阿里云百炼](https://bailian.console.aliyun.com/)，可选）：获得 qwen / deepseek 系列生成模型与第二嵌入渠道。

```bash
# 1. 获取代码
git clone https://github.com/fwa122/aiwenda.git
cd aiwenda

# 2. 写配置（Windows 用 copy 命令）
cp .env.docker.example .env
```

`.env` 必填项：

| 变量 | 说明 | 生成方式 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | 数据库密码（仅容器内部使用） | `openssl rand -hex 16` |
| `JWT_SECRET` | 登录令牌签名密钥（≥32 字符，否则 server 拒绝启动） | `openssl rand -hex 32` |
| `REDIS_PASSWORD` | Redis 访问密码（未配置 compose 拒绝启动） | `openssl rand -hex 24` |
| `ADMIN_INITIAL_PASSWORD` | 首次播种 admin 账号的初始密码（登录后请修改） | 自定义强密码 |
| `INTERNAL_TOKEN` | BFF↔AI 服务内部令牌（未配置内部接口 fail-closed） | `openssl rand -hex 32` |
| `ZHIPU_API_KEY` | 智谱 API Key（默认生成/向量/rerank/OCR 渠道） | 开放平台控制台复制 |
| `QIANWEN_API_KEY` | 千问 DashScope Key（可选：qwen/deepseek 生成模型 + 嵌入渠道） | 阿里云百炼控制台复制 |
| `MOONSHOT_API_KEY` | Kimi K2.6（可选，不填则无 Kimi 模型） | Moonshot 平台申请 |

```bash
# 3. 拉取镜像并启动（数据库迁移与 admin 播种自动完成）
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

浏览器访问 `http://localhost/`（云服务器用 `http://<服务器IP>/`），用 `admin` 与 `.env` 中 `ADMIN_INITIAL_PASSWORD` 设定的密码登录，**登录后立即改密码**（弱口令不再有默认值，首次启动播种时生效）。

**日常运维**（`-f docker-compose.prod.yml` 可简写，下同）：

```bash
docker compose -f docker-compose.prod.yml stop            # 停止（数据保留）
docker compose -f docker-compose.prod.yml up -d           # 再次启动（秒起）
docker compose -f docker-compose.prod.yml logs -f server  # 看服务日志（worker / ai-service 同理）
git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d  # 更新到新版镜像
docker compose -f docker-compose.prod.yml down            # 删容器（数据仍在卷中）
docker compose -f docker-compose.prod.yml down -v         # ⚠️ 连数据一起清空（重置环境才用）
```

> 数据存于命名卷 `kb-prod_pg_data` / `kb-prod_redis_data` / `kb-prod_uploads_data`。
>
> **国内网络拉不动基础镜像时**：`docker pull docker.m.daocloud.io/library/python:3.12-slim && docker tag docker.m.daocloud.io/library/python:3.12-slim python:3.12-slim`（`nginx:alpine`、`node:24-slim` 同理），或在 Docker Desktop 设置中配置镜像加速。
>
> **拉取本项目镜像（`gujinyi666/aiwenda-*`）国内网络提示**：个人镜像不在 DaoCloud 白名单，直连 `registry-1.docker.io` 超时时，需在 Docker Desktop → Settings → Resources → Proxies 配置自己的代理，或尝试支持任意路径的第三方加速器（如 `docker.1ms.run/gujinyi666/aiwenda-frontend:latest`，可用性以站点为准）。有外网条件时直接 `docker compose -f docker-compose.prod.yml pull` 即可。

### 方式二：源码构建部署（自己改了代码时用）

编排文件 [docker-compose.yml](docker-compose.yml) 与方式一服务定义完全相同，区别是前端 / BFF / AI 三个镜像从本地源码构建（数据库迁移与播种同样自动完成）：

```bash
docker compose up -d --build   # 首次约 5~10 分钟；改代码后重复执行即增量更新
```

### 方式三：开发模式（调试用）

#### 一键启动（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
# 停止
powershell -ExecutionPolicy Bypass -File scripts\stop-all.ps1
```

脚本按端口精确启停、幂等（已在运行的服务自动跳过）：Docker 基础设施 → Python AI 服务（uvicorn + Celery worker）→ Node BFF → 前端 Vite。

访问入口：前端 http://localhost:5173 · 后端 http://localhost:3000/api/v1 · AI 健康检查 http://127.0.0.1:8000/internal/health

#### 分模块手动启动

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

> 开发模式与 Docker 部署是**两套独立的数据卷**，数据不互通，请选定一套使用。

### 演示账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| admin | `.env` 中的 `ADMIN_INITIAL_PASSWORD` | 超级管理员 |

> 真实后端由 `server/prisma/seed.ts` 创建 admin（密码来自 `ADMIN_INITIAL_PASSWORD`，未配置则跳过播种并告警）；editor/viewer 可通过注册页（强制 viewer）或 `POST /api/v1/users` 创建。

---

## 已实现功能

| 模块 | 功能 |
| --- | --- |
| 认证与用户 | 登录/注册/改密/用户管理、JWT 鉴权 + refresh token 轮换（access 2h + refresh 7 天，前端单飞静默刷新不断线）、RolesGuard（admin）、注册开关与审计 |
| 知识库问答 | SSE 流式输出、Markdown 渲染 + 代码高亮 + 代码块/表格复制、内联引用 `[n]` 点击打开原文预览（PDF 定位页码）、划词追问、后续问题建议 chips、预设提示词模板（`/` 唤起）、全局搜索（Ctrl+K 搜会话/文档/历史回答）、会话自动命名、回答收藏夹（快照 + 导出 Markdown）、消息复制/重新生成/点赞点踩、停止生成、会话置顶/重命名/删除、导出 Markdown、推荐问题与快捷引导词 |
| 多模型 | 会话级模型选择下拉，按模型名前缀路由（`glm-*`→智谱、`qwen-*`/`deepseek-*`→千问、`kimi-`→Moonshot），选择随会话持久化 |
| 附件问答 | 提问时可附带文件（≤5MB，pdf/docx/txt/md/csv），文本提取后仅作为本次回答上下文，不入库 |
| 知识库管理 | 卡片列表、新建/配置（切片参数 + 检索参数）、重建索引、删除；可见性权限（internal/public/private，IDOR 防护）；聊天页拖拽直接入库、文件夹批量导入、解析完成应用内/浏览器通知 |
| 知识库详情 | 文档表格（解析进度/失败原因）、上传（20MB 白名单 + magic bytes 二次校验）、预览/下载（PDF 可翻页）、重新解析、切片查看、检索测试（Top K/阈值/混合检索/Rerank 实时调参）、检索评测（20 条 golden QA，HitRate@5 / MRR@5 + bootstrap 置信区间 + 难例导出）、使用统计 |
| RAG 内核 | PDF（标题启发式 + 表格转 Markdown + 扫描件 OCR 兜底）/docx/md/txt/csv 解析；标题层级切片；双渠道嵌入（智谱 embedding-3 / 千问 qwen3.7-text-embedding，1024 维）+ pgvector HNSW；向量 + pg_trgm 词法双路召回 + RRF 融合 + rerank 精排（与召回通道解耦 + 分差自适应路由跳过）；多轮查询改写（指代消解 + 自包含问题跳过）；相邻片段合并；context 字符预算截断；嵌入内容级缓存（重解析零 API 消耗）；三道防幻觉机制 |
| 系统设置 | 模型/检索/安全/存储分区配置、API 密钥（哈希存储 + 脱敏）、用量统计（daily_stats 闭环 + 月度配额）、操作日志、用户配额 |
| 安全加固 | 内部接口令牌鉴权（fail-closed）、Redis 全链路密码认证（fail-fast）、登录账号级防爆破（5 次失败锁 15 分钟）+ IP 限流（计数存 Redis，跨重启/扩容存活）、越权（IDOR）修复、上传白名单 + 大小限制 + magic bytes、CORS 白名单、JWT 强密钥启动校验、路径穿越防护、XSS/反向标签劫持防护 |
| 运维保障 | 数据库与上传目录每日自动备份（每类保留 7 份，附恢复演练）、nginx gzip 压缩 + 安全响应头 + index.html 不缓存（发版即时生效）、嵌入缓存 30 天 TTL 定期清理 |

---

## 技术栈

- **前端**：Vue 3（组合式 API）、Vite 6、Vue Router、Pinia、Element Plus、markdown-it、highlight.js、DOMPurify、dayjs
- **Node BFF**：NestJS 12 + TypeScript 5.9 + Prisma 6 + JWT（bcrypt）+ Multer
- **AI 服务**：Python FastAPI + Celery 5（Redis broker）+ psycopg3 + PyMuPDF + python-docx + OpenAI 兼容 SDK
- **存储**：PostgreSQL 16 + pgvector（业务数据 + 向量，HNSW 索引）+ Redis 7（队列）+ 本地磁盘（`server/uploads/`，MinIO 为可选演进）
- **模型**：千问 DashScope（qwen3.8-max / qwen3.7-flash / deepseek-v4-pro 生成 + qwen3.7-text-embedding 向量，OpenAI 兼容端点）；智谱 BigModel（GLM 生成 + embedding-3 向量 + rerank 精排 + glm-ocr）；Moonshot Kimi K2.6（可选生成模型）

---

## 目录结构

```
AI问答/
├── docs/
│   ├── 开发文档.md          # 架构、目录、进度、模块设计、UI 规范、踩坑记录
│   ├── 接口文档.md          # 前后端接口契约（含 SSE 协议、内部接口、差异清单）
│   └── 后端开发方案.md      # 架构设计、选型分析、数据库设计、实施记录
├── docker-compose.yml       # 全栈编排：nginx + server + ai-service + worker + postgres + redis
├── docker-compose.infra.yml # 开发模式基础设施：kb-postgres(pgvector) + kb-redis（MinIO 可选）
├── .env.docker.example      # Docker 部署环境变量模板
├── nginx/default.conf       # 前端托管 + /api 反代（SSE 关缓冲）
├── frontend/Dockerfile      # 多阶段：Node 构建 dist → nginx 托管
├── server/Dockerfile        # 多阶段：tsc + prisma generate；首启自动迁移+播种
├── ai-service/Dockerfile    # API 与 worker 共用镜像
├── scripts/                 # 开发模式一键启动/停止脚本（PowerShell）
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

- [更新日志](./docs/更新日志.md)：全部版本的完整变更明细、实测数据与踩坑记录
- [开发文档](./docs/开发文档.md)：架构设计、进度总览、模块设计、UI 规范、开发规范、踩坑记录
- [接口文档](./docs/接口文档.md)：通用约定、数据模型、全量接口清单、SSE 流式协议、内部服务接口、联调检查清单
- [后端开发方案](./docs/后端开发方案.md)：技术选型分析、数据库设计、核心链路设计、部署方案
- [安全修复总结报告](./安全修复总结报告.md)：安全专项加固（v0.8.0）的问题清单与修复方案

---

## 更新日志

> 逐版本的完整变更、实测数据与踩坑记录见 [docs/更新日志.md](./docs/更新日志.md)，以下为版本时间线速览。

| 版本 | 日期 | 主题 |
| --- | --- | --- |
| v0.9.23 | 2026-10-09 | 测试体系扩展至 76 用例（单元 17 / 集成 9 / pytest 50）+ GitHub Actions CI/CD 落地（四 job 全绿 + tag 自动发版）；修复 JWT_EXPIRES_IN 漏配导致登录 500 |
| v0.9.22 | 2026-10-09 | 测试基础设施：vitest 17 个单元测试落地；修复 v0.9.13 多轮历史注入两处缺陷（发给 LLM 的历史顺序颠倒 + 字符预算从最旧开始消耗） |
| v0.9.21 | 2026-10-09 | JWT 刷新机制：refresh token 7 天轮换 + 前端单飞静默刷新，「2 小时必踢」变为「7 天内有活动不断线」 |
| v0.9.20 | 2026-10-09 | P2 批量加固：SSE 透传改写词、嵌入缓存 30 天 TTL 清理、`/internal/health` 鉴权、上传 magic bytes 校验 |
| v0.9.19 | 2026-10-09 | 运维：数据库与上传目录每日自动备份（每类保留 7 份）+ 恢复演练 |
| v0.9.18 | 2026-10-09 | 限流与登录锁定计数下沉 Redis，跨重启/扩容存活 |
| v0.9.17 | 2026-10-09 | 登录账号级防爆破：连错 5 次锁定 15 分钟（不区分来源 IP，封死账号探测旁路） |
| v0.9.16 | 2026-10-09 | 修复免构建编排配置漂移：补齐嵌入渠道变量（21/21 项核对一致） |
| v0.9.15 | 2026-10-09 | P0 安全整改：Redis 全链路密码认证（fail-fast）+ admin 弱口令改环境变量注入 |
| v0.9.14 | 2026-10-09 | 嵌入内容级缓存（重解析零 API 消耗）+ 嵌入失败可操作报错 |
| v0.9.13 | 2026-10-07 | Token 消耗治理：轻量任务降档、历史上下文 token 预算（单请求省约 4900 tokens）、改写按需触发 |
| v0.9.12 | 2026-10-07 | 接入千问 Provider（qwen / deepseek 生成 + 嵌入渠道切换），检索质量 MRR@5 0.693 → 0.8267 |
| v0.9.11 | 2026-10-06 | 自适应精排路由：分差阈值跳过精排调用，单条省约 3 倍延迟、零指标损伤 |
| v0.9.10 | 2026-10-06 | 评测口径 v2：锚点切片窗口 + bootstrap 95% 置信区间 + 难例导出 |
| v0.9.9 | 2026-10-06 | Rerank 与混合召回解耦，四模式归因实验修复「精排负优化」 |
| v0.9.8 | 2026-10-06 | 检索评测体系：20 条 golden QA 评测集 + 知识库详情页评测 UI（HitRate@5 / MRR@5） |
| v0.9.7 | 2026-10-06 | 引用页码跳转（PDF 定位页码）+ 文档预览抽屉统一（`DocPreviewDrawer`） |
| v0.9.6 | 2026-10-06 | 接口限流（全局兜底 + 高成本接口单独收紧）+ nginx gzip 压缩/安全响应头 |
| v0.9.5 | 2026-10-06 | 全局搜索（Ctrl+K 命令面板）、会话自动命名、回答收藏夹 |
| v0.9.4 | 2026-10-05 | 划词追问、后续问题建议、预设提示词模板、回答内复制按钮 |
| v0.9.3 | 2026-10-05 | 聊天页拖拽直接入库、文件夹批量导入、解析完成通知 |
| v0.9.2 | 2026-10-05 | 文档在线预览与下载（单端点双模式）、中文文件名乱码修复 |
| v0.9.1 | 2026-10-02 | 部署文档《启动运行指南》、企业化演进路线、检索设置弹层修复 |
| v0.9.0 | 2026-09-08 | 多 Provider LLM、附件临时问答、镜像发布 Docker Hub |

> 更早的开发期里程碑（v0.2.0 → v0.8.0 安全专项加固）见完整日志末尾。

---

## 后续规划

| 阶段 | 内容 |
| --- | --- |
| P3 · 效果优化 | 查询改写效果评估、专用 Rerank 模型扩展、引用高亮原文定位、答案评价闭环分析 |
| P4 · 运营能力 | 知识库成员权限细化、审计看板、成本统计、A/B 实验 |
| 生产化 | MinIO 对象存储接入、解析任务对账恢复、HTTPS（域名 + certbot）、nginx upstream 自动跟随（resolver + variable proxy_pass）、重索引接口（reindex）补全 |
