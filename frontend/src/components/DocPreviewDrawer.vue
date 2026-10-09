<template>
  <el-drawer
    :model-value="modelValue"
    :title="name || '文档预览'"
    size="62%"
    append-to-body
    @update:model-value="(v) => emit('update:modelValue', v)"
    @closed="reset"
  >
    <div v-loading="loading" element-loading-text="正在加载文档…" class="doc-preview">
      <template v-if="docId">
        <!-- PDF：vue-pdf-embed 单页渲染，支持页码跳转（引用定位核心链路） -->
        <template v-if="kind === 'pdf'">
          <div class="pdf-toolbar">
            <el-button size="small" :disabled="curPage <= 1" @click="curPage -= 1">
              <el-icon><ArrowLeft /></el-icon>上一页
            </el-button>
            <span class="page-indicator">第 <b>{{ curPage }}</b> / {{ numPages || '…' }} 页</span>
            <el-button size="small" :disabled="curPage >= numPages" @click="curPage += 1">
              下一页<el-icon><ArrowRight /></el-icon>
            </el-button>
            <span v-if="initialPage > 1" class="cite-locate">引用位于第 {{ initialPage }} 页</span>

            <div class="toolbar-right">
              <el-button v-if="showSnippetAction" size="small" text @click="emit('snippet')">
                <el-icon><Memo /></el-icon>片段信息
              </el-button>
              <el-button size="small" text @click="handleDownload">
                <el-icon><Download /></el-icon>下载
              </el-button>
            </div>
          </div>
          <div ref="pdfWrapRef" class="pdf-wrap">
            <VuePdfEmbed
              v-if="pdfSource"
              :source="pdfSource"
              :page="curPage"
              :width="pdfWidth"
              @loaded="onPdfLoaded"
              @loading-failed="onPdfError"
            />
          </div>
        </template>

        <!-- 文本类：md 渲染 Markdown，txt/csv 直接展示 -->
        <div v-else-if="kind === 'text'" class="text-frame">
          <div v-if="html" class="md-body" v-html="html" />
          <pre v-else class="plain-text">{{ plain }}</pre>
        </div>

        <!-- 其余格式：引导下载 -->
        <div v-else class="preview-fallback">
          <el-empty description="该格式暂不支持在线预览" :image-size="90" />
          <el-button type="primary" size="small" @click="handleDownload">下载后查看</el-button>
        </div>
      </template>
      <el-empty v-else description="缺少文档信息，无法预览" :image-size="90" />
    </div>
  </el-drawer>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import VuePdfEmbed from 'vue-pdf-embed'
import { fetchDocumentFile, downloadDocument } from '@/api/knowledge'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps({
  /** 抽屉可见性（v-model） */
  modelValue: { type: Boolean, default: false },
  /** 文档 ID（后端文件流接口入参） */
  docId: { type: String, default: '' },
  /** 文档名（抽屉标题） */
  name: { type: String, default: '' },
  /** 文档类型（pdf / md / txt / csv / …），决定渲染方式 */
  type: { type: String, default: '' },
  /** PDF 初始页码（引用定位；打开时定位到该页） */
  page: { type: Number, default: 1 },
  /** 是否显示「片段信息」按钮（配合引用片段抽屉使用） */
  showSnippetAction: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'snippet'])

const loading = ref(false)
const html = ref('')
const plain = ref('')
const pdfSource = ref('')
const numPages = ref(0)
const curPage = ref(1)
const pdfWidth = ref(600)
const pdfWrapRef = ref(null)

/** 记录打开时的目标页码，用于工具栏展示「引用位于第 N 页」 */
const initialPage = ref(1)

const kind = computed(() => {
  const t = (props.type || '').toLowerCase()
  if (t === 'pdf') return 'pdf'
  if (['md', 'txt', 'csv'].includes(t)) return 'text'
  return 'other'
})

/* 打开时拉取文件流 */
watch(
  () => [props.modelValue, props.docId],
  ([visible, docId]) => {
    if (!visible || !docId) return
    load()
  }
)

async function load() {
  loading.value = true
  html.value = ''
  plain.value = ''
  // 连续切换引用时释放上一份 PDF 的 blob URL，避免泄漏
  if (pdfSource.value) URL.revokeObjectURL(pdfSource.value)
  pdfSource.value = ''
  numPages.value = 0
  curPage.value = props.page || 1
  initialPage.value = props.page || 1
  try {
    const blob = await fetchDocumentFile(props.docId)
    if (kind.value === 'pdf') {
      pdfSource.value = URL.createObjectURL(blob)
    } else if (kind.value === 'text') {
      const text = await blob.text()
      html.value = props.type.toLowerCase() === 'md' ? renderMarkdown(text) : ''
      if (!html.value) plain.value = text
    }
  } catch (e) {
    ElMessage.error(e.message || '文件加载失败')
    emit('update:modelValue', false)
  } finally {
    loading.value = false
  }
}

function onPdfLoaded(doc) {
  numPages.value = doc.numPages
  // 引用页码可能超过实际页数（文档更新后页码漂移），夹取到有效范围
  if (curPage.value > doc.numPages) curPage.value = doc.numPages
  if (curPage.value < 1) curPage.value = 1
  measurePdfWidth()
}

function onPdfError(e) {
  ElMessage.error(e?.message || 'PDF 渲染失败')
}

/* PDF 宽度自适应抽屉内容区 */
function measurePdfWidth() {
  const el = pdfWrapRef.value
  if (el?.clientWidth) pdfWidth.value = Math.max(el.clientWidth - 2, 320)
}

onMounted(() => window.addEventListener('resize', measurePdfWidth))
onBeforeUnmount(() => window.removeEventListener('resize', measurePdfWidth))

async function handleDownload() {
  try {
    await downloadDocument(props.docId, props.name)
    ElMessage.success('已开始下载')
  } catch (e) {
    ElMessage.error(e.message || '下载失败')
  }
}

/** 关闭动画结束后清理：释放 blob URL 与文本内容 */
function reset() {
  if (pdfSource.value) URL.revokeObjectURL(pdfSource.value)
  pdfSource.value = ''
  html.value = ''
  plain.value = ''
  numPages.value = 0
}
</script>

<style scoped>
.doc-preview {
  height: 100%;
}

/* PDF 工具栏 */
.pdf-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-s);
}

.page-indicator {
  font-size: 12.5px;
  color: var(--c-text-2);
  min-width: 88px;
  text-align: center;
}

.page-indicator b {
  color: var(--brand);
}

.cite-locate {
  padding: 2px 8px;
  font-size: 11.5px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 10px;
}

.toolbar-right {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.pdf-wrap {
  overflow: auto;
  display: flex;
  justify-content: center;
}

.pdf-wrap :deep(.vue-pdf-embed) {
  width: 100%;
}

/* 文本类预览 */
.text-frame {
  height: 100%;
  overflow: auto;
  padding: 16px;
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-s);
}

.plain-text {
  font-size: 13px;
  line-height: 1.8;
  color: var(--c-text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
}
</style>
