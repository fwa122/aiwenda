/**
 * 知识库 / 文档 / 切片 模拟数据
 * 结构说明：
 *   knowledgeBase.docs[]          文档列表（解析状态、切片数、页数等）
 *   knowledgeBase.docs[].chunks[] 文档切片（用于检索测试、引用来源定位）
 */

export const mockKnowledgeBases = [
  {
    id: 'kb_001',
    name: '产品与研发文档中心',
    description: '包含产品白皮书、接入指南、API 说明与版本变更记录，用于支撑研发与售前问答。',
    icon: 'Collection',
    color: '#3f6ae1',
    status: 'ready', // ready | indexing | draft
    docCount: 5,
    chunkCount: 486,
    totalSize: 18.6 * 1024 * 1024,
    embeddingModel: 'bge-large-zh-v1.5',
    vectorDim: 1024,
    vectorStore: 'milvus',
    chunkSize: 512,
    chunkOverlap: 64,
    parser: 'smart',
    retriever: { topK: 5, threshold: 0.28, rerank: true, rerankModel: 'bge-reranker-large', hybrid: true },
    llm: { provider: 'qwen', model: 'qwen2.5-72b-instruct', temperature: 0.3 },
    visibility: 'internal',
    owner: '平台研发部',
    memberCount: 24,
    createdAt: '2026-01-06 09:30:00',
    updatedAt: '2026-09-04 17:20:00',
    stats: { weekQuestions: 862, hitRate: 0.943, avgLatency: 1420 },
    docs: [
      {
        id: 'doc_1001',
        name: 'AI 知识库平台产品白皮书 v2.3.pdf',
        type: 'pdf',
        size: 5.4 * 1024 * 1024,
        pages: 32,
        chunkCount: 168,
        status: 'parsed',
        progress: 100,
        version: 'v2.3',
        uploader: '李娜',
        createdAt: '2026-01-06 09:30:00',
        updatedAt: '2026-08-28 10:12:00',
        chunks: [
          { id: 'ck_100101', index: 1, page: 4, charCount: 486, content: 'AI 知识库平台面向企业提供一站式文档接入、向量化检索与大模型问答能力，支持私有化部署与混合云部署两种形态。平台由文档解析服务、向量检索服务、推理网关与运营控制台四部分组成。' },
          { id: 'ck_100102', index: 2, page: 6, charCount: 512, content: '平台支持 PDF、Word、Excel、PPT、Markdown、TXT、HTML 等 12 种格式解析；对扫描件自动启用 OCR（内置 PaddleOCR 中文模型），表格与图片内容会转换为结构化 Markdown 后入库。' },
          { id: 'ck_100103', index: 3, page: 11, charCount: 498, content: '检索链路采用「向量召回 + BM25 关键词召回 + Rerank 精排」三段式：先用向量与关键词各召回 Top 50，再由 bge-reranker-large 重排取 Top 5 送入大模型，实测将长尾问题命中率从 78% 提升至 94.3%。' },
          { id: 'ck_100104', index: 4, page: 19, charCount: 470, content: '安全方面，平台提供字段级权限（按知识库 / 文档 / 标签授权）、问答审计日志留存 180 天、传输层 TLS 1.3 加密、存储层 AES-256 加密，并支持完全内网离线的私有化部署方案。' }
        ]
      },
      {
        id: 'doc_1002',
        name: '快速接入指南.docx',
        type: 'docx',
        size: 1.2 * 1024 * 1024,
        pages: 12,
        chunkCount: 62,
        status: 'parsed',
        progress: 100,
        version: 'v1.8',
        uploader: '王强',
        createdAt: '2026-02-14 14:05:00',
        updatedAt: '2026-09-01 09:40:00',
        chunks: [
          { id: 'ck_100201', index: 1, page: 2, charCount: 442, content: '接入仅需三步：1）在控制台创建知识库并选择 Embedding 模型；2）上传文档或通过 S3 / OSS / WebDAV 挂载目录；3）在「检索测试」中验证召回效果后发布为问答助手。' },
          { id: 'ck_100202', index: 2, page: 5, charCount: 476, content: '文档解析耗时参考：100 页 PDF 约 45 秒完成解析与切片；1 万条切片向量化在单卡 A10 上约需 3 分钟。切片参数建议 chunk_size=512、overlap=64；FAQ 类短文本建议 chunk_size=256。' },
          { id: 'ck_100203', index: 3, page: 8, charCount: 430, content: '问答助手可通过 Web 组件、REST API 与企业微信 / 飞书 /钉钉机器人三种方式集成。Web 组件支持 iframe 与 Web Component 两种嵌入方式，5 行代码即可完成接入。' }
        ]
      },
      {
        id: 'doc_1003',
        name: '开放 API 接口说明.pdf',
        type: 'pdf',
        size: 3.1 * 1024 * 1024,
        pages: 26,
        chunkCount: 142,
        status: 'parsed',
        progress: 100,
        version: 'v3.1',
        uploader: '陈昊',
        createdAt: '2026-03-02 11:20:00',
        updatedAt: '2026-09-03 15:26:00',
        chunks: [
          { id: 'ck_100301', index: 1, page: 3, charCount: 452, content: '所有接口使用 Bearer Token 鉴权，请求头 Authorization: Bearer <API_KEY>。API Key 在控制台「设置 - 密钥管理」中创建，支持按知识库粒度授权与过期时间设置。' },
          { id: 'ck_100302', index: 2, page: 7, charCount: 468, content: 'POST /api/v1/chat/completions 为流式对话接口，兼容 OpenAI 协议，参数 stream=true 时返回 SSE（text/event-stream）。事件类型包括 delta（增量文本）、references（引用来源）、done（结束，携带 token 用量）。' },
          { id: 'ck_100303', index: 3, page: 12, charCount: 424, content: '限流策略：免费版 5 QPS / 10 万 Token 每月；专业版 50 QPS / 500 万 Token 每月；企业版可自定义，默认 200 QPS。触发限流返回 429 并携带 Retry-After 响应头。' }
        ]
      },
      {
        id: 'doc_1004',
        name: '常见问题 FAQ.md',
        type: 'md',
        size: 86 * 1024,
        pages: 8,
        chunkCount: 74,
        status: 'parsed',
        progress: 100,
        version: 'v2.0',
        uploader: '李娜',
        createdAt: '2026-04-18 16:45:00',
        updatedAt: '2026-09-04 17:20:00',
        chunks: [
          { id: 'ck_100401', index: 1, page: 1, charCount: 380, content: 'Q：为什么回答没有引用来源？A：通常命中率低于阈值（默认 0.28）或知识库中确实无相关内容。可在「检索测试」中下调阈值或改用混合检索，并确认文档已完成向量化。' },
          { id: 'ck_100402', index: 2, page: 3, charCount: 396, content: 'Q：如何提升回答准确率？A：四步优化：1）清理低质量文档与重复内容；2）为表格、条款类内容补充标题层级；3）開啟 Rerank 精排；4）在提示词模板中补充领域术语与回答格式要求。' },
          { id: 'ck_100403', index: 3, page: 6, charCount: 412, content: 'Q：支持多语言吗？A：平台支持中、英、日、韩等 20+ 语言问答。中文场景推荐 bge-large-zh-v1.5，多语场景推荐 bge-m3，切换 Embedding 模型后需对全库重建索引。' }
        ]
      },
      {
        id: 'doc_1005',
        name: '版本变更日志.txt',
        type: 'txt',
        size: 24 * 1024,
        pages: 6,
        chunkCount: 40,
        status: 'parsed',
        progress: 100,
        version: 'v2.3.4',
        uploader: '陈昊',
        createdAt: '2026-05-09 10:00:00',
        updatedAt: '2026-09-04 11:08:00',
        chunks: [
          { id: 'ck_100501', index: 1, page: 1, charCount: 320, content: 'v2.3.4（2026-09-04）：修复长文档切片越界问题；优化流式输出首字延迟（P95 从 1.8s 降至 1.1s）；检索测试支持按文档过滤。' },
          { id: 'ck_100502', index: 2, page: 3, charCount: 336, content: 'v2.3.0（2026-08-12）：新增混合检索（向量 + BM25）与 Rerank 开关；新增引用来源高亮定位；知识库支持标签分组与批量导入。' }
        ]
      }
    ]
  },
  {
    id: 'kb_002',
    name: '人事行政制度库',
    description: '员工手册、考勤假期、差旅报销等内部制度，供全员自助查询。',
    icon: 'User',
    color: '#18a058',
    status: 'ready',
    docCount: 3,
    chunkCount: 212,
    totalSize: 6.8 * 1024 * 1024,
    embeddingModel: 'bge-large-zh-v1.5',
    vectorDim: 1024,
    vectorStore: 'milvus',
    chunkSize: 512,
    chunkOverlap: 64,
    parser: 'smart',
    retriever: { topK: 4, threshold: 0.3, rerank: true, rerankModel: 'bge-reranker-large', hybrid: false },
    llm: { provider: 'qwen', model: 'qwen2.5-32b-instruct', temperature: 0.2 },
    visibility: 'internal',
    owner: '人力资源部',
    memberCount: 312,
    createdAt: '2026-02-20 09:00:00',
    updatedAt: '2026-09-02 16:30:00',
    stats: { weekQuestions: 546, hitRate: 0.912, avgLatency: 1230 },
    docs: [
      {
        id: 'doc_2001',
        name: '员工手册 2026 版.pdf',
        type: 'pdf',
        size: 3.6 * 1024 * 1024,
        pages: 48,
        chunkCount: 118,
        status: 'parsed',
        progress: 100,
        version: '2026',
        uploader: '刘敏',
        createdAt: '2026-02-20 09:00:00',
        updatedAt: '2026-08-15 14:00:00',
        chunks: [
          { id: 'ck_200101', index: 1, page: 8, charCount: 458, content: '工作时间：公司实行标准工时制，周一至周五 09:00-18:00，弹性上班区间为 08:30-09:30，午休 12:00-13:00。研发岗位可申请远程办公，每月不超过 4 天，需提前在 OA 提交申请。' },
          { id: 'ck_200102', index: 2, page: 15, charCount: 476, content: '年假规则：累计工作满 1 年不满 10 年，年休假 5 天；满 10 年不满 20 年，年休假 10 天；满 20 年，年休假 15 天。年假按自然年计算，可拆分使用，最小单位 0.5 天，原则上不跨年结转，特殊情况经部门负责人审批可延至次年 3 月 31 日。' },
          { id: 'ck_200103', index: 3, page: 22, charCount: 442, content: '病假：需提供二级及以上医院证明，全年累计 10 天内按 80% 计发薪资，超过部分按当地最低工资标准的 80% 计发。事假不计薪，单次不超过 3 天，全年累计不超过 15 天。' }
        ]
      },
      {
        id: 'doc_2002',
        name: '差旅报销规范.docx',
        type: 'docx',
        size: 1.1 * 1024 * 1024,
        pages: 14,
        chunkCount: 52,
        status: 'parsed',
        progress: 100,
        version: 'v3.2',
        uploader: '刘敏',
        createdAt: '2026-03-05 10:30:00',
        updatedAt: '2026-09-02 16:30:00',
        chunks: [
          { id: 'ck_200201', index: 1, page: 2, charCount: 468, content: '差旅标准：一线城市住宿每晚不超过 600 元，二线城市 450 元，其他城市 350 元；市内交通凭票实报实销，餐补按 100 元/天包干，不需提供发票。' },
          { id: 'ck_200202', index: 2, page: 5, charCount: 452, content: '报销时限：费用发生后 30 个自然日内提交，跨年度费用须在次年 1 月 10 日前提交完毕。单笔超过 5000 元需附部门负责人审批单，超过 20000 元需分管副总审批。' },
          { id: 'ck_200203', index: 3, page: 9, charCount: 430, content: '发票要求：增值税发票需为公司全称与税号；电子发票需在系统中做查重校验，重复发票将被驳回；开票内容与实际业务不符的不予报销。审批通过后 5 个工作日内到账。' }
        ]
      },
      {
        id: 'doc_2003',
        name: '考勤与假期管理办法.pdf',
        type: 'pdf',
        size: 2.1 * 1024 * 1024,
        pages: 20,
        chunkCount: 42,
        status: 'parsed',
        progress: 100,
        version: 'v2.6',
        uploader: '周涛',
        createdAt: '2026-04-01 08:20:00',
        updatedAt: '2026-07-22 09:15:00',
        chunks: [
          { id: 'ck_200301', index: 1, page: 4, charCount: 424, content: '考勤打卡：每日需完成上下班两次打卡，忘记打卡可在 3 个工作日内发起补卡申请，每月补卡不超过 3 次。迟到 30 分钟以内记为迟到，超过 30 分钟按半天事假处理。' },
          { id: 'ck_200302', index: 2, page: 10, charCount: 410, content: '加班与调休：工作日加班按 1.5 倍折算调休，休息日按 2 倍，法定节假日按 3 倍。调休需在加班发生后 6 个月内使用完毕，逾期自动清零。' }
        ]
      }
    ]
  },
  {
    id: 'kb_003',
    name: '客户服务知识库',
    description: '客服话术、退换货政策、投诉处理流程与 SLA 约定，用于一线坐席辅助。',
    icon: 'Service',
    color: '#e37318',
    status: 'ready',
    docCount: 4,
    chunkCount: 356,
    totalSize: 9.4 * 1024 * 1024,
    embeddingModel: 'bge-m3',
    vectorDim: 1024,
    vectorStore: 'pgvector',
    chunkSize: 384,
    chunkOverlap: 48,
    parser: 'smart',
    retriever: { topK: 6, threshold: 0.25, rerank: true, rerankModel: 'bge-reranker-large', hybrid: true },
    llm: { provider: 'qwen', model: 'qwen2.5-72b-instruct', temperature: 0.4 },
    visibility: 'internal',
    owner: '客户成功部',
    memberCount: 86,
    createdAt: '2026-03-18 13:00:00',
    updatedAt: '2026-09-05 08:50:00',
    stats: { weekQuestions: 1284, hitRate: 0.896, avgLatency: 1580 },
    docs: [
      {
        id: 'doc_3001',
        name: '退换货政策.md',
        type: 'md',
        size: 64 * 1024,
        pages: 6,
        chunkCount: 48,
        status: 'parsed',
        progress: 100,
        version: 'v4.1',
        uploader: '孙悦',
        createdAt: '2026-03-18 13:00:00',
        updatedAt: '2026-09-05 08:50:00',
        chunks: [
          { id: 'ck_300101', index: 1, page: 1, charCount: 396, content: '7 天无理由退货：自签收次日起 7 日内可申请，商品需保持完好、配件齐全、不影响二次销售。定制类商品、已激活的软件授权、贴身类用品不支持无理由退货。' },
          { id: 'ck_300102', index: 2, page: 2, charCount: 418, content: '质量问题换货：签收 15 日内出现非人为质量问题，可申请免费换新并承担往返运费；超过 15 日在保修期内按三包政策维修。需提供订单号与问题照片或视频。' },
          { id: 'ck_300103', index: 3, page: 4, charCount: 372, content: '退款时效：仓库验收合格后 1-3 个工作日原路退回，信用卡退款到账时间以发卡行规则为准，通常为 3-7 个工作日。' }
        ]
      },
      {
        id: 'doc_3002',
        name: '客服话术标准.docx',
        type: 'docx',
        size: 0.9 * 1024 * 1024,
        pages: 18,
        chunkCount: 96,
        status: 'parsed',
        progress: 100,
        version: 'v2.4',
        uploader: '孙悦',
        createdAt: '2026-04-02 10:10:00',
        updatedAt: '2026-08-30 11:20:00',
        chunks: [
          { id: 'ck_300201', index: 1, page: 2, charCount: 404, content: '开场话术：您好，这里是 XX 客户服务中心，工号 88xx 为您服务。请先核实客户身份（订单号 / 手机号后四位），再进入问题处理流程。' },
          { id: 'ck_300202', index: 2, page: 7, charCount: 430, content: '安抚话术：遇到情绪激动的客户，先共情再处理，使用「非常理解您的心情，我这边马上为您核实处理」。禁止与客户争辩，禁止承诺超出政策范围的补偿。' },
          { id: 'ck_300203', index: 3, page: 12, charCount: 388, content: '结束语：确认问题解决后，主动告知后续流程与时效，并邀请评价。「请问还有其他可以帮您的吗？感谢您的来电，祝您生活愉快。」' }
        ]
      },
      {
        id: 'doc_3003',
        name: '客户投诉处理流程.pdf',
        type: 'pdf',
        size: 2.4 * 1024 * 1024,
        pages: 22,
        chunkCount: 118,
        status: 'parsed',
        progress: 100,
        version: 'v1.9',
        uploader: '林可',
        createdAt: '2026-05-11 15:40:00',
        updatedAt: '2026-08-19 09:05:00',
        chunks: [
          { id: 'ck_300301', index: 1, page: 3, charCount: 446, content: '投诉分级：一般投诉（P3）4 小时内响应、24 小时内解决；严重投诉（P2）30 分钟内响应、8 小时内解决；重大投诉（P1）15 分钟内上报至客户成功总监，2 小时内给出解决方案。' },
          { id: 'ck_300302', index: 2, page: 9, charCount: 412, content: '处理步骤：1）记录工单并定级；2）核实事实（订单、物流、通话录音）；3）给出方案并与客户确认；4）闭环回访；5）周会复盘归类至知识库，避免同类问题重复发生。' }
        ]
      },
      {
        id: 'doc_3004',
        name: '服务水平协议 SLA.pdf',
        type: 'pdf',
        size: 1.6 * 1024 * 1024,
        pages: 16,
        chunkCount: 94,
        status: 'parsing',
        progress: 62,
        version: 'v3.0',
        uploader: '林可',
        createdAt: '2026-06-01 09:00:00',
        updatedAt: '2026-09-05 09:30:00',
        chunks: [
          { id: 'ck_300401', index: 1, page: 2, charCount: 402, content: '可用性承诺：标准版月度可用性不低于 99.5%，企业版不低于 99.9%。未达标按月度服务费的 10%（99.0%-99.5% 区间）或 30%（低于 99.0%）进行服务 credits 补偿。' },
          { id: 'ck_300402', index: 2, page: 6, charCount: 384, content: '响应时间：在线客服工作日 09:00-21:00 首次响应不超过 60 秒；工单渠道 7×24 受理，非工作时间 30 分钟内响应。' }
        ]
      }
    ]
  },
  {
    id: 'kb_004',
    name: '财务与合规库',
    description: '费用报销、预算制度、数据安全合规与供应商管理规范。',
    icon: 'Lock',
    color: '#8f959e',
    status: 'indexing',
    docCount: 3,
    chunkCount: 168,
    totalSize: 12.2 * 1024 * 1024,
    embeddingModel: 'bge-m3',
    vectorDim: 1024,
    vectorStore: 'milvus',
    chunkSize: 512,
    chunkOverlap: 64,
    parser: 'smart',
    retriever: { topK: 5, threshold: 0.32, rerank: false, rerankModel: '', hybrid: false },
    llm: { provider: 'glm', model: 'glm-4-plus', temperature: 0.1 },
    visibility: 'private',
    owner: '财务部',
    memberCount: 9,
    createdAt: '2026-07-08 14:00:00',
    updatedAt: '2026-09-05 09:40:00',
    stats: { weekQuestions: 132, hitRate: 0.874, avgLatency: 1310 },
    docs: [
      {
        id: 'doc_4001',
        name: '费用报销与预算管理制度.pdf',
        type: 'pdf',
        size: 4.8 * 1024 * 1024,
        pages: 30,
        chunkCount: 96,
        status: 'parsed',
        progress: 100,
        version: 'v5.0',
        uploader: '赵倩',
        createdAt: '2026-07-08 14:00:00',
        updatedAt: '2026-08-25 16:10:00',
        chunks: [
          { id: 'ck_400101', index: 1, page: 4, charCount: 428, content: '预算编制：各部门于每年 11 月 30 日前提交下一年度预算，财务部 12 月 20 日前完成汇总与平衡，经预算委员会审批后下发执行。季度预算调整幅度超过 10% 需重新审批。' },
          { id: 'ck_400102', index: 2, page: 11, charCount: 436, content: '审批权限：部门经理审批上限 5000 元，总监 20000 元，分管副总 100000 元，超过 100000 元须经 CEO 与 CFO 双签。同一供应商连续 12 个月累计付款超过 500 万元需启动招标流程。' }
        ]
      },
      {
        id: 'doc_4002',
        name: '数据安全合规白皮书.pdf',
        type: 'pdf',
        size: 6.1 * 1024 * 1024,
        pages: 44,
        chunkCount: 62,
        status: 'indexing',
        progress: 45,
        version: 'v1.4',
        uploader: '赵倩',
        createdAt: '2026-08-02 09:20:00',
        updatedAt: '2026-09-05 09:40:00',
        chunks: [
          { id: 'ck_400201', index: 1, page: 6, charCount: 452, content: '数据分级：分为公开、内部、机密、绝密四级。机密及以上数据禁止出境，访问需双人授权并留存审计日志；绝密数据仅可通过堡垒机访问，禁止下载与截屏。' },
          { id: 'ck_400202', index: 2, page: 18, charCount: 440, content: '个人信息处理遵循最小必要原则，完成 PIA（个人信息影响评估）后方可上线；留存期限届满后 30 日内完成删除或匿名化，删除操作需留存凭证。' }
        ]
      },
      {
        id: 'doc_4003',
        name: '供应商管理规范.docx',
        type: 'docx',
        size: 1.3 * 1024 * 1024,
        pages: 10,
        chunkCount: 10,
        status: 'failed',
        progress: 0,
        version: 'v2.1',
        uploader: '吴磊',
        createdAt: '2026-08-20 11:00:00',
        updatedAt: '2026-08-20 11:06:00',
        errorMsg: '文档加密，无法解析，请上传未加密版本',
        chunks: []
      }
    ]
  }
]

/** 文档类型映射（图标 / 颜色 / 名称） */
export const docTypeMap = {
  pdf: { label: 'PDF', color: '#e34d59', icon: 'Document' },
  docx: { label: 'Word', color: '#3f6ae1', icon: 'Document' },
  doc: { label: 'Word', color: '#3f6ae1', icon: 'Document' },
  xlsx: { label: 'Excel', color: '#18a058', icon: 'Tickets' },
  pptx: { label: 'PPT', color: '#e37318', icon: 'DataBoard' },
  md: { label: 'Markdown', color: '#646a73', icon: 'EditPen' },
  txt: { label: 'TXT', color: '#8f959e', icon: 'Document' },
  html: { label: 'HTML', color: '#8b5cf6', icon: 'Link' },
  csv: { label: 'CSV', color: '#18a058', icon: 'Tickets' }
}

/** 文档状态映射 */
export const docStatusMap = {
  parsed: { label: '已解析', type: 'success' },
  parsing: { label: '解析中', type: 'warning' },
  indexing: { label: '向量化中', type: 'warning' },
  failed: { label: '解析失败', type: 'danger' },
  pending: { label: '排队中', type: 'info' }
}

/** 知识库状态映射 */
export const kbStatusMap = {
  ready: { label: '已就绪', type: 'success' },
  indexing: { label: '索引构建中', type: 'warning' },
  draft: { label: '草稿', type: 'info' }
}

/** 可选 Embedding 模型 */
export const embeddingModels = [
  { value: 'bge-large-zh-v1.5', label: 'bge-large-zh-v1.5（中文，1024 维）' },
  { value: 'bge-m3', label: 'bge-m3（多语言，1024 维）' },
  { value: 'text-embedding-v3', label: 'text-embedding-v3（通义，1536 维）' },
  { value: 'Conan-embedding-v1', label: 'Conan-embedding-v1（中文长文本）' }
]

/** 可选推理模型（与 ai-service 模型注册表对齐：glm-*→智谱，kimi-*→Moonshot；未注册名会被回落默认） */
export const llmModels = [
  { value: 'glm-4-flash', label: 'GLM-4-Flash（智谱）', provider: 'zhipu' },
  { value: 'kimi-k2.6', label: 'Kimi K2.6（月之暗面）', provider: 'moonshot' }
]

/** 可选解析策略 */
export const parserOptions = [
  { value: 'smart', label: '智能解析（自动识别版式与表格）' },
  { value: 'ocr', label: '强制 OCR（扫描件）' },
  { value: 'text', label: '纯文本（跳过图片与表格）' }
]

/** 可选向量库 */
export const vectorStores = [
  { value: 'milvus', label: 'Milvus' },
  { value: 'pgvector', label: 'PostgreSQL + pgvector' },
  { value: 'qdrant', label: 'Qdrant' },
  { value: 'elasticsearch', label: 'Elasticsearch（稠密 + 稀疏）' }
]
