<template>
  <div class="msg" :class="[message.role]">
    <div class="avatar" :class="message.role">
      <el-icon v-if="message.role === 'user'" :size="15"><User /></el-icon>
      <el-icon v-else :size="15"><ChatDotRound /></el-icon>
    </div>

    <div class="body">
      <!-- 用户附件 -->
      <div v-if="message.meta?.files?.length" class="files">
        <span v-for="f in message.meta.files" :key="f.name" class="file-chip">
          <el-icon :size="12"><Paperclip /></el-icon>{{ f.name }}
        </span>
      </div>

      <!-- 内容区 -->
      <div class="bubble" :class="{ plain: message.role === 'assistant', error: isError }">
        <!-- 检索 / 生成阶段提示 -->
        <div v-if="showStage" class="stage">
          <el-icon class="loading" :size="14"><Loading /></el-icon>
          <span>{{ stageText || '正在检索知识库…' }}</span>
        </div>

        <div
          v-else
          class="md-body"
          :class="{ 'stream-cursor': isStreaming }"
          v-html="renderedHtml"
          @click="handleContentClick"
        />

        <div v-if="message.status === 'stopped'" class="stopped-tip">
          <el-icon :size="12"><VideoPause /></el-icon> 已停止生成
        </div>
      </div>

      <!-- 引用来源 -->
      <SourceList
        :sources="message.sources || []"
        :default-expanded="sourceDefaultExpanded"
        @preview="$emit('preview', $event)"
      />

      <!-- 工具栏 -->
      <div v-if="!showStage" class="toolbar">
        <span class="time">{{ formatDateTime(message.createdAt, 'HH:mm:ss') }}</span>

        <template v-if="message.role === 'assistant'">
          <el-tooltip content="复制" placement="top">
            <button class="tool" @click="handleCopy">
              <el-icon :size="14"><DocumentCopy /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="重新生成" placement="top">
            <button class="tool" :disabled="isStreaming" @click="$emit('regenerate', message.id)">
              <el-icon :size="14"><RefreshRight /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="有帮助" placement="top">
            <button
              class="tool"
              :class="{ active: message.feedback === 'like' }"
              @click="$emit('feedback', message.id, 'like')"
            >
              <el-icon :size="14"><CircleCheck /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="没帮助" placement="top">
            <button
              class="tool"
              :class="{ active: message.feedback === 'dislike' }"
              @click="$emit('feedback', message.id, 'dislike')"
            >
              <el-icon :size="14"><CircleClose /></el-icon>
            </button>
          </el-tooltip>
        </template>

        <span v-if="message.role === 'assistant' && message.meta" class="meta-info">
          {{ message.meta.model }}
          <template v-if="message.sources?.length">· 引用 {{ message.sources.length }} 个来源</template>
          <template v-if="message.meta.elapsedMs">· {{ formatDuration(message.meta.elapsedMs) }}</template>
          <template v-if="message.meta.tokens?.total">
            · {{ formatNumber(message.meta.tokens.total) }} tokens
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { renderMarkdown } from '@/utils/markdown'
import { formatDateTime, formatDuration, formatNumber } from '@/utils/format'
import SourceList from './SourceList.vue'

const props = defineProps({
  message: { type: Object, required: true },
  /** 当前是否处于生成中（由父组件传入，用于显示光标） */
  streaming: { type: Boolean, default: false },
  stageText: { type: String, default: '' },
  /** 最新一条助手消息的来源列表默认展开 */
  sourceDefaultExpanded: { type: Boolean, default: false }
})

const emit = defineEmits(['regenerate', 'preview', 'feedback'])

const isStreaming = computed(() => props.message.status === 'streaming')
const isError = computed(() => props.message.status === 'error')
/** 已开始生成但还没有任何文本时显示阶段提示 */
const showStage = computed(() => isStreaming.value && !props.message.content)

const renderedHtml = computed(() => renderMarkdown(props.message.content || ''))

/** 内容区点击委托：内联引用徽标 [n] → 打开来源预览；代码复制按钮 → 复制代码 */
function handleContentClick(e) {
  const target = e.target
  if (target?.classList?.contains('cite')) {
    const index = Number(target.dataset.cite)
    const source = (props.message.sources || []).find((s) => s.index === index)
    if (source) emit('preview', source)
    return
  }
  if (target?.classList?.contains('code-copy')) {
    const code = target.parentElement?.querySelector('pre code')?.textContent || ''
    if (code) copyText(code)
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success('已复制到剪贴板')
  }
}

async function handleCopy() {
  await copyText(props.message.content || '')
}
</script>

<style scoped>
.msg {
  display: flex;
  gap: 12px;
  padding: 20px 0;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  color: #fff;
  border-radius: 8px;
}

.avatar.user {
  background: linear-gradient(135deg, #6b8ff5, #3f6ae1);
}

.avatar:not(.user) {
  color: var(--brand);
  background: var(--brand-soft);
}

.body {
  flex: 1;
  min-width: 0;
}

.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--c-text-2);
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border-soft);
  border-radius: 4px;
}

/* 气泡 */
.bubble {
  padding: 12px 16px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: 4px var(--radius-l) var(--radius-l) var(--radius-l);
  box-shadow: var(--shadow-s);
}

.bubble.plain {
  padding: 2px 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

.bubble.error {
  padding: 10px 14px;
  color: var(--c-danger);
  background: var(--c-danger-soft);
  border: 1px solid #f7c9ce;
  border-radius: var(--radius);
}

/* 阶段提示 */
.stage {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--c-text-3);
}

.loading {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.stopped-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--c-text-4);
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  min-height: 24px;
}

.time {
  margin-right: 4px;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  color: var(--c-text-3);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.16s;
}

.tool:hover:not(:disabled) {
  color: var(--brand);
  background: var(--brand-soft);
}

.tool.active {
  color: var(--brand);
}

.tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.meta-info {
  margin-left: 8px;
  font-size: 11.5px;
  color: var(--c-text-4);
}
</style>
