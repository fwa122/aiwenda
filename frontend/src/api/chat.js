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
 * @param {(err:Error)=>void} handlers.onError 错误回调
 * @returns {{abort:Function}} 控制器
 */
export function streamAnswer(payload, handlers = {}) {
  const { question, kbIds = [], model = 'qwen2.5-72b-instruct' } = payload

  if (USE_MOCK) {
    const { answer, sources, hitCount } = generateAnswer(question, kbIds)
    const startedAt = Date.now()
    let streamCtrl = null

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
              handlers.onDone?.({ sources, meta })
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
