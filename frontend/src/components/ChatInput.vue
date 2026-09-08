<template>
  <div class="chat-input">
    <div class="input-box" :class="{ focused }">
      <!-- 附件预览 -->
      <div v-if="files.length" class="file-list">
        <span v-for="(file, i) in files" :key="i" class="file-item">
          <DocTypeIcon :type="extOf(file.name)" />
          <span class="text-ellipsis">{{ file.name }}</span>
          <el-icon class="del" :size="12" @click="removeFile(i)"><Close /></el-icon>
        </span>
      </div>

      <textarea
        ref="textareaRef"
        v-model="inner"
        class="textarea scroll-thin"
        :placeholder="placeholder"
        :disabled="disabled"
        rows="1"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <div class="toolbar">
        <div class="toolbar-left">
          <!-- 知识库选择 -->
          <el-select
            :model-value="kbIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="1"
            placeholder="选择知识库"
            size="small"
            class="kb-select"
            @update:model-value="$emit('update:kbIds', $event)"
          >
            <el-option
              v-for="kb in kbOptions"
              :key="kb.id"
              :label="kb.name"
              :value="kb.id"
              :disabled="kb.status !== 'ready'"
            >
              <span>{{ kb.name }}</span>
              <span class="opt-meta">{{ kb.docCount }} 个文档</span>
            </el-option>
          </el-select>

          <!-- 模型选择 -->
          <el-select
            :model-value="model"
            placeholder="模型"
            size="small"
            class="model-select"
            @update:model-value="$emit('update:model', $event)"
          >
            <el-option v-for="m in modelOptions" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>

          <el-tooltip content="上传附件（仅本次回答有效，最多 2 个、单个 5MB）" placement="top">
            <button class="icon-btn" @click="fileInputRef?.click()">
              <el-icon :size="15"><Paperclip /></el-icon>
            </button>
          </el-tooltip>
          <input
            ref="fileInputRef"
            type="file"
            multiple
            :accept="acceptExts"
            class="hidden-file-input"
            @change="onFilePicked"
          />

          <!-- 检索设置 -->
          <el-popover placement="top-start" :width="296" trigger="click">
            <template #reference>
              <el-tooltip content="检索设置" placement="top">
                <button class="icon-btn" :class="{ active: hasRetrieverOverride }">
                  <el-icon :size="15"><Operation /></el-icon>
                </button>
              </el-tooltip>
            </template>

            <div class="ret-pop">
              <div class="ret-head">
                <span>检索设置</span>
                <button v-if="hasRetrieverOverride" class="ret-reset" @click="resetRetriever">
                  重置
                </button>
              </div>

              <div class="ret-row">
                <div class="ret-label">
                  召回数量 TopK
                  <span class="ret-val">{{ retriever.topK ?? 5 }}</span>
                </div>
                <el-slider
                  :model-value="retriever.topK ?? 5"
                  :min="1"
                  :max="10"
                  :step="1"
                  size="small"
                  @update:model-value="(v) => setRetriever('topK', v)"
                />
              </div>

              <div class="ret-row">
                <div class="ret-label">
                  相似度阈值
                  <span class="ret-val">{{ (retriever.threshold ?? 0.28).toFixed(2) }}</span>
                </div>
                <el-slider
                  :model-value="retriever.threshold ?? 0.28"
                  :min="0"
                  :max="0.9"
                  :step="0.05"
                  size="small"
                  @update:model-value="(v) => setRetriever('threshold', v)"
                />
              </div>

              <div class="ret-switch">
                <div class="ret-label">混合检索</div>
                <el-switch
                  :model-value="retriever.hybrid ?? true"
                  size="small"
                  @update:model-value="(v) => setRetriever('hybrid', v)"
                />
              </div>
              <div class="ret-switch">
                <div class="ret-label">融合重排</div>
                <el-switch
                  :model-value="retriever.rerank ?? true"
                  size="small"
                  @update:model-value="(v) => setRetriever('rerank', v)"
                />
              </div>

              <p class="ret-tip">调整后对下一次提问生效，优先于知识库默认配置。</p>
            </div>
          </el-popover>
        </div>

        <div class="toolbar-right">
          <span v-if="charCount" class="char-count">{{ charCount }} 字</span>
          <el-tooltip v-if="streaming" content="停止生成" placement="top">
            <button class="stop-btn" @click="$emit('stop')">
              <el-icon :size="14"><VideoPause /></el-icon>停止
            </button>
          </el-tooltip>
          <button v-else class="send-btn" :disabled="!canSend" @click="handleSend">
            <el-icon :size="15"><Promotion /></el-icon>发送
          </button>
        </div>
      </div>
    </div>

    <!-- 快捷引导词 -->
    <div v-if="quickPrompts.length" class="quick">
      <span
        v-for="p in quickPrompts"
        :key="p"
        class="quick-chip"
        @click="appendPrompt(p)"
      >{{ p }}</span>
    </div>

    <p class="hint">内容由 AI 生成，请核对引用来源后使用 · Enter 发送 / Shift + Enter 换行</p>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DocTypeIcon from './DocTypeIcon.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '输入你的问题，Enter 发送…' },
  disabled: { type: Boolean, default: false },
  streaming: { type: Boolean, default: false },
  kbIds: { type: Array, default: () => [] },
  kbOptions: { type: Array, default: () => [] },
  model: { type: String, default: '' },
  modelOptions: { type: Array, default: () => [] },
  quickPrompts: { type: Array, default: () => [] },
  /** 会话级检索参数覆盖（v0.7.0 新增） */
  retriever: { type: Object, default: () => ({}) }
})

const emit = defineEmits([
  'update:modelValue',
  'send',
  'stop',
  'update:kbIds',
  'update:model',
  'update:retriever'
])

const textareaRef = ref(null)
const focused = ref(false)
const files = ref([])
const inner = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const charCount = computed(() => (inner.value || '').trim().length)
const canSend = computed(() => charCount.value > 0 && !props.disabled)

watch(() => props.modelValue, () => nextTick(autoResize))

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    handleSend()
  }
}

const hasRetrieverOverride = computed(() =>
  props.retriever && Object.keys(props.retriever).length > 0
)

function setRetriever(key, value) {
  emit('update:retriever', { ...props.retriever, [key]: value })
}

function resetRetriever() {
  emit('update:retriever', {})
}

function handleSend() {
  if (!canSend.value) return
  emit('send', { content: inner.value.trim(), files: [...files.value] })
  files.value = []
  nextTick(() => {
    autoResize()
    textareaRef.value?.focus()
  })
}

function appendPrompt(text) {
  inner.value = inner.value ? `${inner.value.trim()}，${text}` : text
  nextTick(() => {
    autoResize()
    textareaRef.value?.focus()
  })
}

function extOf(name = '') {
  return (name.split('.').pop() || 'txt').toLowerCase()
}

function removeFile(index) {
  files.value.splice(index, 1)
}

/** ===== 附件：真实文件选择（白名单/数量/大小校验），随发送上传提取 ===== */
const fileInputRef = ref(null)
const ATTACH_EXTS = ['pdf', 'docx', 'txt', 'md', 'csv']
const ATTACH_MAX_SIZE = 5 * 1024 * 1024
const acceptExts = ATTACH_EXTS.map((e) => `.${e}`).join(',')

function onFilePicked(e) {
  const picked = Array.from(e.target.files || [])
  e.target.value = '' // 允许重复选择同一文件
  for (const f of picked) {
    const ext = extOf(f.name)
    if (!ATTACH_EXTS.includes(ext)) {
      ElMessage.warning(`不支持的附件格式 .${ext}，仅允许: ${ATTACH_EXTS.join(', ')}`)
      continue
    }
    if (f.size > ATTACH_MAX_SIZE) {
      ElMessage.warning(`「${f.name}」超过 5MB 上限`)
      continue
    }
    if (files.value.length >= 2) {
      ElMessage.warning('每次最多上传 2 个附件')
      break
    }
    files.value.push(f)
  }
}

defineExpose({ focus: () => textareaRef.value?.focus() })
</script>

<style scoped>
.chat-input {
  padding: 8px 0 4px;
}

.input-box {
  padding: 10px 12px 8px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-s);
  transition: border-color 0.18s, box-shadow 0.18s;
}

.input-box.focused {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(63, 106, 225, 0.08);
}

.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--c-border-soft);
}

.file-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--c-text-2);
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border-soft);
  border-radius: 4px;
}

.del {
  cursor: pointer;
  color: var(--c-text-4);
}

.del:hover {
  color: var(--c-danger);
}

.textarea {
  display: block;
  width: 100%;
  min-height: 24px;
  max-height: 180px;
  padding: 4px 2px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-text);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
}

.textarea::placeholder {
  color: var(--c-text-4);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kb-select {
  width: 168px;
}

.model-select {
  width: 150px;
}

.opt-meta {
  float: right;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.hidden-file-input {
  display: none;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  color: var(--c-text-3);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.16s;
}

.icon-btn:hover {
  color: var(--brand);
  background: var(--brand-soft);
}

.char-count {
  font-size: 11.5px;
  color: var(--c-text-4);
}

.send-btn,
.stop-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: var(--brand);
  border: none;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: all 0.16s;
}

.send-btn:hover:not(:disabled) {
  background: var(--brand-hover);
}

.send-btn:disabled {
  color: var(--c-text-4);
  background: var(--c-bg-hover);
  cursor: not-allowed;
}

.stop-btn {
  color: var(--c-text-2);
  background: var(--c-bg-hover);
}

.stop-btn:hover {
  background: var(--c-bg-active);
}

.quick {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}

.quick-chip {
  padding: 4px 12px;
  font-size: 12.5px;
  color: var(--c-text-2);
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.16s;
}

.quick-chip:hover {
  color: var(--brand);
  background: var(--brand-soft);
  border-color: var(--brand);
}

.hint {
  margin-top: 10px;
  font-size: 11.5px;
  text-align: center;
  color: var(--c-text-4);
}

/* 检索设置弹层 */
.ret-pop {
  padding: 2px 4px;
}

.ret-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.ret-reset {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--brand);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--brand-soft);
  border-radius: 4px;
}

.ret-reset:hover {
  background: var(--brand-soft);
}

.ret-row {
  margin-bottom: 10px;
}

.ret-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--c-text-2);
}

.ret-val {
  font-weight: 600;
  color: var(--brand);
}

.ret-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ret-tip {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--c-text-4);
}

.icon-btn.active {
  color: var(--brand);
  background: var(--brand-soft);
}
</style>
