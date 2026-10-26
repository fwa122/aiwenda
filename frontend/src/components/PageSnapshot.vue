<template>
  <!-- 引用卡内嵌「原文页快照」：仅 PDF 且有页码时渲染（v0.9.63 方案A，零后端改动） -->
  <div v-if="isPdf" class="page-snap" @click.stop>
    <button class="snap-toggle" :class="{ open }" @click="toggle">
      <el-icon :size="12"><Picture /></el-icon>
      <span>原文第 {{ page }} 页快照</span>
      <el-icon :size="11" class="caret" :class="{ open }"><ArrowDown /></el-icon>
    </button>

    <div v-show="open" class="snap-body">
      <div v-if="loading" class="snap-state" v-loading="true" element-loading-text="正在渲染原文页…" />
      <template v-else-if="failed">
        <div class="snap-state snap-failed">快照加载失败（文档可能已更新或被删除）</div>
      </template>
      <div v-else ref="wrapRef" class="snap-wrap">
        <vue-pdf-embed
          v-if="pdfUrl"
          :source="pdfUrl"
          :page="page"
          :width="pdfWidth"
          class="snap-pdf"
          @loading-failed="failed = true"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, nextTick } from 'vue'
import VuePdfEmbed from 'vue-pdf-embed'
import { fetchDocumentFile } from '@/api/knowledge'

const props = defineProps({
  docId: { type: String, default: '' },
  docType: { type: String, default: '' },
  /** 引用所在页码（1-based，来自切片元数据） */
  page: { type: Number, default: 0 },
  docName: { type: String, default: '' }
})

const isPdf = computed(() => {
  const t = (props.docType || '').toLowerCase()
  return t === 'pdf' && props.docId && props.page >= 1
})

const open = ref(false)
const loading = ref(false)
const failed = ref(false)
const pdfUrl = ref('')
const pdfWidth = ref(520)
const wrapRef = ref(null)

async function toggle() {
  open.value = !open.value
  if (open.value && !pdfUrl.value && !failed.value) await load()
  if (open.value) {
    await nextTick()
    measure()
  }
}

async function load() {
  loading.value = true
  try {
    // fetchDocumentFile 内部带会话级缓存：同一文档多个引用只下载一次
    const blob = await fetchDocumentFile(props.docId)
    pdfUrl.value = URL.createObjectURL(blob)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

/** 宽度自适应引用卡容器（与 DocPreviewDrawer 同思路） */
function measure() {
  const el = wrapRef.value
  if (el?.clientWidth) pdfWidth.value = Math.max(el.clientWidth - 2, 320)
}

onBeforeUnmount(() => {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
})
</script>

<style scoped>
.page-snap {
  margin-top: 8px;
}

.snap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  font-size: 11.5px;
  color: var(--brand);
  background: var(--brand-soft);
  border: 1px solid var(--brand-soft);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.16s;
}

.snap-toggle:hover {
  filter: brightness(0.97);
}

.snap-toggle .caret {
  transition: transform 0.2s;
}

.snap-toggle .caret.open {
  transform: rotate(180deg);
}

.snap-body {
  margin-top: 8px;
}

.snap-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  font-size: 12px;
  color: var(--c-text-3);
  background: var(--c-bg-soft);
  border: 1px dashed var(--c-border-soft);
  border-radius: var(--radius-s);
}

.snap-failed {
  color: var(--c-danger, #d03050);
}

.snap-wrap {
  display: flex;
  justify-content: center;
  padding: 6px;
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-s);
  overflow: hidden;
}

.snap-wrap :deep(.vue-pdf-embed) {
  width: 100%;
}
</style>
