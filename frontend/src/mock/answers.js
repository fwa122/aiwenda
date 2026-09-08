/**
 * 问答语料模拟数据
 * 说明：用于模拟「检索 + 生成」两段式回答。
 *   keywords   命中关键词（包含即视为匹配）
 *   answer     回答正文（Markdown）
 *   sources    引用来源，指向 mock/knowledge.js 中的具体切片
 */

export const mockAnswers = [
  {
    id: 'qa_quickstart',
    keywords: ['接入', '快速开始', '怎么用', '如何开始', '上手', '使用步骤'],
    answer: `接入 AI 知识库问答平台只需三步，整体耗时约 10 分钟：

### 1. 创建知识库
在控制台「知识库管理 → 新建知识库」中填写名称，并选择 Embedding 模型（中文场景推荐 \`bge-large-zh-v1.5\`）。模型一旦确定，后续更换需要重建索引。

### 2. 上传并解析文档
支持三种导入方式：

- **手动上传**：拖拽 PDF / Word / Excel / PPT / Markdown / TXT，单文件不超过 100 MB
- **对象存储挂载**：配置 OSS / S3 / MinIO 目录，系统定时增量同步
- **API 推送**：调用 \`POST /api/v1/knowledge/{kbId}/documents\` 批量入库

解析耗时参考：100 页 PDF 约 45 秒；1 万条切片在单卡 A10 上向量化约 3 分钟。

### 3. 验证召回并发布
先在知识库「检索测试」中输入典型问题，确认 Top 5 片段均能命中；若命中不佳，可下调相似度阈值或开启混合检索与 Rerank 精排。验证通过后即可发布为问答助手。

> 提示：Web 助手支持 iframe 与 Web Component 两种嵌入方式，5 行代码即可完成接入。`,
    sources: [
      { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 1, score: 0.93 },
      { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 2, score: 0.88 },
      { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 3, score: 0.81 }
    ]
  },
  {
    id: 'qa_format',
    keywords: ['格式', '支持哪些', '上传', 'pdf', 'word', 'excel', 'ppt', 'ocr', '扫描'],
    answer: `平台共支持 **12 种** 文档格式，解析策略自动识别：

| 格式 | 支持情况 | 说明 |
| --- | --- | --- |
| PDF | ✅ 完整支持 | 版式 PDF 直接抽取文本，扫描件自动启用 OCR（PaddleOCR 中文模型） |
| Word（.doc/.docx） | ✅ 完整支持 | 保留标题层级、列表、表格结构 |
| Excel（.xlsx/.csv） | ✅ 完整支持 | 按行切片，表头自动复用到每个切片 |
| PPT（.pptx） | ✅ 完整支持 | 按页切片，备注内容一并入库 |
| Markdown / TXT | ✅ 完整支持 | 按标题层级智能切分 |
| HTML | ✅ 完整支持 | 抽取正文，剔除导航与广告 |
| 图片（.png/.jpg） | ⚠️ 仅 OCR | 不做版式还原 |

切片建议：

- 长文档：\`chunk_size=512\`、\`overlap=64\`
- FAQ / 条款类短文本：\`chunk_size=256\`、\`overlap=32\`
- 表格密集型：使用「智能解析」并关闭跨表格合并`,
    sources: [
      { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 2, score: 0.92 },
      { kbId: 'kb_001', docId: 'doc_1002', chunkIndex: 2, score: 0.84 },
      { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 1, score: 0.72 }
    ]
  },
  {
    id: 'qa_retrieval',
    keywords: ['检索', '召回', '相似度', 'topk', 'top_k', '阈值', '向量', 'rag', '原理', '流程'],
    answer: `系统采用「**向量召回 + BM25 关键词召回 + Rerank 精排**」的三段式检索链路：

\`\`\`text
用户提问
   ├─► Embedding 向量化 ──► 向量库召回 Top 50
   ├─► 分词 BM25      ──► 关键词召回 Top 50
   └─► 合并去重 ──► bge-reranker-large 精排 ──► Top 5 ──► 大模型生成
\`\`\`

### 关键参数建议

1. **Top K**：默认 5。知识库文档较短时可降到 3，长文档或跨文档推理建议 6~8
2. **相似度阈值**：默认 \`0.28\`。低于该值判定为「知识库无相关内容」，直接走兜底话术，避免模型编造
3. **Rerank**：强烈建议开启，实测将长尾问题命中率从 **78% 提升至 94.3%**
4. **混合检索**：专业术语、型号、编号类问题建议开启，能显著缓解纯向量的语义漂移

### 效果不佳时的排查顺序

- 在「检索测试」中确认问题是否被正确召回
- 检查文档是否完成向量化（状态为「已解析」）
- 下调阈值或开启 Rerank
- 清理重复、过期文档，为条款类内容补充标题层级`,
    sources: [
      { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 3, score: 0.95 },
      { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 2, score: 0.87 },
      { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 1, score: 0.79 },
      { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 2, score: 0.66 }
    ]
  },
  {
    id: 'qa_api',
    keywords: ['api', '接口', 'token', '调用', '鉴权', '限流', 'sse', '流式'],
    answer: `所有接口使用 **Bearer Token** 鉴权：

\`\`\`bash
curl -X POST https://api.example.com/api/v1/chat/completions \\
  -H "Authorization: Bearer \$KB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "kb_ids": ["kb_001"],
    "question": "支持哪些文档格式？",
    "stream": true
  }'
\`\`\`

流式（\`stream=true\`）返回 SSE 事件流，事件类型如下：

| 事件 | 说明 |
| --- | --- |
| \`references\` | 检索到的引用来源列表，在正文之前返回 |
| \`delta\` | 增量文本片段 |
| \`done\` | 结束事件，携带 token 用量与耗时 |
| \`error\` | 错误事件 |

限流策略：免费版 5 QPS / 10 万 Token 每月；专业版 50 QPS / 500 万 Token 每月；企业版默认 200 QPS 可自定义。触发限流返回 \`429\`，响应头 \`Retry-After\` 给出建议重试间隔。`,
    sources: [
      { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 1, score: 0.9 },
      { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 2, score: 0.94 },
      { kbId: 'kb_001', docId: 'doc_1003', chunkIndex: 3, score: 0.83 }
    ]
  },
  {
    id: 'qa_reimburse',
    keywords: ['报销', '差旅', '发票', '费用', '住宿标准', '餐补'],
    answer: `### 差旅标准

| 城市级别 | 住宿上限 | 市内交通 | 餐补 |
| --- | --- | --- | --- |
| 一线城市 | 600 元/晚 | 凭票实报实销 | 100 元/天（包干） |
| 二线城市 | 450 元/晚 | 凭票实报实销 | 100 元/天（包干） |
| 其他城市 | 350 元/晚 | 凭票实报实销 | 100 元/天（包干） |

### 报销时限与审批

- 费用发生后 **30 个自然日**内提交，跨年度费用须在次年 1 月 10 日前提交完毕
- 单笔 > 5000 元：需附部门负责人审批单
- 单笔 > 20000 元：需分管副总审批

### 发票要求

1. 增值税发票需为公司全称与税号
2. 电子发票需在系统中做查重校验，重复发票将被驳回
3. 开票内容与实际业务不符的不予报销
4. 审批通过后 **5 个工作日内**到账

> 出差前请在 OA 提交出差申请，未提交申请的费用原则上不予报销。`,
    sources: [
      { kbId: 'kb_002', docId: 'doc_2002', chunkIndex: 1, score: 0.94 },
      { kbId: 'kb_002', docId: 'doc_2002', chunkIndex: 2, score: 0.9 },
      { kbId: 'kb_002', docId: 'doc_2002', chunkIndex: 3, score: 0.86 },
      { kbId: 'kb_004', docId: 'doc_4001', chunkIndex: 2, score: 0.61 }
    ]
  },
  {
    id: 'qa_leave',
    keywords: ['年假', '假期', '考勤', '请假', '病假', '加班', '调休', '打卡'],
    answer: `### 年假

| 累计工龄 | 年休假天数 |
| --- | --- |
| 满 1 年不满 10 年 | 5 天 |
| 满 10 年不满 20 年 | 10 天 |
| 满 20 年及以上 | 15 天 |

年假按自然年计算，最小使用单位 0.5 天，原则上不跨年结转；特殊情况经部门负责人审批可延至次年 **3 月 31 日**。

### 其他假期

- **病假**：需二级及以上医院证明，全年累计 10 天内按 80% 计发薪资
- **事假**：不计薪，单次不超过 3 天，全年累计不超过 15 天
- **调休**：工作日加班按 1.5 倍折算，休息日 2 倍，法定节假日 3 倍；须在 6 个月内使用完毕

### 考勤

每日需完成上下班两次打卡。忘记打卡可在 3 个工作日内发起补卡，每月不超过 3 次。迟到 30 分钟以内记为迟到，超过 30 分钟按半天事假处理。`,
    sources: [
      { kbId: 'kb_002', docId: 'doc_2001', chunkIndex: 2, score: 0.96 },
      { kbId: 'kb_002', docId: 'doc_2003', chunkIndex: 1, score: 0.89 },
      { kbId: 'kb_002', docId: 'doc_2001', chunkIndex: 3, score: 0.84 },
      { kbId: 'kb_002', docId: 'doc_2003', chunkIndex: 2, score: 0.77 }
    ]
  },
  {
    id: 'qa_refund',
    keywords: ['退货', '换货', '退款', '无理由', '售后', '三包'],
    answer: `### 7 天无理由退货

自签收次日起 **7 日内**可申请，商品需保持完好、配件齐全、不影响二次销售。

不支持无理由退货的情形：定制类商品、已激活的软件授权、贴身类用品。

### 质量问题换货

- 签收 **15 日内**出现非人为质量问题：免费换新，往返运费由平台承担
- 超过 15 日但在保修期内：按三包政策维修
- 需提供订单号与问题照片或视频

### 退款时效

仓库验收合格后 **1-3 个工作日**原路退回；信用卡退款到账时间以发卡行规则为准，通常为 3-7 个工作日。

> 提示：若超过承诺时效仍未到账，可提供订单号联系在线客服加急处理。`,
    sources: [
      { kbId: 'kb_003', docId: 'doc_3001', chunkIndex: 1, score: 0.95 },
      { kbId: 'kb_003', docId: 'doc_3001', chunkIndex: 2, score: 0.91 },
      { kbId: 'kb_003', docId: 'doc_3001', chunkIndex: 3, score: 0.85 },
      { kbId: 'kb_003', docId: 'doc_3003', chunkIndex: 1, score: 0.63 }
    ]
  },
  {
    id: 'qa_security',
    keywords: ['安全', '权限', '加密', '私有化', '合规', '数据分级', '审计'],
    answer: `### 部署形态

- **私有化部署**：完全内网离线运行，支持信创环境（鲲鹏 / 昇腾）
- **混合云**：文档与向量数据留在本地，仅推理请求上云

### 权限与审计

- 字段级权限：可按知识库 / 文档 / 标签三种粒度授权，支持继承与例外
- 问答审计日志留存 **180 天**，支持按用户、时间、关键词检索与导出
- 传输层 TLS 1.3 加密，存储层 AES-256 加密

### 数据分级

| 级别 | 访问要求 |
| --- | --- |
| 公开 | 全员可见 |
| 内部 | 登录用户可见 |
| 机密 | 禁止出境，需双人授权并留存审计日志 |
| 绝密 | 仅可通过堡垒机访问，禁止下载与截屏 |

个人信息处理遵循最小必要原则，完成 PIA 后方可上线，留存期限届满后 30 日内删除或匿名化。`,
    sources: [
      { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 4, score: 0.93 },
      { kbId: 'kb_004', docId: 'doc_4002', chunkIndex: 1, score: 0.9 },
      { kbId: 'kb_004', docId: 'doc_4002', chunkIndex: 2, score: 0.82 },
      { kbId: 'kb_003', docId: 'doc_3004', chunkIndex: 1, score: 0.58 }
    ]
  },
  {
    id: 'qa_accuracy',
    keywords: ['准确率', '优化', '提升', '幻觉', '回答不准', '效果', '调参'],
    answer: `按投入产出比排序，建议按以下四步优化：

1. **数据治理（收益最高）**
   清理重复、过期、低质量文档；为表格与条款补充标题层级；删除页眉页脚水印等噪声。
2. **开启 Rerank 精排**
   长尾问题命中率可由 78% 提升至 94.3%，代价是增加约 120ms 延迟。
3. **调整检索参数**
   阈值 \`0.28\` → \`0.22\`，Top K \`5\` → \`8\`，并开启混合检索以覆盖型号、编号类查询。
4. **优化提示词模板**
   在模板中补充领域术语表、回答格式要求与「无依据时明确说明不知道」的兜底约束。

### 抑制幻觉的三道防线

- 检索层：低于相似度阈值直接返回兜底话术
- 生成层：强制引用来源编号，未被引用的片段不进入上下文
- 展示层：回答下方展示引用片段与相似度，用户可一键核对原文`,
    sources: [
      { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 2, score: 0.92 },
      { kbId: 'kb_001', docId: 'doc_1001', chunkIndex: 3, score: 0.88 },
      { kbId: 'kb_001', docId: 'doc_1004', chunkIndex: 1, score: 0.8 }
    ]
  }
]

/** 无匹配语料时的兜底回答模板 */
export const fallbackAnswer = (question, hitCount) => {
  if (hitCount === 0) {
    return `抱歉，我在已选知识库中**未检索到相关内容**，无法给出可靠回答。

你可以尝试：

1. 换一种表述或使用更具体的关键词
2. 确认所选知识库是否正确（右上角可切换知识库）
3. 在「知识库管理 → 检索测试」中核对召回情况，必要时下调相似度阈值
4. 若确认资料缺失，请先上传相关文档并完成向量化

> 为避免误导，我不会在缺少依据时生成答案。如需人工协助，可提交工单联系知识库管理员。`
  }
  return `针对你的问题「${question}」，我检索到 ${hitCount} 个相关片段，但相关性偏低（均低于置信阈值）。以下是片段要点，供你参考：

- 片段内容可能与问题属于同一主题但不完全匹配，建议细化提问
- 可在「检索测试」中查看完整片段原文并调整召回参数
- 如仍不满意，建议在对应知识库中补充更细粒度的文档

> 提示：回答依据不足时你也可以上传新文档后重新提问。`
}

/** 首页推荐问题 */
export const mockSuggestedQuestions = [
  { title: '如何快速接入平台', desc: '三步完成知识库搭建与助手发布', icon: 'Rocket' },
  { title: '支持哪些文档格式', desc: '12 种格式解析能力与切片建议', icon: 'Document' },
  { title: '检索原理与参数怎么调', desc: '向量召回、Rerank 与阈值配置', icon: 'Search' },
  { title: '差旅报销标准是什么', desc: '住宿上限、餐补与报销时限', icon: 'Money' },
  { title: '年假和调休规则', desc: '假期天数、折算与有效期', icon: 'Calendar' },
  { title: '如何提升回答准确率', desc: '数据治理、精排与提示词优化', icon: 'TrendCharts' }
]

/** 提问引导词（输入框下方快捷标签） */
export const mockQuickPrompts = [
  '用一句话总结要点',
  '列出操作步骤',
  '生成对比表格',
  '说明注意事项',
  '给出示例'
]
