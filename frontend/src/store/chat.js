import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import * as chatApi from '@/api/chat'

/** 按更新时间对会话分组 */
function groupByTime(list = []) {
  const today = []
  const yesterday = []
  const week = []
  const earlier = []
  const now = dayjs()

  list.forEach((item) => {
    if (item.pinned) return
    const t = dayjs(item.updatedAt)
    if (t.isSame(now, 'day')) today.push(item)
    else if (t.isSame(now.subtract(1, 'day'), 'day')) yesterday.push(item)
    else if (now.diff(t, 'day') < 7) week.push(item)
    else earlier.push(item)
  })

  return [
    { label: '今天', items: today },
    { label: '昨天', items: yesterday },
    { label: '最近 7 天', items: week },
    { label: '更早', items: earlier }
  ].filter((group) => group.items.length)
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    conversations: [],
    total: 0,
    currentId: '',
    current: null, // 当前会话详情（含 kbIds、model）
    messages: [],
    suggestions: [],
    quickPrompts: [],
    listLoading: false,
    detailLoading: false,
    streaming: false,
    stage: '', // searching | generating
    stageText: '',
    error: '',
    controller: null, // 流控制器
    /** 会话级检索参数覆盖（v0.7.0 新增） */
    retriever: {}
  }),

  getters: {
    /** 当前会话是否为新会话（无历史消息） */
    isNewConversation: (state) => state.messages.filter((m) => m.role === 'user').length === 0,
    pinnedList: (state) => state.conversations.filter((c) => c.pinned),
    groupedConversations: (state) => groupByTime(state.conversations),
    lastUserMessage: (state) => [...state.messages].reverse().find((m) => m.role === 'user')
  },

  actions: {
    /* ---------------- 会话列表 ---------------- */
    async fetchConversations(params = {}) {
      this.listLoading = true
      try {
        const res = await chatApi.getConversations(params)
        this.conversations = res.list
        this.total = res.total
        return res
      } finally {
        this.listLoading = false
      }
    },

    async fetchSuggestions() {
      const [sug, quick] = await Promise.all([
        chatApi.getSuggestedQuestions(),
        chatApi.getQuickPrompts()
      ])
      this.suggestions = sug
      this.quickPrompts = quick
    },

    async createConversation(payload = {}) {
      const conv = await chatApi.createConversation(payload)
      this.conversations.unshift(conv)
      this.total += 1
      return conv
    },

    async openConversation(id) {
      this.detailLoading = true
      try {
        this.currentId = id
        const detail = await chatApi.getConversation(id)
        this.current = detail
        this.messages = detail.messages || []
        return detail
      } finally {
        this.detailLoading = false
      }
    },

    /** 重置为「新对话」状态（不立即创建，等第一条提问时再落库） */
    resetConversation() {
      this.currentId = ''
      this.current = null
      this.messages = []
      this.error = ''
      this.stage = ''
    },

    async renameConversation(id, title) {
      const conv = await chatApi.updateConversation(id, { title })
      const target = this.conversations.find((c) => c.id === id)
      if (target) target.title = conv.title
      if (this.current?.id === id) this.current.title = conv.title
      return conv
    },

    async togglePin(id, pinned) {
      const conv = await chatApi.updateConversation(id, { pinned })
      const target = this.conversations.find((c) => c.id === id)
      if (target) target.pinned = conv.pinned
      if (this.current?.id === id) this.current.pinned = conv.pinned
      return conv
    },

    async removeConversation(id) {
      await chatApi.deleteConversation(id)
      this.conversations = this.conversations.filter((c) => c.id !== id)
      this.total -= 1
      if (this.currentId === id) this.resetConversation()
    },

    async clearAll() {
      const ids = this.conversations.map((c) => c.id)
      if (ids.length) await chatApi.batchDeleteConversations(ids)
      this.conversations = []
      this.total = 0
      this.resetConversation()
    },

    /** 更新当前会话的知识库/模型选择 */
    async updateCurrentConfig(payload) {
      if (!this.currentId) {
        this.current = { ...(this.current || {}), ...payload }
        return
      }
      const conv = await chatApi.updateConversation(this.currentId, payload)
      this.current = conv
    },

    /* ---------------- 提问与流式生成 ---------------- */

    /**
     * 发送问题
     * @param {string} content 问题内容
     * @param {object} options
     * @param {string[]} options.kbIds 知识库 ID 列表
     * @param {string} options.model 模型
     * @param {Array} options.files 附件
     */
    async sendQuestion(content, options = {}) {
      if (!content?.trim() || this.streaming) return
      this.error = ''

      // 1. 确保存在会话
      if (!this.currentId) {
        const conv = await this.createConversation({
          title: content.trim().slice(0, 20),
          kbIds: options.kbIds || [],
          model: options.model
        })
        this.currentId = conv.id
        this.current = conv
      }

      const kbIds = options.kbIds || this.current?.kbIds || []
      const model = options.model || this.current?.model || 'glm-4-flash'

      // 2. 追加用户消息（乐观更新）
      const userMsg = {
        id: chatApi.createLocalId('msg'),
        role: 'user',
        content: content.trim(),
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        meta: { files: options.files || [] }
      }
      this.messages.push(userMsg)

      // 3. 追加助手占位消息
      const assistMsg = {
        id: chatApi.createLocalId('msg'),
        role: 'assistant',
        content: '',
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        status: 'streaming',
        sources: [],
        meta: { model },
        feedback: null
      }
      this.messages.push(assistMsg)

      this.streaming = true
      this.stage = 'searching'
      this.stageText = '正在检索知识库…'

      // 关键：必须从 this.messages 读取，拿到的是 Vue 的响应式 Proxy
      // 直接持有 push 之前的原始对象引用，修改不会触发 UI 更新（曾导致一直停在「检索中」）
      const targetIdx = this.messages.length - 1
      const applyTarget = (mutator) => {
        const t = this.messages[targetIdx]
        if (t) mutator(t)
      }
      const startedAt = Date.now()

      this.controller = chatApi.streamAnswer(
        { conversationId: this.currentId, question: content.trim(), kbIds, model, retriever: this.retriever, attachmentIds: options.attachmentIds || [] },
        {
          onStage: (info) => {
            this.stage = info.stage
            this.stageText = info.text
            if (info.sources?.length) applyTarget((t) => { t.sources = info.sources })
          },
          onChunk: (piece) => {
            applyTarget((t) => { t.content = (t.content || '') + piece })
          },
          onDone: async (info = {}) => {
            applyTarget((t) => {
              t.status = info.aborted ? 'stopped' : 'done'
              if (info.sources?.length) t.sources = info.sources
              if (info.meta) {
                const usage = info.meta.tokens || {}
                t.meta = {
                  ...info.meta,
                  tokens: {
                    prompt: usage.prompt || 0,
                    completion: usage.completion || 0,
                    total: (usage.prompt || 0) + (usage.completion || 0)
                  }
                }
              }
            })
            this.streaming = false
            this.stage = ''
            this.stageText = ''
            this.controller = null

            // 首条提问后用问题片段作为会话标题
            const isFirst = this.messages.filter((m) => m.role === 'user').length === 1
            if (isFirst) {
              const title = content.trim().slice(0, 20)
              await this.renameConversation(this.currentId, title)
            }
            // 兜底统计（真实接口应返回精确用量）
            applyTarget((t) => {
              if (!info.meta) {
                t.meta = {
                  model,
                  elapsedMs: Date.now() - startedAt,
                  tokens: { prompt: 0, completion: 0, total: 0 }
                }
              }
            })
            // 回写到 Mock 数据库，保证切换会话后消息不丢失
            await chatApi.persistMessages(this.currentId, this.messages)
            await this.fetchConversations()
          },
          onError: (err) => {
            applyTarget((t) => {
              t.status = 'error'
              t.content = err?.message || '生成失败，请稍后重试'
            })
            this.error = err?.message || '生成失败'
            this.streaming = false
            this.stage = ''
            this.controller = null
          }
        }
      )
    },

    /** 停止生成 */
    stopStream() {
      this.controller?.abort()
      this.controller = null
      this.streaming = false
      this.stage = ''
    },

    /** 重新生成最后一条回答 */
    async regenerate(msgId) {
      const idx = this.messages.findIndex((m) => m.id === msgId)
      if (idx < 0 || this.streaming) return
      const target = this.messages[idx]
      const userMsg = [...this.messages.slice(0, idx)].reverse().find((m) => m.role === 'user')
      if (!userMsg) return

      target.content = ''
      target.status = 'streaming'
      target.sources = []
      this.streaming = true
      this.stage = 'searching'
      this.stageText = '正在重新检索知识库…'

      const model = this.current?.model || target.meta?.model || 'glm-4-flash'
      const startedAt = Date.now()

      this.controller = chatApi.streamAnswer(
        {
          conversationId: this.currentId,
          question: userMsg.content,
          kbIds: this.current?.kbIds || [],
          model,
          retriever: this.retriever
        },
        {
          onStage: (info) => {
            this.stage = info.stage
            this.stageText = info.text
            if (info.sources?.length) target.sources = info.sources
          },
          onChunk: (piece) => {
            target.content += piece
          },
          onDone: (info = {}) => {
            target.status = info.aborted ? 'stopped' : 'done'
            if (info.sources?.length) target.sources = info.sources
            target.meta = {
              ...(info.meta || {}),
              model,
              elapsedMs: info.meta?.elapsedMs || Date.now() - startedAt
            }
            this.streaming = false
            this.stage = ''
            this.controller = null
            chatApi.persistMessages(this.currentId, this.messages)
            this.fetchConversations()
          },
          onError: (err) => {
            target.status = 'error'
            target.content = err?.message || '生成失败，请稍后重试'
            this.streaming = false
            this.stage = ''
            this.controller = null
          }
        }
      )
    },

    /** 消息反馈 */
    async feedback(msgId, type) {
      const msg = this.messages.find((m) => m.id === msgId)
      if (!msg) return
      msg.feedback = msg.feedback === type ? null : type
      await chatApi.submitFeedback(msgId, msg.feedback)
    }
  }
})
