/**
 * 用户与系统模拟数据
 * 说明：该文件的所有字段与后端 /api/user/* 接口返回结构保持一致，
 *      后端就绪后可直接删除 mock 目录，无需改动页面代码。
 */

export const mockUsers = [
  {
    id: 'u_1001',
    username: 'admin',
    nickname: '系统管理员',
    email: 'admin@example.com',
    phone: '138****8080',
    avatar: '',
    role: 'admin',
    roleName: '超级管理员',
    department: '平台研发部',
    status: 'active',
    lastLoginAt: '2026-09-05 09:12:33',
    createdAt: '2026-01-04 10:00:00',
    quota: {
      conversationLimit: 200,
      conversationUsed: 36,
      docLimit: 5000,
      docUsed: 1287,
      storageLimit: 20 * 1024 * 1024 * 1024,
      storageUsed: 4.2 * 1024 * 1024 * 1024,
      monthlyTokenLimit: 5_000_000,
      monthlyTokenUsed: 1_284_660
    }
  },
  {
    id: 'u_1002',
    username: 'editor',
    nickname: '知识库编辑',
    email: 'editor@example.com',
    phone: '139****2020',
    avatar: '',
    role: 'editor',
    roleName: '知识库编辑',
    department: '内容运营部',
    status: 'active',
    lastLoginAt: '2026-09-04 18:40:02',
    createdAt: '2026-03-11 14:22:00',
    quota: {
      conversationLimit: 100,
      conversationUsed: 12,
      docLimit: 2000,
      docUsed: 96,
      storageLimit: 5 * 1024 * 1024 * 1024,
      storageUsed: 0.8 * 1024 * 1024 * 1024,
      monthlyTokenLimit: 1_000_000,
      monthlyTokenUsed: 213_400
    }
  },
  {
    id: 'u_1003',
    username: 'viewer',
    nickname: '只读访客',
    email: 'viewer@example.com',
    phone: '137****3355',
    avatar: '',
    role: 'viewer',
    roleName: '只读访客',
    department: '客户服务部',
    status: 'active',
    lastLoginAt: '2026-09-02 11:05:47',
    createdAt: '2026-05-20 09:31:00',
    quota: {
      conversationLimit: 30,
      conversationUsed: 4,
      docLimit: 200,
      docUsed: 0,
      storageLimit: 1 * 1024 * 1024 * 1024,
      storageUsed: 0,
      monthlyTokenLimit: 200_000,
      monthlyTokenUsed: 12_050
    }
  },
  {
    id: 'u_1004',
    username: 'zhangwei',
    nickname: '张伟',
    email: 'zhangwei@example.com',
    phone: '135****6621',
    avatar: '',
    role: 'editor',
    roleName: '知识库编辑',
    department: '技术支持部',
    status: 'disabled',
    lastLoginAt: '2026-07-18 16:20:11',
    createdAt: '2026-02-09 08:45:00',
    quota: {
      conversationLimit: 100,
      conversationUsed: 0,
      docLimit: 2000,
      docUsed: 0,
      storageLimit: 5 * 1024 * 1024 * 1024,
      storageUsed: 0,
      monthlyTokenLimit: 1_000_000,
      monthlyTokenUsed: 0
    }
  }
]

/** 登录账号：任意密码均可登录（模拟环境） */
export const mockAccounts = [
  { username: 'admin', password: 'admin123', userId: 'u_1001' },
  { username: 'editor', password: 'editor123', userId: 'u_1002' },
  { username: 'viewer', password: 'viewer123', userId: 'u_1003' }
]

/** 系统设置（设置页使用） */
export const mockSystemSettings = {
  model: {
    provider: 'qwen',
    model: 'qwen2.5-72b-instruct',
    temperature: 0.3,
    topP: 0.85,
    maxTokens: 2048,
    contextRounds: 5,
    systemPrompt:
      '你是企业知识库助手。请严格依据给定的知识库片段回答问题，使用简洁专业的中文。若片段中没有答案，请明确说明"未在知识库中检索到相关内容"，不要编造。回答中需标注引用编号，如 [1]。',
    enableStream: true,
    enableCitation: true,
    fallbackReply: '抱歉，我未在知识库中检索到相关内容，建议补充资料后重试。'
  },
  retrieval: {
    topK: 5,
    threshold: 0.28,
    rerank: true,
    rerankModel: 'bge-reranker-large',
    hybrid: true,
    vectorWeight: 0.7
  },
  security: {
    enableAuditLog: true,
    auditRetentionDays: 180,
    enableSensitiveFilter: true,
    ipWhitelist: '',
    sessionTimeout: 120
  },
  storage: {
    vectorStore: 'milvus',
    vectorDim: 1024,
    embeddingModel: 'bge-large-zh-v1.5',
    maxFileSize: 100,
    ocrEnabled: true
  }
}

/** API 密钥 */
export const mockApiKeys = [
  {
    id: 'key_01',
    name: '生产环境-官网助手',
    key: 'sk-kb-8f2a****************3c1d',
    scope: ['kb_001', 'kb_003'],
    status: 'active',
    quotaPerDay: 10000,
    usedToday: 3286,
    createdAt: '2026-05-12 10:20:00',
    lastUsedAt: '2026-09-05 09:44:12',
    expiredAt: '2027-05-12 10:20:00'
  },
  {
    id: 'key_02',
    name: '测试环境-联调用',
    key: 'sk-kb-6d91****************7ab2',
    scope: ['kb_001'],
    status: 'active',
    quotaPerDay: 1000,
    usedToday: 128,
    createdAt: '2026-07-01 14:05:00',
    lastUsedAt: '2026-09-04 20:11:38',
    expiredAt: '2026-12-31 23:59:59'
  },
  {
    id: 'key_03',
    name: '已停用-历史密钥',
    key: 'sk-kb-1b34****************9fe0',
    scope: [],
    status: 'disabled',
    quotaPerDay: 500,
    usedToday: 0,
    createdAt: '2026-02-08 09:00:00',
    lastUsedAt: '2026-06-30 17:22:05',
    expiredAt: '2026-08-08 09:00:00'
  }
]

/** 近 7 日问答量趋势（设置页概览） */
export const mockUsageTrend = [
  { date: '08-30', questions: 862, hitRate: 0.92, avgLatency: 1380 },
  { date: '08-31', questions: 914, hitRate: 0.93, avgLatency: 1420 },
  { date: '09-01', questions: 1120, hitRate: 0.94, avgLatency: 1350 },
  { date: '09-02', questions: 1042, hitRate: 0.91, avgLatency: 1490 },
  { date: '09-03', questions: 986, hitRate: 0.93, avgLatency: 1400 },
  { date: '09-04', questions: 1204, hitRate: 0.95, avgLatency: 1320 },
  { date: '09-05', questions: 738, hitRate: 0.94, avgLatency: 1290 }
]

/** 操作日志 */
export const mockOperationLogs = [
  { id: 'log_01', user: '李娜', action: '上传文档', target: '产品白皮书 v2.3.pdf', ip: '10.12.3.44', result: '成功', createdAt: '2026-09-05 09:40:12' },
  { id: 'log_02', user: '陈昊', action: '重建索引', target: '财务与合规库', ip: '10.12.3.51', result: '成功', createdAt: '2026-09-05 09:35:44' },
  { id: 'log_03', user: '刘敏', action: '修改知识库配置', target: '人事行政制度库', ip: '10.12.5.20', result: '成功', createdAt: '2026-09-05 09:12:03' },
  { id: 'log_04', user: '孙悦', action: '删除文档', target: '旧版退换货政策.md', ip: '10.12.6.88', result: '成功', createdAt: '2026-09-04 18:22:31' },
  { id: 'log_05', user: '张伟', action: '登录', target: '-', ip: '10.12.7.02', result: '失败（账号已停用）', createdAt: '2026-09-04 17:58:19' },
  { id: 'log_06', user: '吴磊', action: '上传文档', target: '供应商管理规范.docx', ip: '10.12.4.13', result: '失败（文档加密）', createdAt: '2026-09-04 16:40:05' }
]

/** 角色权限矩阵 */
export const mockRolePermissions = {
  admin: ['chat:use', 'kb:read', 'kb:write', 'kb:delete', 'doc:upload', 'doc:delete', 'settings:write', 'user:manage'],
  editor: ['chat:use', 'kb:read', 'kb:write', 'doc:upload', 'doc:delete'],
  viewer: ['chat:use', 'kb:read']
}
