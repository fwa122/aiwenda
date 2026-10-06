import { request, mockOk, mockFail, paginate, USE_MOCK } from './request'
import { mockDb } from '@/mock'
import { clone, uid } from '@/utils/format'

/* ==========================================================================
   回答收藏夹
   Mock 实现：localStorage 持久化（key 'mock_favorites'），
   数据结构与后端 favorites 表快照字段一一对齐
   ========================================================================== */

const STORAGE_KEY = 'mock_favorites'

/** 读取本地 Mock 收藏列表 */
function readMockFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeMockFavorites(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

/** 在 mockDb 中定位消息及其所属会话 */
function findMockMessage(messageId) {
  for (const conv of mockDb.conversations) {
    const idx = (conv.messages || []).findIndex((m) => m.id === messageId)
    if (idx > -1) return { conv, msg: conv.messages[idx], idx }
  }
  return null
}

/**
 * 收藏一条回答（快照策略：拷贝问题 / 回答 / 来源坐标）
 * @param {string} messageId 回答（assistant 消息）ID
 */
export function addFavorite(messageId) {
  if (USE_MOCK) {
    const found = findMockMessage(messageId)
    if (!found) return mockFail('消息不存在')
    const list = readMockFavorites()
    // 与后端 (userId, messageId) 唯一约束对齐：重复收藏提示「已收藏」
    if (list.some((f) => f.messageId === messageId)) return mockFail('已收藏')

    const { conv, msg, idx } = found
    // 问题取该回答前最近一条 user 消息
    let question = ''
    for (let i = idx - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') {
        question = conv.messages[i].content
        break
      }
    }
    const fav = {
      id: uid('fav'),
      messageId,
      conversationId: conv.id,
      kbId: msg.sources?.[0]?.kbId || null,
      question,
      answer: msg.content || '',
      sources: (msg.sources || []).map((s, i) => ({
        index: i + 1,
        docId: s.docId,
        docName: s.docName || null,
        kbId: s.kbId,
        page: s.page || 1,
        score: s.score || 0
      })),
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    }
    list.unshift(fav)
    writeMockFavorites(list)
    return mockOk(clone(fav), 200)
  }
  return request({ url: '/v1/favorites', method: 'post', data: { messageId } })
}

/** 收藏列表（分页，可按知识库筛选），每项附会话标题 */
export function getFavorites(params = {}) {
  const { kbId = '', page = 1, pageSize = 20 } = params
  if (USE_MOCK) {
    let list = readMockFavorites().filter((f) => !kbId || f.kbId === kbId)
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const paged = paginate(list, Number(page), Number(pageSize))
    paged.list = paged.list.map((f) => ({
      ...f,
      conversationTitle:
        mockDb.conversations.find((c) => c.id === f.conversationId)?.title || ''
    }))
    return mockOk(paged, 200)
  }
  return request({ url: '/v1/favorites', method: 'get', params })
}

/** 当前用户已收藏的 messageId 数组（聊天页星标高亮，轻量） */
export function getFavoriteIds() {
  if (USE_MOCK) return mockOk(readMockFavorites().map((f) => f.messageId), 100)
  return request({ url: '/v1/favorites/ids', method: 'get' })
}

/** 取消收藏 */
export function removeFavorite(id) {
  if (USE_MOCK) {
    writeMockFavorites(readMockFavorites().filter((f) => f.id !== id))
    return mockOk({ id }, 200)
  }
  return request({ url: `/v1/favorites/${id}`, method: 'delete' })
}
