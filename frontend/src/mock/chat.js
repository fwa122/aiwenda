/**
 * 会话与消息模拟数据
 * sources 仅存引用坐标（kbId / docId / chunkIndex），
 * 具体文档名、片段内容由 mock/index.js 的 buildSources() 补全，
 * 与后端「引用来源落库只存坐标、展示时再关联」的设计保持一致。
 */

export const mockConversations = [
  {
    id: 'conv_001',
    title: '如何快速接入 AI 知识库平台',
    kbIds: ['kb_001'],
    model: 'qwen2.5-72b-instruct',
    pinned: false,
    messageCount: 4,
    tokenUsed: 3860,
    createdAt: '2026-09-05 09:42:10',
    updatedAt: '2026-09-05 09:48:36',
    messages: [
      {
        id: 'msg_00101',
        role: 'user',
        content: '我们准备把内部文档做成问答助手，能说下接入步骤吗？',
        createdAt: '2026-09-05 09:42:10',
        meta: { files: [] }
      },
      {
        id: 'msg_00102',
        role: 'assistant',
        content: `接入 AI 知识库问答平台只需三步，整体耗时约 10 分钟：

### 1. 创建知识库
在控制台「知识库管理 → 新建知识库」中填写名称，并选择 Embedding 模型（中文场景推荐 \`bge-large-zh-v1.5\`）。

### 2. 上传并解析文档
支持手动上传、对象存储挂载、API 推送三种方式，覆盖 PDF / Word / Excel / PPT / Markdown 等 12 种格式。

### 3. 验证召回并发布
先在「检索测试」中输入典型问题确认 Top 5 均能命中，再发布为问答助手。

> 解析耗时参考：100 页 PDF 约 45 秒；1 万条切片在单卡 A10 上向量化约 3 分钟。`,
        createdAt: '2026-09-05 09:42:32',
        sources: [
          { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 1, score: 0.93 },
          { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 2, score: 0.88 }
        ],
        meta: { model: 'qwen2.5-72b-instruct', elapsedMs: 2140, tokens: { prompt: 1820, completion: 640, total: 2460 } },
        feedback: null
      },
      {
        id: 'msg_00103',
        role: 'user',
        content: '切片参数怎么设置比较合适？我们的文档大多是几十页的产品手册。',
        createdAt: '2026-09-05 09:47:02',
        meta: { files: [] }
      },
      {
        id: 'msg_00104',
        role: 'assistant',
        content: `针对几十页的产品手册，推荐以下配置：

- **chunk_size**：\`512\`，能够在保留上下文完整性的同时避免噪声
- **overlap**：\`64\`，保证跨切片的语义连贯
- **解析策略**：「智能解析」，保留标题层级与表格结构

如果手册中包含大量 FAQ 或条款类短文本，建议单独建库并使用 \`chunk_size=256\`、\`overlap=32\`。

参数修改后需对全库**重建索引**才会生效，重建期间旧索引仍可正常提供检索服务。`,
        createdAt: '2026-09-05 09:48:36',
        sources: [
          { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 2, score: 0.84 },
          { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 2, score: 0.79 }
        ],
        meta: { model: 'qwen2.5-72b-instruct', elapsedMs: 1680, tokens: { prompt: 2640, completion: 380, total: 3020 } },
        feedback: 'like'
      }
    ]
  },
  {
    id: 'conv_002',
    title: '差旅报销的住宿标准与时效',
    kbIds: ['kb_002'],
    model: 'qwen2.5-32b-instruct',
    pinned: false,
    messageCount: 2,
    tokenUsed: 1980,
    createdAt: '2026-09-05 08:15:44',
    updatedAt: '2026-09-05 08:16:20',
    messages: [
      {
        id: 'msg_00201',
        role: 'user',
        content: '去上海出差，住宿标准是多少？报销需要在多久内提交？',
        createdAt: '2026-09-05 08:15:44',
        meta: { files: [] }
      },
      {
        id: 'msg_00202',
        role: 'assistant',
        content: `### 住宿标准（上海属一线城市）

**600 元/晚**，市内交通凭票实报实销，餐补 100 元/天（包干，无需发票）。

### 报销时限

- 费用发生后 **30 个自然日内**提交
- 跨年度费用须在次年 **1 月 10 日**前提交完毕
- 单笔 > 5000 元需附部门负责人审批单；> 20000 元需分管副总审批
- 审批通过后 **5 个工作日内**到账

> 出差前请在 OA 提交出差申请，未提交申请的费用原则上不予报销。`,
        createdAt: '2026-09-05 08:16:20',
        sources: [
          { kbId: 'kb_002', docId: 'doc_2002', chunkIndex: 1, score: 0.95 },
          { kbId: 'kb_002', docId: 'doc_2002', chunkIndex: 2, score: 0.9 },
          { kbId: 'kb_002', docId: 'doc_2002', chunkIndex: 3, score: 0.86 }
        ],
        meta: { model: 'qwen2.5-32b-instruct', elapsedMs: 1320, tokens: { prompt: 1240, completion: 420, total: 1660 } },
        feedback: null
      }
    ]
  },
  {
    id: 'conv_003',
    title: '检索相似度阈值与 TopK 调参',
    kbIds: ['kb_001'],
    model: 'qwen2.5-72b-instruct',
    pinned: true,
    messageCount: 4,
    tokenUsed: 5240,
    createdAt: '2026-09-04 15:20:08',
    updatedAt: '2026-09-04 15:31:47',
    messages: [
      {
        id: 'msg_00301',
        role: 'user',
        content: '相似阈值和 TopK 应该怎么调？现在有些问题回答不出来。',
        createdAt: '2026-09-04 15:20:08',
        meta: { files: [] }
      },
      {
        id: 'msg_00302',
        role: 'assistant',
        content: `建议分场景调整：

| 场景 | 阈值 | Top K | Rerank |
| --- | --- | --- | --- |
| 通用问答 | 0.28 | 5 | 开启 |
| 长文档跨段推理 | 0.25 | 8 | 开启 |
| 条款精确匹配 | 0.35 | 3 | 关闭 |
| 型号 / 编号查询 | 0.22 | 8 | 开启 + 混合检索 |

低于阈值会直接返回兜底话术，避免模型编造，这是抑制幻觉的第一道防线。`,
        createdAt: '2026-09-04 15:21:15',
        sources: [
          { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 3, score: 0.95 },
          { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 1, score: 0.79 }
        ],
        meta: { model: 'qwen2.5-72b-instruct', elapsedMs: 1980, tokens: { prompt: 2100, completion: 520, total: 2620 } },
        feedback: 'like'
      },
      {
        id: 'msg_00303',
        role: 'user',
        content: '开启 Rerank 会增加多少延迟？',
        createdAt: '2026-09-04 15:30:12',
        meta: { files: [] }
      },
      {
        id: 'msg_00304',
        role: 'assistant',
        content: `实测开启 \`bge-reranker-large\` 后，端到端延迟增加约 **120ms**（P95），但长尾问题命中率从 78% 提升至 **94.3%**，整体性价比很高。

如果对延迟极度敏感，可以只对低于阈值的「边缘查询」启用 Rerank 二次确认，其余走向量直出。`,
        createdAt: '2026-09-04 15:31:47',
        sources: [
          { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 3, score: 0.92 },
          { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 2, score: 0.87 }
        ],
        meta: { model: 'qwen2.5-72b-instruct', elapsedMs: 1120, tokens: { prompt: 2980, completion: 260, total: 3240 } },
        feedback: null
      }
    ]
  },
  {
    id: 'conv_004',
    title: '退换货政策梳理（客服培训用）',
    kbIds: ['kb_003'],
    model: 'qwen2.5-72b-instruct',
    pinned: false,
    messageCount: 2,
    tokenUsed: 2240,
    createdAt: '2026-09-03 10:05:33',
    updatedAt: '2026-09-03 10:06:58',
    messages: [
      {
        id: 'msg_00401',
        role: 'user',
        content: '帮我整理一份客服可直接使用的退换货政策要点。',
        createdAt: '2026-09-03 10:05:33',
        meta: { files: [] }
      },
      {
        id: 'msg_00402',
        role: 'assistant',
        content: `### 7 天无理由退货
自签收次日起 7 日内可申请，商品需保持完好、配件齐全。定制类商品、已激活的软件授权、贴身类用品不支持。

### 质量问题换货
签收 15 日内非人为质量问题可免费换新，往返运费由平台承担；超过 15 日在保修期内按三包政策维修。需提供订单号与问题照片或视频。

### 退款时效
仓库验收合格后 1-3 个工作日原路退回；信用卡以发卡行规则为准，通常 3-7 个工作日。`,
        createdAt: '2026-09-03 10:06:58',
        sources: [
          { kbId: 'kb_003', docId: 'doc_3001', chunkIndex: 1, score: 0.95 },
          { kbId: 'kb_003', docId: 'doc_3001', chunkIndex: 2, score: 0.91 },
          { kbId: 'kb_003', docId: 'doc_3001', chunkIndex: 3, score: 0.85 }
        ],
        meta: { model: 'qwen2.5-72b-instruct', elapsedMs: 1560, tokens: { prompt: 1620, completion: 480, total: 2100 } },
        feedback: null
      }
    ]
  },
  {
    id: 'conv_005',
    title: '年假折算与跨年结转规则',
    kbIds: ['kb_002'],
    model: 'qwen2.5-32b-instruct',
    pinned: true,
    messageCount: 2,
    tokenUsed: 1720,
    createdAt: '2026-09-02 14:22:19',
    updatedAt: '2026-09-02 14:23:05',
    messages: [
      {
        id: 'msg_00501',
        role: 'user',
        content: '工作满 8 年，年假有几天？没休完能转到明年吗？',
        createdAt: '2026-09-02 14:22:19',
        meta: { files: [] }
      },
      {
        id: 'msg_00502',
        role: 'assistant',
        content: `累计工作满 1 年不满 10 年，年休假为 **5 天**。

关于结转：年假按自然年计算，最小使用单位 0.5 天，**原则上不跨年结转**；如因工作原因确实无法休完，经部门负责人审批后可延至次年 **3 月 31 日**，逾期自动清零。

建议你在 12 月前与主管确认休假计划，避免额度损失。`,
        createdAt: '2026-09-02 14:23:05',
        sources: [
          { kbId: 'kb_002', docId: 'doc_2001', chunkIndex: 2, score: 0.96 },
          { kbId: 'kb_002', docId: 'doc_2003', chunkIndex: 1, score: 0.72 }
        ],
        meta: { model: 'qwen2.5-32b-instruct', elapsedMs: 1180, tokens: { prompt: 1180, completion: 320, total: 1500 } },
        feedback: null
      }
    ]
  },
  {
    id: 'conv_006',
    title: '开放 API 鉴权与限流说明',
    kbIds: ['kb_001'],
    model: 'qwen2.5-72b-instruct',
    pinned: false,
    messageCount: 2,
    tokenUsed: 2680,
    createdAt: '2026-08-31 17:40:12',
    updatedAt: '2026-08-31 17:41:36',
    messages: [
      {
        id: 'msg_00601',
        role: 'user',
        content: '调用接口怎么鉴权？有限流吗？',
        createdAt: '2026-08-31 17:40:12',
        meta: { files: [] }
      },
      {
        id: 'msg_00602',
        role: 'assistant',
        content: `所有接口使用 **Bearer Token** 鉴权，请求头为 \`Authorization: Bearer <API_KEY>\`。API Key 在控制台「设置 → 密钥管理」创建，支持按知识库粒度授权与过期时间设置。

流式接口 \`POST /api/v1/chat/completions\`（\`stream=true\`）返回 SSE 事件流，事件类型包括 \`references\`、\`delta\`、\`done\`、\`error\`。

限流策略：免费版 5 QPS / 10 万 Token 每月；专业版 50 QPS / 500 万 Token 每月；企业版默认 200 QPS 可自定义。触发限流返回 \`429\` 并携带 \`Retry-After\`。`,
        createdAt: '2026-08-31 17:41:36',
        sources: [
          { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 1, score: 0.9 },
          { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 2, score: 0.94 },
          { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 3, score: 0.83 }
        ],
        meta: { model: 'qwen2.5-72b-instruct', elapsedMs: 1420, tokens: { prompt: 1980, completion: 460, total: 2440 } },
        feedback: null
      }
    ]
  }
]

/** 新建会话时的默认标题 */
export const DEFAULT_CONVERSATION_TITLE = '新对话'
