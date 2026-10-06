import { request, mockOk, paginate, mockStreamText, USE_MOCK } from './request'
import { mockDb, generateAnswer, buildSources } from '@/mock'
import { clone, uid as genId } from '@/utils/format'
import { mockSuggestedQuestions, mockQuickPrompts } from '@/mock/answers'

/* ==========================================================================
   会话
   ========================================================================== */

/** 会话列表（分页） */
export function getConversations(params = {}) {
  const { keyword = '', page = 1, pageSize = 20 } = params
  if (USE_MOCK) {
    let list = clone(mockDb.conversations)
    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter((c) => c.title.toLowerCase().includes(kw))
    }
    // 置顶优先，其次按更新时间倒序
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
    return mockOk(paginate(list, page, pageSize), 200)
  }
  return request({ url: '/v1/conversations', method: 'get', params })
}

/** 会话详情（含完整消息） */
export function getConversation(id) {
  if (USE_MOCK) {
    const conv = mockDb.conversations.find((c) => c.id === id)
    if (!conv) return Promise.reject(new Error('会话不存在'))
    const detail = clone(conv)
    detail.messages = detail.messages.map((msg) => ({
      ...msg,
      sources: msg.sources ? buildSources(msg.sources) : []
    }))
    return mockOk(detail, 160)
  }
  return request({ url: `/v1/conversations/${id}`, method: 'get' })
}

/** 新建会话 */
export function createConversation(payload = {}) {
  if (USE_MOCK) {
    const conv = {
      id: genId('conv'),
      title: payload.title || '新对话',
      kbIds: payload.kbIds || [],
      model: payload.model || 'qwen2.5-72b-instruct',
      pinned: false,
      messageCount: 0,
      tokenUsed: 0,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      messages: []
    }
    mockDb.conversations.unshift(conv)
    return mockOk(clone(conv), 180)
  }
  return request({ url: '/v1/conversations', method: 'post', data: payload })
}

/** 更新会话（重命名、置顶、切换知识库） */
export function updateConversation(id, payload) {
  if (USE_MOCK) {
    const conv = mockDb.conversations.find((c) => c.id === id)
    if (!conv) return Promise.reject(new Error('会话不存在'))
    Object.assign(conv, payload, {
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    return mockOk(clone(conv), 160)
  }
  return request({ url: `/v1/conversations/${id}`, method: 'put', data: payload })
}

/**
 * 上传附件（临时问答上下文）：文件 base64 后随 JSON 提交，服务端同步提取文本。
 * 返回 [{id, name, chars, truncated}]，id 随 streamAnswer 的 attachmentIds 传入（一次性消费）。
 */
export function uploadAttachments(files) {
  if (USE_MOCK) {
    return mockOk(files.map((f, i) => ({ id: `att_mock_${i}`, name: f.name, chars: 0, truncated: false })), 120)
  }
  return request({ url: '/v1/chat/attachments', method: 'post', data: { files } })
}

/** File → base64（不含 data: 前缀） */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsDataURL(file)
  })
}

/**
 * 回写会话消息到 Mock 数据库（模拟服务端持久化）
 * 真实接口下消息由后端保存，前端无需调用该方法
 */
export function persistMessages(id, messages = []) {
  if (!USE_MOCK || !id) return Promise.resolve()
  const conv = mockDb.conversations.find((c) => c.id === id)
  if (!conv) return Promise.resolve()
  conv.messages = messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
    feedback: msg.feedback || null,
    meta: clone(msg.meta || {}),
    // 引用来源只落库存坐标，展示时再关联文档信息
    sources: (msg.sources || []).map((s) => ({
      kbId: s.kbId,
      docId: s.docId,
      chunkIndex: s.chunkIndex,
      score: s.score
    }))
  }))
  conv.messageCount = conv.messages.length
  conv.tokenUsed = conv.messages.reduce((sum, m) => sum + (m.meta?.tokens?.total || 0), 0)
  conv.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  return Promise.resolve()
}

/** 删除会话 */
export function deleteConversation(id) {
  if (USE_MOCK) {
    const idx = mockDb.conversations.findIndex((c) => c.id === id)
    if (idx > -1) mockDb.conversations.splice(idx, 1)
    return mockOk({ id }, 200)
  }
  return request({ url: `/v1/conversations/${id}`, method: 'delete' })
}

/** 批量删除会话 */
export function batchDeleteConversations(ids = []) {
  if (USE_MOCK) {
    mockDb.conversations = mockDb.conversations.filter((c) => !ids.includes(c.id))
    return mockOk({ ids }, 220)
  }
  return request({ url: '/v1/conversations/batch-delete', method: 'post', data: { ids } })
}

/* ==========================================================================
   问答流式输出
   ========================================================================== */

/**
 * 发送问题并流式接收回答
 * @param {{conversationId?:string, question:string, kbIds:string[], model:string}} payload
 * @param {object} handlers
 * @param {(info:{stage:string, text:string, sources?:Array})=>void} handlers.onStage 阶段回调（检索中/生成中）
 * @param {(piece:string)=>void} handlers.onChunk 增量文本
 * @param {(info:{aborted?:boolean, sources?:Array, meta?:object})=>void} handlers.onDone 结束回调
 * @param {(info:{conversationId:string, title:string})=>void} handlers.onTitle 会话自动命名回调（done 后推送）
 * @param {(err:Error)=>void} handlers.onError 错误回调
 * @returns {{abort:Function}} 控制器
 */
export function streamAnswer(payload, handlers = {}) {
  const { question, kbIds = [], model = 'qwen2.5-72b-instruct' } = payload

  if (USE_MOCK) {
    const { answer, sources, hitCount } = generateAnswer(question, kbIds)
    const startedAt = Date.now()
    let streamCtrl = null

    // 进入本次流式前该会话的用户消息数：0 表示这是首轮问答（用于模拟服务端 title 事件）
    const convBefore = payload.conversationId
      ? mockDb.conversations.find((c) => c.id === payload.conversationId)
      : null
    const userMsgCountBefore = convBefore
      ? convBefore.messages.filter((m) => m.role === 'user').length
      : 0

    // 阶段一：检索
    handlers.onStage?.({ stage: 'searching', text: '正在检索知识库…' })
    console.debug('[chat] stage: searching')

    // 阶段二：生成。固定 800ms 延迟，避免后台标签页 setTimeout 节流造成体感卡顿
    const genTimer = setTimeout(() => {
      console.debug('[chat] stage: generating')
      handlers.onStage?.({
        stage: 'generating',
        sources,
        text: hitCount ? `已找到 ${hitCount} 个相关片段，正在生成回答…` : '未命中相关片段，正在生成兜底回答…'
      })
      streamCtrl = mockStreamText(answer, {
        onChunk: handlers.onChunk,
        onDone: (info = {}) => {
          console.debug('[chat] stage: done', { aborted: info.aborted, chars: answer.length })
          handlers.onDone?.({
            ...info,
            sources,
            meta: {
              model,
              elapsedMs: Date.now() - startedAt,
              tokens: {
                prompt: 800 + Math.floor(question.length * 12) + sources.length * 180,
                completion: Math.ceil(answer.length / 1.6),
                total: 0
              }
            }
          })
          // 模拟服务端 title 事件：首轮问答完成后按问题前 16 字生成会话标题
          if (userMsgCountBefore === 0 && payload.conversationId && !info.aborted) {
            handlers.onTitle?.({
              conversationId: payload.conversationId,
              title: question.trim().slice(0, 16)
            })
          }
        }
      })
    }, 800)

    return {
      abort() {
        clearTimeout(genTimer)
        if (streamCtrl) {
          streamCtrl.abort()
        } else {
          handlers.onDone?.({ aborted: true })
        }
      }
    }
  }

  /* ---------- 真实 SSE 实现（后端就绪后生效） ---------- */
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const token = localStorage.getItem('kb_token')
      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: ctrl.signal
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let sources = []
      let meta = {}

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        lines.forEach((line) => {
          if (!line.startsWith('data:')) return
          const raw = line.slice(5).trim()
          if (!raw || raw === '[DONE]') return
          try {
            const evt = JSON.parse(raw)
            if (evt.type === 'references') {
              sources = evt.data || []
              handlers.onStage?.({ stage: 'generating', sources, text: `已找到 ${sources.length} 个相关片段…` })
            } else if (evt.type === 'delta') {
              handlers.onChunk?.(evt.data?.content || '')
            } else if (evt.type === 'done') {
              meta = evt.data?.meta || {}
              handlers.onDone?.({ sources, meta, messageId: evt.data?.messageId })
            } else if (evt.type === 'title') {
              // 会话自动命名：服务端在 done 之后、close 之前推送
              handlers.onTitle?.({ conversationId: evt.data?.conversationId, title: evt.data?.title })
            } else if (evt.type === 'error') {
              handlers.onError?.(new Error(evt.data?.message || '生成失败'))
            }
          } catch (e) {
            /* 忽略心跳行解析失败 */
          }
        })
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        handlers.onDone?.({ aborted: true })
      } else {
        handlers.onError?.(err)
      }
    }
  })()

  return { abort: () => ctrl.abort() }
}

/* ==========================================================================
   其他
   ========================================================================== */

/** 消息反馈（点赞/点踩） */
export function submitFeedback(messageId, type) {
  if (USE_MOCK) return mockOk({ id: messageId, feedback: type }, 120)
  return request({ url: `/v1/messages/${messageId}/feedback`, method: 'post', data: { type } })
}

/** 首页推荐问题 */
export function getSuggestedQuestions() {
  if (USE_MOCK) return mockOk(clone(mockSuggestedQuestions), 120)
  return request({ url: '/v1/chat/suggestions', method: 'get' })
}

/**
 * 后续问题建议：基于最近一轮问答生成 3 个追问（回答 done 后异步调用）。
 * 失败/为空时前端静默不展示；mock 模式返回固定建议便于演示。
 */
export function getFollowupSuggestions(payload) {
  if (USE_MOCK) {
    return mockOk({
      suggestions: [
        '能结合具体案例再说明一下吗？',
        '实际使用中有哪些注意事项？',
        '接下来建议我深入了解哪部分？'
      ]
    }, 150)
  }
  return request({ url: '/v1/chat/suggestions', method: 'post', data: payload })
}

/** 快捷引导词 */
export function getQuickPrompts() {
  if (USE_MOCK) return mockOk(clone(mockQuickPrompts), 100)
  return request({ url: '/v1/chat/quick-prompts', method: 'get' })
}

/** 当前真实生效的模型（只读，设置页展示用） */
export function getRuntimeModel() {
  if (USE_MOCK) return mockOk({ model: 'qwen2.5-72b-instruct', available: true }, 100)
  return request({ url: '/v1/chat/model', method: 'get' })
}

/** 生成消息 ID（前端乐观更新使用） */
export function createLocalId(prefix = 'msg') {
  return genId(prefix)
}

/* ==========================================================================
   全局搜索（Ctrl+K）
   ========================================================================== */

/** 从内容中截取关键词附近片段：定位 q 首次出现位置，取前后各 60 字符拼 …（与后端规则一致） */
function buildSnippet(content, q) {
  const text = String(content || '')
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text.slice(0, 120)
  const start = Math.max(0, idx - 60)
  const end = Math.min(text.length, idx + q.length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/**
 * 全局搜索：会话标题 / 文档名 / 消息内容 三分组一次返回。
 * 失败由调用方捕获（弹窗组件内静默展示空态）。
 */
export function searchAll(q) {
  const kw = String(q || '').trim()
  if (USE_MOCK) {
    const lower = kw.toLowerCase()
    if (!lower) return mockOk({ conversations: [], documents: [], messages: [] }, 100)
    const conversations = mockDb.conversations
      .filter((c) => (c.title || '').toLowerCase().includes(lower))
      .slice(0, 5)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
    const documents = []
    const messages = []
    mockDb.knowledgeBases.forEach((kb) => {
      kb.docs.forEach((doc) => {
        if ((doc.name || '').toLowerCase().includes(lower)) {
          documents.push({ id: doc.id, name: doc.name, kbId: kb.id, kbName: kb.name })
        }
      })
    })
    mockDb.conversations.forEach((c) => {
      ;(c.messages || []).forEach((m) => {
        if ((m.content || '').toLowerCase().includes(lower)) {
          messages.push({
            conversationId: c.id,
            conversationTitle: c.title,
            role: m.role,
            createdAt: m.createdAt,
            snippet: buildSnippet(m.content, kw)
          })
        }
      })
    })
    return mockOk(
      { conversations, documents: documents.slice(0, 5), messages: messages.slice(0, 8) },
      160
    )
  }
  return request({ url: '/v1/search', method: 'get', params: { q: kw } })
}
