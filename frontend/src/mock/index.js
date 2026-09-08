import { mockKnowledgeBases } from './knowledge'
import { mockConversations } from './chat'
import { mockAnswers, fallbackAnswer } from './answers'
import {
  mockUsers,
  mockAccounts,
  mockRolePermissions,
  mockSystemSettings,
  mockApiKeys,
  mockUsageTrend,
  mockOperationLogs
} from './user'
import { clone, uid } from '@/utils/format'

// 统一出口：页面与 api 层只从 '@/mock' 导入
export {
  mockUsers,
  mockAccounts,
  mockRolePermissions,
  mockSystemSettings,
  mockApiKeys,
  mockUsageTrend,
  mockOperationLogs
}
export { mockKnowledgeBases } from './knowledge'
export { mockConversations } from './chat'
export { mockAnswers, mockSuggestedQuestions, mockQuickPrompts } from './answers'

/**
 * 内存态 Mock 数据库
 * 所有写操作（新建会话、上传文档、修改配置）都作用于该对象，
 * 页面刷新后重置为初始数据，便于反复测试。
 */
export const mockDb = {
  users: clone(mockUsers),
  accounts: clone(mockAccounts),
  rolePermissions: clone(mockRolePermissions),
  knowledgeBases: clone(mockKnowledgeBases),
  conversations: clone(mockConversations)
}

/** 重置为初始数据 */
export function resetMockDb() {
  mockDb.users = clone(mockUsers)
  mockDb.knowledgeBases = clone(mockKnowledgeBases)
  mockDb.conversations = clone(mockConversations)
}

/* ==========================================================================
   检索模拟
   ========================================================================== */

/** 生成字符二元组，用于中文/英文混合的相似度计算 */
function tokenize(text = '') {
  const s = String(text).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  const grams = new Set()
  if (!s) return grams
  for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2))
  if (s.length === 1) grams.add(s)
  return grams
}

/** 计算 query 与文本的相似度得分（0 ~ 0.98） */
function similarity(query, text) {
  const q = tokenize(query)
  const t = tokenize(text)
  if (!q.size || !t.size) return 0
  let hit = 0
  q.forEach((g) => {
    if (t.has(g)) hit += 1
  })
  const ratio = hit / q.size
  const jitter = (Math.random() - 0.5) * 0.06
  return Math.min(0.98, Math.max(0.05, 0.32 + ratio * 0.62 + jitter))
}

/**
 * 模拟向量 + 关键词混合检索
 * @param {string} query 查询词
 * @param {string[]} kbIds 知识库 ID 列表
 * @param {number} topK 返回条数
 * @param {number} threshold 相似度阈值
 * @param {string} [docId] 限定文档（可选）
 * @returns {Array} 命中的切片列表（含知识库/文档信息）
 */
export function retrieveChunks(query, kbIds = [], topK = 5, threshold = 0.28, docId = '') {
  const pool = []
  const kbs = kbIds.length
    ? mockDb.knowledgeBases.filter((kb) => kbIds.includes(kb.id))
    : mockDb.knowledgeBases

  kbs.forEach((kb) => {
    kb.docs.forEach((doc) => {
      if (docId && doc.id !== docId) return
      if (doc.status === 'failed') return
      doc.chunks.forEach((chunk) => {
        const score = similarity(query, `${doc.name} ${chunk.content}`)
        if (score < threshold) return
        pool.push({
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          kbId: kb.id,
          kbName: kb.name,
          docId: doc.id,
          docName: doc.name,
          docType: doc.type,
          page: chunk.page,
          charCount: chunk.charCount,
          content: chunk.content,
          score: Number(score.toFixed(4))
        })
      })
    })
  })

  return pool.sort((a, b) => b.score - a.score).slice(0, topK)
}

/* ==========================================================================
   引用来源
   ========================================================================== */

/**
 * 将引用坐标（kbId/docId/chunkIndex）补全为完整来源对象
 * @param {Array<{kbId:string, docId:string, chunkIndex:number, score?:number}>} refs
 * @returns {Array} 完整来源对象
 */
export function buildSources(refs = []) {
  return refs.map((ref, i) => {
    const kb = mockDb.knowledgeBases.find((k) => k.id === ref.kbId)
    const doc = kb?.docs.find((d) => d.id === ref.docId)
    const chunk = doc?.chunks.find((c) => c.index === ref.chunkIndex) || doc?.chunks[0]
    return {
      id: `src_${i + 1}`,
      index: i + 1,
      kbId: ref.kbId,
      kbName: kb?.name || '未知知识库',
      docId: ref.docId,
      docName: doc?.name || '未知文档',
      docType: doc?.type || 'txt',
      chunkId: chunk?.id || '',
      chunkIndex: ref.chunkIndex,
      page: chunk?.page || 1,
      score: ref.score ?? Number((0.62 + Math.random() * 0.32).toFixed(4)),
      snippet: chunk?.content || ''
    }
  })
}

/* ==========================================================================
   回答生成模拟
   ========================================================================== */

/**
 * 根据问题匹配模拟语料，命中则返回语料，否则返回兜底话术
 * @param {string} question
 * @param {string[]} kbIds
 * @returns {{answer:string, sources:Array, hitCount:number, matched:boolean}}
 */
export function generateAnswer(question, kbIds = []) {
  const q = String(question).toLowerCase()
  let best = null
  let bestHit = 0

  mockAnswers.forEach((item) => {
    const hit = item.keywords.reduce((sum, kw) => sum + (q.includes(kw.toLowerCase()) ? 1 : 0), 0)
    if (hit > bestHit) {
      bestHit = hit
      best = item
    }
  })

  const retrieved = retrieveChunks(question, kbIds, 5, 0.28)

  if (best) {
    return {
      answer: best.answer,
      sources: buildSources(best.sources),
      hitCount: best.sources.length,
      matched: true
    }
  }

  return {
    answer: fallbackAnswer(question, retrieved.length),
    sources: retrieved.slice(0, 3),
    hitCount: retrieved.length,
    matched: false
  }
}

/** 生成一条模拟消息 ID */
export function mockId(prefix) {
  return uid(prefix)
}
