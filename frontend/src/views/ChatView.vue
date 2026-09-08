<template>
  <div class="chat-view">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <h2 class="conv-title text-ellipsis" @click="handleRename">
          {{ title }}
          <el-icon :size="13" class="edit-icon"><EditPen /></el-icon>
        </h2>
        <div class="conv-meta">
          <span>{{ chatStore.messages.length }} 条消息</span>
          <span v-if="chatStore.current?.tokenUsed">
            {{ formatNumber(chatStore.current.tokenUsed) }} tokens
          </span>
          <el-tag v-if="chatStore.streaming" size="small" type="warning" effect="light">
            生成中
          </el-tag>
        </div>
      </div>

      <div class="topbar-right">
        <el-tooltip content="导出为 Markdown" placement="bottom">
          <button class="tb-btn" :disabled="!chatStore.messages.length" @click="handleExport">
            <el-icon :size="15"><Download /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip content="清空当前对话" placement="bottom">
          <button class="tb-btn" :disabled="!chatStore.messages.length" @click="handleClear">
            <el-icon :size="15"><Delete /></el-icon>
          </button>
        </el-tooltip>
        <el-dropdown trigger="click" @command="handleCommand">
          <button class="tb-btn">
            <el-icon :size="15"><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="rename">
                <el-icon><EditPen /></el-icon>重命名
              </el-dropdown-item>
              <el-dropdown-item command="pin">
                <el-icon><Star /></el-icon>{{ chatStore.current?.pinned ? '取消置顶' : '置顶会话' }}
              </el-dropdown-item>
              <el-dropdown-item command="remove" divided>
                <el-icon><Delete /></el-icon>删除会话
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <!-- 消息区 -->
    <div ref="scrollRef" class="chat-scroll scroll-thin" @scroll="handleScroll">
      <div class="chat-inner">
        <EmptyState
          v-if="!chatStore.messages.length"
          :suggestions="chatStore.suggestions"
          :kb-count="kbOptions.length"
          @select="handleSuggestion"
        />

        <ChatMessage
          v-for="(msg, idx) in chatStore.messages"
          :key="msg.id"
          :message="msg"
          :streaming="chatStore.streaming"
          :stage-text="chatStore.stageText"
          :source-default-expanded="idx === lastAssistantIdx"
          @regenerate="handleRegenerate"
          @preview="handlePreview"
          @feedback="handleFeedback"
        />

        <div v-if="chatStore.error" class="error-bar">
          <el-icon :size="14"><WarningFilled /></el-icon>
          {{ chatStore.error }}
        </div>
      </div>
    </div>

    <!-- 回到底部 -->
    <transition name="fade">
      <button v-if="!atBottom" class="to-bottom" @click="scrollToBottom">
        <el-icon :size="14"><ArrowDown /></el-icon>
      </button>
    </transition>

    <!-- 输入区 -->
    <footer class="chat-footer">
      <div class="footer-inner">
        <ChatInput
          v-model="input"
          :streaming="chatStore.streaming"
          :disabled="chatStore.streaming"
          :kb-ids="kbIds"
          :kb-options="kbOptions"
          :model="model"
          :model-options="modelOptions"
          :quick-prompts="chatStore.quickPrompts"
          :placeholder="placeholder"
          :retriever="chatStore.retriever"
          @send="handleSend"
          @stop="chatStore.stopStream()"
          @update:kb-ids="handleKbChange"
          @update:model="handleModelChange"
          @update:retriever="(v) => (chatStore.retriever = v)"
        />
      </div>
    </footer>

    <!-- 引用来源预览抽屉 -->
    <el-drawer v-model="previewVisible" :title="preview?.docName || '原文片段'" size="440px">
      <div v-if="preview" class="preview">
        <div class="preview-meta">
          <DocTypeIcon :type="preview.docType" />
          <el-tag size="small" effect="plain">{{ preview.kbName }}</el-tag>
          <span class="text-muted">第 {{ preview.page }} 页 · 切片 #{{ preview.chunkIndex }}</span>
          <el-tag size="small" type="success" effect="light">
            相似度 {{ (preview.score * 100).toFixed(1) }}%
          </el-tag>
        </div>

        <div class="preview-content md-body">{{ preview.snippet }}</div>

        <el-divider content-position="left">片段信息</el-divider>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="文档名称">{{ preview.docName }}</el-descriptions-item>
          <el-descriptions-item label="所属知识库">{{ preview.kbName }}</el-descriptions-item>
          <el-descriptions-item label="切片编号">#{{ preview.chunkIndex }}</el-descriptions-item>
          <el-descriptions-item label="所在页码">{{ preview.page }}</el-descriptions-item>
          <el-descriptions-item label="相似度得分">{{ preview.score }}</el-descriptions-item>
        </el-descriptions>

        <p class="preview-tip">
          提示：正式版本将在此处展示原文高亮定位与前后文片段（支持跳转到原文档对应页码）。
        </p>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore, useKnowledgeStore } from '@/store'
import { fileToBase64, uploadAttachments } from '@/api/chat'
import { llmModels } from '@/mock/knowledge'
import { formatNumber, formatDateTime } from '@/utils/format'
import ChatMessage from '@/components/ChatMessage.vue'
import ChatInput from '@/components/ChatInput.vue'
import EmptyState from '@/components/EmptyState.vue'
import DocTypeIcon from '@/components/DocTypeIcon.vue'

const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
const knowledgeStore = useKnowledgeStore()

const input = ref('')
const kbIds = ref([])
const model = ref(llmModels[0].value)
const modelOptions = llmModels
const kbOptions = computed(() => knowledgeStore.options)
const atBottom = ref(true)
const scrollRef = ref(null)

const previewVisible = ref(false)
const preview = ref(null)

const title = computed(() =>
  chatStore.currentId ? chatStore.current?.title || '新对话' : '新对话'
)

const placeholder = computed(() =>
  kbIds.value.length ? '基于知识库提问，Enter 发送…' : '未选择知识库时将使用通用知识回答…'
)

/** 用于驱动自动滚动：最后一条消息的内容长度 */
const lastContent = computed(() => chatStore.messages.at(-1)?.content.length || 0)

/** 最新一条助手消息的索引（用于默认展开来源列表） */
const lastAssistantIdx = computed(() => {
  const arr = chatStore.messages
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].role === 'assistant') return i
  }
  return -1
})

onMounted(async () => {
  await knowledgeStore.fetchOptions()
  if (!kbIds.value.length) {
    kbIds.value = kbOptions.value.filter((k) => k.status === 'ready').slice(0, 1).map((k) => k.id)
  }
  await syncFromRoute(route.params.id)
  scrollToBottom()
})

watch(
  () => route.params.id,
  async (id) => {
    await syncFromRoute(id)
  }
)

watch(
  () => chatStore.currentId,
  (id) => {
    if (id && route.params.id !== id) router.replace(`/chat/${id}`)
  }
)

// 新消息或流式增量到达时自动滚动到底部
watch(
  () => [chatStore.messages.length, lastContent.value],
  () => {
    if (atBottom.value) nextTick(scrollToBottom)
  }
)

async function syncFromRoute(id) {
  if (id) {
    if (chatStore.currentId !== id) await chatStore.openConversation(id)
    if (chatStore.current?.kbIds?.length) kbIds.value = [...chatStore.current.kbIds]
    // 旧会话遗留的模型名（如 mock 时代的 qwen）不在可选列表时回落默认，避免下拉显示无效值
    const validModel = llmModels.some((m) => m.value === chatStore.current?.model)
    if (validModel) model.value = chatStore.current.model
  } else {
    chatStore.resetConversation()
    await chatStore.fetchSuggestions()
  }
  await nextTick(scrollToBottom)
}

function handleScroll() {
  const el = scrollRef.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function scrollToBottom() {
  const el = scrollRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  atBottom.value = true
}

/* ---------------- 交互 ---------------- */

async function handleSend({ content, files }) {
  atBottom.value = true
  // 附件：先上传提取文本（临时上下文），失败则提示并中止本次发送
  let attachmentIds = []
  if (files?.length) {
    try {
      const payloads = await Promise.all(files.map((f) => fileToBase64(f).then((b) => ({ name: f.name, base64Content: b }))))
      const res = await uploadAttachments(payloads)
      attachmentIds = (res.data || res).map((a) => a.id)
    } catch (e) {
      ElMessage.error(e?.response?.data?.message || e?.message || '附件上传失败，请重试')
      return
    }
  }
  await chatStore.sendQuestion(content, { kbIds: kbIds.value, model: model.value, files, attachmentIds })
  input.value = ''
  await nextTick(scrollToBottom)
}

function handleRetrieverChange(v) {
  chatStore.retriever = v
}

function handleSuggestion(text) {
  input.value = text
}

async function handleKbChange(value) {
  kbIds.value = value
  if (chatStore.currentId) await chatStore.updateCurrentConfig({ kbIds: value })
}

async function handleModelChange(value) {
  model.value = value
  if (chatStore.currentId) await chatStore.updateCurrentConfig({ model: value })
}

function handleRegenerate(msgId) {
  chatStore.regenerate(msgId)
}

function handleFeedback(msgId, type) {
  chatStore.feedback(msgId, type)
}

function handlePreview(source) {
  preview.value = source
  previewVisible.value = true
}

async function handleRename() {
  if (!chatStore.currentId) return
  try {
    const { value } = await ElMessageBox.prompt('请输入会话名称', '重命名', {
      inputValue: chatStore.current?.title || '',
      inputValidator: (v) => (v && v.trim().length <= 50) || '名称不能为空且不超过 50 个字符',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    await chatStore.renameConversation(chatStore.currentId, value.trim())
    ElMessage.success('已重命名')
  } catch (e) {
    /* 取消 */
  }
}

async function handleClear() {
  try {
    await ElMessageBox.confirm('确定清空当前对话的全部消息吗？', '清空对话', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消'
    })
    if (chatStore.currentId) {
      await chatStore.removeConversation(chatStore.currentId)
      router.replace('/chat')
    } else {
      chatStore.resetConversation()
    }
    ElMessage.success('已清空')
  } catch (e) {
    /* 取消 */
  }
}

async function handleCommand(cmd) {
  if (!chatStore.currentId) {
    ElMessage.info('当前为新对话，发送第一条消息后自动创建')
    return
  }
  if (cmd === 'rename') return handleRename()
  if (cmd === 'pin') {
    await chatStore.togglePin(chatStore.currentId, !chatStore.current?.pinned)
    ElMessage.success(chatStore.current?.pinned ? '已置顶' : '已取消置顶')
    return
  }
  if (cmd === 'remove') {
    try {
      await ElMessageBox.confirm('确定删除当前会话吗？', '删除会话', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      })
      await chatStore.removeConversation(chatStore.currentId)
      router.replace('/chat')
      ElMessage.success('已删除')
    } catch (e) {
      /* 取消 */
    }
  }
}

/** 导出会话为 Markdown 文件（纯前端实现） */
function handleExport() {
  const lines = [
    `# ${chatStore.current?.title || '新对话'}`,
    '',
    `> 导出时间：${formatDateTime(new Date(), 'YYYY-MM-DD HH:mm:ss')}`,
    ''
  ]
  chatStore.messages.forEach((msg) => {
    lines.push(`## ${msg.role === 'user' ? '我' : 'AI 助手'}`)
    lines.push('')
    lines.push(msg.content || '')
    lines.push('')
    if (msg.sources?.length) {
      lines.push('**引用来源**')
      lines.push('')
      msg.sources.forEach((s) => {
        lines.push(`- [${s.index}] ${s.docName}（${s.kbName}，第 ${s.page} 页，相似度 ${(s.score * 100).toFixed(1)}%）`)
      })
      lines.push('')
    }
  })

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${chatStore.current?.title || '对话'}.md`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 Markdown')
}
</script>

<style scoped>
.chat-view {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--c-bg-soft);
}

/* 顶部栏 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  height: var(--topbar-h);
  padding: 0 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--c-border-soft);
}

.topbar-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.conv-title {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 460px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.edit-icon {
  flex-shrink: 0;
  color: var(--c-text-4);
  opacity: 0;
  transition: opacity 0.16s;
}

.conv-title:hover .edit-icon {
  opacity: 1;
}

.conv-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: var(--c-text-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: all 0.16s;
}

.tb-btn:hover:not(:disabled) {
  color: var(--c-text);
  background: var(--c-bg-hover);
  border-color: var(--c-border-soft);
}

.tb-btn:disabled {
  color: var(--c-text-4);
  opacity: 0.5;
  cursor: not-allowed;
}

/* 消息滚动区 */
.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.chat-inner {
  max-width: 820px;
  min-height: 100%;
  margin: 0 auto;
  padding: 16px 24px 8px;
}

.error-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-bottom: 16px;
  font-size: 12.5px;
  color: var(--c-danger);
  background: var(--c-danger-soft);
  border: 1px solid #f7c9ce;
  border-radius: var(--radius-s);
}

/* 回到底部 */
.to-bottom {
  position: absolute;
  bottom: 176px;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--c-text-2);
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 50%;
  box-shadow: var(--shadow);
  cursor: pointer;
  transform: translateX(-50%);
  transition: all 0.16s;
}

.to-bottom:hover {
  color: var(--brand);
  border-color: var(--brand);
}

/* 输入区 */
.chat-footer {
  flex-shrink: 0;
  padding: 0 24px;
  background: linear-gradient(to top, var(--c-bg-soft) 62%, transparent);
}

.footer-inner {
  max-width: 820px;
  margin: 0 auto;
  padding-bottom: 14px;
}

/* 预览抽屉 */
.preview-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 12px;
}

.preview-content {
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--c-text-2);
  background: var(--brand-soft-2);
  border-left: 3px solid var(--brand);
  border-radius: 0 var(--radius-s) var(--radius-s) 0;
}

.preview-tip {
  margin-top: 16px;
  font-size: 12px;
  color: var(--c-text-4);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
