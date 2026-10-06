<template>
  <el-dialog
    :model-value="modelValue"
    width="560px"
    append-to-body
    :show-close="false"
    class="global-search-dialog"
    @update:model-value="onDialogVisibleChange"
    @opened="onOpened"
  >
    <!-- 搜索输入：打开时自动聚焦，↑↓ 移动、Enter 跳转、Esc 关闭 -->
    <div class="gs-input-wrap">
      <el-icon :size="16" class="gs-input-icon"><Search /></el-icon>
      <input
        ref="inputRef"
        v-model="keyword"
        class="gs-input"
        placeholder="搜索会话 / 文档 / 回答内容…"
        @keydown.down.prevent="moveActive(1)"
        @keydown.up.prevent="moveActive(-1)"
        @keydown.enter.prevent="handleEnter"
        @keydown.esc.prevent="handleEsc"
      />
    </div>

    <div v-loading="loading" class="gs-body scroll-thin">
      <template v-if="groups.length">
        <div v-for="group in groups" :key="group.type" class="gs-group">
          <div class="gs-group-title">{{ group.label }}</div>
          <button
            v-for="(item, i) in group.items"
            :key="item.key"
            class="gs-item"
            :class="{ active: item.flatIndex === activeIndex }"
            @click="jump(item)"
            @mouseenter="activeIndex = item.flatIndex"
          >
            <el-icon :size="15" class="gs-item-icon">
              <component :is="group.icon" />
            </el-icon>
            <span class="gs-item-main">
              <!-- highlight 内部先转义再包 <mark>，无 XSS 风险 -->
              <span class="gs-item-title" v-html="highlight(item.title)"></span>
              <span class="gs-item-sub">{{ item.sub }}</span>
            </span>
            <el-icon :size="12" class="gs-item-arrow"><ArrowRight /></el-icon>
          </button>
        </div>
      </template>

      <div v-else-if="keyword.trim()" class="gs-empty">
        未找到与「{{ keyword.trim() }}」相关的内容
      </div>
      <div v-else class="gs-empty">输入关键词，搜索会话、文档与回答内容</div>
    </div>

    <div class="gs-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> 切换</span>
      <span><kbd>Enter</kbd> 打开</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, ChatDotRound, ChatLineRound, Collection, Search } from '@element-plus/icons-vue'
import { searchAll } from '@/api/chat'
import { formatDateTime } from '@/utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const router = useRouter()
const inputRef = ref(null)
const keyword = ref('')
const loading = ref(false)
const activeIndex = ref(0)
const result = ref({ conversations: [], documents: [], messages: [] })

/** 三分组 → 统一条目结构（含扁平索引与跳转路径） */
const groups = computed(() => {
  const out = []
  const convs = (result.value.conversations || []).map((c, i) => ({
    key: `conv_${c.id}`,
    flatIndex: i,
    title: c.title || '未命名会话',
    sub: formatDateTime(c.updatedAt),
    path: `/chat/${c.id}`
  }))
  if (convs.length) out.push({ type: 'conversation', label: '会话', icon: ChatDotRound, items: convs })

  const docs = (result.value.documents || []).map((d, i) => ({
    key: `doc_${d.id}`,
    flatIndex: convs.length + i,
    title: d.name,
    sub: d.kbName || '知识库',
    path: `/knowledge/${d.kbId}`
  }))
  if (docs.length) out.push({ type: 'document', label: '文档', icon: Collection, items: docs })

  const msgs = (result.value.messages || []).map((m, i) => ({
    key: `msg_${m.conversationId}_${i}`,
    flatIndex: convs.length + docs.length + i,
    title: m.snippet || String(m.content || '').slice(0, 120),
    sub: `${m.conversationTitle || '会话'} · ${formatDateTime(m.createdAt)}`,
    path: `/chat/${m.conversationId}`
  }))
  if (msgs.length) out.push({ type: 'message', label: '回答内容', icon: ChatLineRound, items: msgs })

  return out
})

const flatCount = computed(() => groups.value.reduce((sum, g) => sum + g.items.length, 0))

/** 关键词高亮：先 HTML 转义原文本，再包裹命中片段 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function highlight(text) {
  const raw = String(text || '')
  const kw = keyword.value.trim()
  if (!kw) return escapeHtml(raw)
  const lower = raw.toLowerCase()
  const k = kw.toLowerCase()
  let out = ''
  let cursor = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const idx = lower.indexOf(k, cursor)
    if (idx < 0) {
      out += escapeHtml(raw.slice(cursor))
      break
    }
    out += `${escapeHtml(raw.slice(cursor, idx))}<mark>${escapeHtml(raw.slice(idx, idx + k.length))}</mark>`
    cursor = idx + k.length
  }
  return out
}

/* ---------------- 搜索（300ms 防抖 + 过期响应丢弃） ---------------- */
let debounceTimer = null

watch(keyword, (value) => {
  clearTimeout(debounceTimer)
  const kw = value.trim()
  if (!kw) {
    result.value = { conversations: [], documents: [], messages: [] }
    loading.value = false
    return
  }
  loading.value = true
  debounceTimer = setTimeout(async () => {
    try {
      const res = await searchAll(kw)
      if (kw !== keyword.value.trim()) return // 输入已变化，丢弃过期响应
      result.value = {
        conversations: res?.conversations || [],
        documents: res?.documents || [],
        messages: res?.messages || []
      }
      activeIndex.value = 0
    } catch (e) {
      /* 搜索失败静默：保持空态，不打断输入 */
    } finally {
      if (kw === keyword.value.trim()) loading.value = false
    }
  }, 300)
})

/* ---------------- 打开 / 关闭 ---------------- */

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // 每次打开清空上次结果，避免残留旧关键词的命中
      keyword.value = ''
      result.value = { conversations: [], documents: [], messages: [] }
      activeIndex.value = 0
      loading.value = false
    }
  }
)

function onOpened() {
  nextTick(() => inputRef.value?.focus())
}

function onDialogVisibleChange(v) {
  emit('update:modelValue', v)
}

/* ---------------- 键盘导航与跳转 ---------------- */

function moveActive(step) {
  if (!flatCount.value) return
  activeIndex.value = (activeIndex.value + step + flatCount.value) % flatCount.value
}

function currentFlatItem() {
  for (const group of groups.value) {
    const hit = group.items.find((it) => it.flatIndex === activeIndex.value)
    if (hit) return hit
  }
  return null
}

function handleEnter() {
  const item = currentFlatItem()
  if (item) jump(item)
}

function handleEsc() {
  emit('update:modelValue', false)
}

/** 跳转：会话 → 会话详情；文档 → 所属知识库；回答 → 所属会话。跳转后关闭并清空 */
function jump(item) {
  if (!item?.path) return
  emit('update:modelValue', false)
  keyword.value = ''
  result.value = { conversations: [], documents: [], messages: [] }
  router.push(item.path)
}
</script>

<style scoped>
.global-search-dialog :deep(.el-dialog) {
  padding: 0;
  border-radius: var(--radius, 10px);
  overflow: hidden;
}

/* 搜索输入行 */
.gs-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border-soft, #e5e7eb);
}

.gs-input-icon {
  flex-shrink: 0;
  color: var(--c-text-4, #9ca3af);
}

.gs-input {
  flex: 1;
  font-size: 15px;
  color: var(--c-text-1, #1f2937);
  background: transparent;
  border: none;
  outline: none;
}

.gs-input::placeholder {
  color: var(--c-text-4, #9ca3af);
}

/* 结果区 */
.gs-body {
  max-height: 380px;
  min-height: 120px;
  padding: 8px 8px 12px;
  overflow-y: auto;
}

.gs-group {
  margin-bottom: 6px;
}

.gs-group-title {
  padding: 8px 12px 4px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--c-text-4, #9ca3af);
  letter-spacing: 0.3px;
}

.gs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-s, 6px);
  cursor: pointer;
  transition: background 0.14s;
}

.gs-item.active {
  background: var(--brand-soft, #eef2ff);
}

.gs-item-icon {
  flex-shrink: 0;
  color: var(--c-text-4, #9ca3af);
}

.gs-item.active .gs-item-icon {
  color: var(--brand, #3f6ae1);
}

.gs-item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gs-item-title {
  font-size: 13.5px;
  color: var(--c-text-1, #1f2937);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gs-item-title :deep(mark) {
  color: var(--brand, #3f6ae1);
  font-weight: 600;
  background: transparent;
  padding: 0;
}

.gs-item-sub {
  font-size: 11.5px;
  color: var(--c-text-4, #9ca3af);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gs-item-arrow {
  flex-shrink: 0;
  color: var(--c-text-4, #9ca3af);
  opacity: 0;
  transition: opacity 0.14s;
}

.gs-item.active .gs-item-arrow {
  opacity: 1;
}

/* 空态 */
.gs-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  font-size: 13px;
  color: var(--c-text-4, #9ca3af);
}

/* 底部快捷键提示 */
.gs-footer {
  display: flex;
  gap: 14px;
  padding: 8px 18px;
  font-size: 11px;
  color: var(--c-text-4, #9ca3af);
  border-top: 1px solid var(--c-border-soft, #e5e7eb);
}

.gs-footer kbd {
  padding: 1px 5px;
  margin-right: 3px;
  font-family: inherit;
  font-size: 10px;
  background: var(--c-bg-soft, #f5f6f8);
  border: 1px solid var(--c-border, #e0e2e8);
  border-radius: 4px;
}
</style>
