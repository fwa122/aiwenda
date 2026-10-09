<template>
  <div
    class="chat-view"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
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
          :is-favorited="favoriteIds.has(msg.id)"
          @regenerate="handleRegenerate"
          @preview="handlePreview"
          @feedback="handleFeedback"
          @favorite="handleFavorite"
        />

        <!-- 后续问题建议：最新一条助手消息下方，点击直接发送 -->
        <div v-if="showFollowups" class="followups">
          <button v-for="q in chatStore.followups" :key="q" class="followup-chip" @click="handleFollowup(q)">
            <el-icon :size="12"><ChatLineRound /></el-icon>{{ q }}
          </button>
        </div>

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
          ref="chatInputRef"
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

    <!-- 拖拽导入遮罩（pointer-events 关闭，drop 落在根容器上） -->
    <transition name="fade">
      <div v-if="dragActive" class="drop-overlay">
        <div class="drop-panel">
          <el-icon :size="36" color="var(--brand)"><UploadFilled /></el-icon>
          <p class="drop-title">{{ dropHint }}</p>
          <p class="drop-sub">支持 pdf / docx / txt / md / csv · 单个文件不超过 20MB</p>
        </div>
      </div>
    </transition>

    <!-- 引用来源预览抽屉 -->
    <el-drawer v-model="previewVisible" :title="preview?.docName || '原文片段'" size="440px">
      <div v-if="preview" ref="previewRef" class="preview">
        <div class="preview-meta">
          <DocTypeIcon :type="preview.docType" />
          <el-tag size="small" effect="plain">{{ preview.kbName }}</el-tag>
          <span class="text-muted">第 {{ preview.page }} 页 · 切片 #{{ preview.chunkIndex }}</span>
          <el-tag size="small" type="success" effect="light">
            相似度 {{ (preview.score * 100).toFixed(1) }}%
          </el-tag>
        </div>

        <div
          ref="previewContentRef"
          class="preview-content md-body"
          @mouseup="handlePreviewMouseUp"
        >{{ preview.snippet }}</div>

        <el-divider content-position="left">片段信息</el-divider>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="文档名称">{{ preview.docName }}</el-descriptions-item>
          <el-descriptions-item label="所属知识库">{{ preview.kbName }}</el-descriptions-item>
          <el-descriptions-item label="切片编号">#{{ preview.chunkIndex }}</el-descriptions-item>
          <el-descriptions-item label="所在页码">{{ preview.page }}</el-descriptions-item>
          <el-descriptions-item label="相似度得分">{{ preview.score }}</el-descriptions-item>
        </el-descriptions>

        <p class="preview-tip">
          提示：选中上方片段文字，可直接「解释 / 翻译 / 就这段提问」；关闭本抽屉可回到原文预览
          （PDF 已定位到引用页码，PDF 内暂不支持划词）。
        </p>

        <!-- 划词浮动操作条（绝对定位于预览容器内，坐标取选区相对位置） -->
        <div
          v-if="selBar.visible"
          class="sel-bar"
          :style="{ top: `${selBar.top}px`, left: `${selBar.left}px` }"
          @mousedown.prevent
        >
          <button class="sel-btn" @click="quoteAction('explain')">解释这段</button>
          <button class="sel-btn" @click="quoteAction('translate')">翻译这段</button>
          <button class="sel-btn" @click="quoteAction('ask')">就这段提问</button>
        </div>
      </div>
    </el-drawer>

    <!-- 引用原文预览抽屉：点击引用直达原文，PDF 定位到引用页码 -->
    <DocPreviewDrawer
      v-model="docPreview.visible"
      :doc-id="docPreview.docId"
      :name="docPreview.name"
      :type="docPreview.type"
      :page="docPreview.page"
      show-snippet-action
      @snippet="openSnippetDrawer"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useChatStore, useKnowledgeStore } from '@/store'
import { fileToBase64, uploadAttachments } from '@/api/chat'
import { getFavoriteIds, addFavorite } from '@/api/favorite'
import { ensureNotifyPermission, watchKb, stopWatch } from '@/composables/useParseWatcher'
import { llmModels } from '@/mock/knowledge'
import { formatNumber, formatDateTime } from '@/utils/format'
import ChatMessage from '@/components/ChatMessage.vue'
import ChatInput from '@/components/ChatInput.vue'
import EmptyState from '@/components/EmptyState.vue'
import DocTypeIcon from '@/components/DocTypeIcon.vue'
import DocPreviewDrawer from '@/components/DocPreviewDrawer.vue'

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
const chatInputRef = ref(null)

const previewVisible = ref(false)
const preview = ref(null)

/* ===== 回答收藏：已收藏消息 ID 集合（驱动星标高亮） ===== */
const favoriteIds = ref(new Set())
/* ===== 划词追问（预览抽屉）：选区浮动操作条 ===== */
const previewRef = ref(null)
const previewContentRef = ref(null)
const selBar = ref({ visible: false, top: 0, left: 0 })
let selectedText = ''

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

/** 后续问题建议：仅最新消息为已完成的助手回答且非流式时展示 */
const showFollowups = computed(() => {
  if (chatStore.streaming || !chatStore.followups.length) return false
  const last = chatStore.messages.at(-1)
  return last?.role === 'assistant' && last?.status === 'done'
})

onMounted(async () => {
  // 划词追问全局监听：document 级捕获（滚动不冒泡），回调内部以抽屉可见性短路
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('scroll', onDocScroll, true)
  document.addEventListener('selectionchange', onDocSelectionChange)

  await knowledgeStore.fetchOptions()
  if (!kbIds.value.length) {
    kbIds.value = kbOptions.value.filter((k) => k.status === 'ready').slice(0, 1).map((k) => k.id)
  }
  await syncFromRoute(route.params.id)
  scrollToBottom()
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('scroll', onDocScroll, true)
  document.removeEventListener('selectionchange', onDocSelectionChange)
})

watch(previewVisible, (v) => {
  if (!v) hideSelBar()
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
  // 消息加载后拉取一次已收藏集合，星标高亮一次到位（失败静默，不阻断聊天）
  await refreshFavoriteIds()
  await nextTick(scrollToBottom)
}

/** 拉取当前用户已收藏的 messageId 集合 */
async function refreshFavoriteIds() {
  try {
    const ids = await getFavoriteIds()
    favoriteIds.value = new Set(ids || [])
  } catch {
    /* 高亮失败不影响聊天主流程 */
  }
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

/* ===== 拖拽文档直接入库（与附件按钮互不影响，仅入库不提问） ===== */
const ACCEPTED_EXTS = ['pdf', 'docx', 'txt', 'md', 'csv']
const MAX_DOC_SIZE = 20 * 1024 * 1024

const dragDepth = ref(0)
const dragActive = computed(() => dragDepth.value > 0)
// 知识库选择器为多选，拖拽导入目标取第一个选中项
const currentKbId = computed(() => kbIds.value[0] || '')
const currentKbName = computed(
  () => kbOptions.value.find((k) => k.id === currentKbId.value)?.name || ''
)
const dropHint = computed(() =>
  currentKbId.value
    ? `松开鼠标，导入到当前知识库「${currentKbName.value}」`
    : '请先在下方选择知识库'
)

/** 本组件启动的解析监听，卸载时统一清理 */
const watchedKbIds = new Set()
onBeforeUnmount(() => watchedKbIds.forEach((id) => stopWatch(id)))

/** 仅对文件拖拽生效，避免拖动页面文字时误显遮罩 */
function hasDragFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files')
}

function onDragEnter(e) {
  if (!hasDragFiles(e)) return
  // 计数器方案：dragleave 在子元素间会抖动，进出配对抵消，归零才隐藏
  dragDepth.value += 1
}

function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function onDrop(e) {
  dragDepth.value = 0
  handleDropFiles(Array.from(e.dataTransfer?.files || []))
}

async function handleDropFiles(fileList) {
  if (!fileList.length) return
  if (!currentKbId.value) {
    ElMessage.warning('请先在下方选择知识库，再拖拽导入文档')
    return
  }
  ensureNotifyPermission() // 用户手势内请求浏览器通知权限
  const accepted = []
  for (const file of fileList) {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ACCEPTED_EXTS.includes(ext)) {
      ElMessage.error(`「${file.name}」格式不支持，仅支持 ${ACCEPTED_EXTS.join(' / ')}`)
      continue
    }
    if (file.size > MAX_DOC_SIZE) {
      ElMessage.error(`「${file.name}」超过 20MB 单文件上限`)
      continue
    }
    accepted.push(file)
  }
  if (!accepted.length) return
  try {
    const docs = await knowledgeStore.upload(currentKbId.value, accepted)
    ElNotification.success({
      title: '导入成功',
      message: `已导入 ${docs.length} 个文档，解析完成后会通知你`
    })
    watchKb(
      currentKbId.value,
      docs.map((d) => d.id),
      { names: Object.fromEntries(docs.map((d) => [d.id, d.name])) }
    )
    watchedKbIds.add(currentKbId.value)
  } catch (e) {
    /* 上传失败：request 拦截器已提示 */
  }
}

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

/** 收藏回答：成功置星标；重复收藏（409 / Mock 提示）仅对齐本地状态；其余失败不置位 */
async function handleFavorite(msgId) {
  if (favoriteIds.value.has(msgId)) return
  try {
    await addFavorite(msgId)
    favoriteIds.value.add(msgId)
    ElMessage.success('已收藏')
  } catch (e) {
    // 409「已收藏」或 Mock 重复收藏：提示已由响应拦截器给出，这里只把状态对齐
    if (e?.response?.status === 409 || e?.message === '已收藏') {
      favoriteIds.value.add(msgId)
    }
    /* 其余失败不置位，星标保持未收藏 */
  }
}

/* ===== 引用原文预览：点击引用直达原文，PDF 定位到引用页码 ===== */
const docPreview = ref({ visible: false, docId: '', name: '', type: '', page: 1 })
/** 当前引用来源（片段抽屉从原文预览跳回时复用） */
const snippetSource = ref(null)

function handlePreview(source) {
  // 有文档 ID 时直达原文预览（PDF 定位页码）；否则退回片段抽屉
  if (source?.docId) {
    snippetSource.value = source
    docPreview.value = {
      visible: true,
      docId: source.docId,
      name: source.docName || '文档预览',
      type: source.docType || '',
      page: Number(source.page) || 1
    }
    return
  }
  openSnippetDrawer()
}

/** 从原文预览的「片段信息」跳回片段抽屉（切片对照 + 划词追问） */
function openSnippetDrawer() {
  preview.value = snippetSource.value
  previewVisible.value = true
}

/* ===== 划词追问（预览抽屉内） ===== */

/** 隐藏浮动操作条并清空选中文本 */
function hideSelBar() {
  selBar.value.visible = false
  selectedText = ''
}

/** 容器 mouseup：选区非空且落在片段内容区时，在选区附近显示操作条 */
function handlePreviewMouseUp() {
  if (!previewVisible.value) return
  const container = previewContentRef.value
  const sel = window.getSelection()
  const text = (sel?.toString() || '').trim()
  if (!container || !sel || sel.isCollapsed || !text || !container.contains(sel.anchorNode)) {
    hideSelBar()
    return
  }
  let rect
  try {
    rect = sel.getRangeAt(0).getBoundingClientRect()
  } catch (e) {
    return
  }
  if (!rect || (!rect.width && !rect.height)) return
  // 坐标取「选区 − 容器」差值：两者同受抽屉滚动影响，差值即容器内的静态偏移
  const host = previewRef.value
  if (!host) return
  const hostRect = host.getBoundingClientRect()
  const BAR_W = 216
  const BAR_H = 32
  let top = rect.top - hostRect.top - BAR_H - 8
  if (top < 0) top = rect.bottom - hostRect.top + 8 // 贴顶时放到选区下方
  let left = rect.left - hostRect.left + rect.width / 2 - BAR_W / 2
  left = Math.min(Math.max(left, 4), Math.max(hostRect.width - BAR_W - 4, 4))
  selectedText = text
  selBar.value = { visible: true, top: Math.max(top, 0), left: Math.max(left, 4) }
}

/** 点击操作条以外任意处隐藏（操作条自身 @mousedown.prevent 防止选区塌陷） */
function onDocMouseDown(e) {
  if (!selBar.value.visible) return
  const inBar = e.target instanceof Element && e.target.closest?.('.sel-bar')
  if (!inBar) hideSelBar()
}

/** 抽屉滚动时选区位置失效，直接隐藏 */
function onDocScroll() {
  if (selBar.value.visible) hideSelBar()
}

/** 选区被清空（如 Ctrl 取消选择）时隐藏 */
function onDocSelectionChange() {
  if (!selBar.value.visible) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) hideSelBar()
}

/** 中英文粗判：用于翻译方向（CJK 字符数 ≥ 拉丁字母数则视为中文） */
function isMostlyChinese(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (text.match(/[A-Za-z]/g) || []).length
  return cjk >= latin
}

/** 选中文本 → 引用块消息（后端零改动，回答天然带文档上下文） */
function buildQuotedMessage(action, text) {
  const docName = preview.value?.docName || '当前文档'
  const quote = text
    .split('\n')
    .map((l) => `> ${l.trim()}`)
    .filter((l) => l.trim() !== '>')
    .join('\n')
  if (action === 'explain') {
    return `请解释下面这段内容（出自《${docName}》）：\n\n${quote}\n\n要求：用通俗易懂的中文解释这段话的含义，涉及专业术语时先一句话定义再展开。`
  }
  if (action === 'translate') {
    const target = isMostlyChinese(text) ? '英文' : '中文'
    return `请把下面这段内容翻译成${target}（出自《${docName}》）：\n\n${quote}\n\n要求：忠实原意、译文通顺自然，直接给出译文。`
  }
  return `请结合《${docName}》中下面这段内容回答我的问题：\n\n${quote}\n\n我的问题：`
}

/** 划词操作条点击：解释/翻译直接发送，提问则注入输入框由用户补全 */
function quoteAction(action) {
  const text = selectedText
  if (!text) return
  hideSelBar()
  previewVisible.value = false
  if (action === 'ask') {
    input.value = buildQuotedMessage('ask', text)
    nextTick(() => chatInputRef.value?.focus())
    return
  }
  if (chatStore.streaming) {
    ElMessage.warning('正在生成回答，请稍候再提问')
    return
  }
  handleSend({ content: buildQuotedMessage(action, text) })
}

/* ===== 后续问题建议 ===== */

/** 点击建议：清空建议并直接以该问题发送 */
function handleFollowup(question) {
  chatStore.followups = []
  handleSend({ content: question })
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
.preview {
  position: relative; /* 划词操作条的定位基准 */
}

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

/* 划词浮动操作条 */
.sel-bar {
  position: absolute;
  z-index: 20;
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-s);
  box-shadow: var(--shadow);
}

.sel-btn {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--c-text-2);
  white-space: nowrap;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.16s;
}

.sel-btn:hover {
  color: var(--brand);
  background: var(--brand-soft);
}

/* 后续问题建议 chips */
.followups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 0 16px 40px;
}

.followup-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--c-text-2);
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.16s;
}

.followup-chip:hover {
  color: var(--brand);
  background: var(--brand-soft);
  border-color: var(--brand);
}

/* 拖拽导入遮罩 */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.drop-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 52px;
  background: var(--c-bg);
  border: 2px dashed var(--brand);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.drop-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1);
}

.drop-sub {
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
