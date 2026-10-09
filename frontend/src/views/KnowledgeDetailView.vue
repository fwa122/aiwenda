<template>
  <div v-loading="knowledgeStore.loading" class="page-container">
    <div class="page-inner" style="max-width: 1200px">
      <!-- 返回与标题 -->
      <header class="detail-head">
        <div class="head-left">
          <button class="back-btn" @click="$router.push('/knowledge')">
            <el-icon :size="14"><ArrowLeft /></el-icon>返回
          </button>
          <div v-if="kb" class="title-area">
            <div class="title-row">
              <h1 class="page-title text-ellipsis">{{ kb.name }}</h1>
              <el-tag :type="kbStatusMap[kb.status].type" size="small" effect="light">
                {{ kbStatusMap[kb.status].label }}
              </el-tag>
            </div>
            <p class="page-desc">{{ kb.description || '暂无描述' }}</p>
          </div>
        </div>

        <div v-if="kb" class="head-right">
          <el-button @click="handleRebuild">
            <el-icon><RefreshRight /></el-icon>重建索引
          </el-button>
          <el-button type="primary" @click="$router.push('/chat')">
            <el-icon><ChatDotRound /></el-icon>去提问
          </el-button>
        </div>
      </header>

      <template v-if="kb">
        <!-- 指标条 -->
        <section class="metrics">
          <div v-for="m in metrics" :key="m.label" class="metric-card">
            <div class="m-label">{{ m.label }}</div>
            <div class="m-value">{{ m.value }}</div>
          </div>
        </section>

        <el-tabs v-model="activeTab" class="detail-tabs">
          <!-- 文档管理 -->
          <el-tab-pane label="文档管理" name="docs">
            <div class="tab-toolbar">
              <div class="left">
                <el-input
                  v-model="docKeyword"
                  placeholder="搜索文件名"
                  clearable
                  style="width: 220px"
                >
                  <template #prefix><el-icon><Search /></el-icon></template>
                </el-input>
                <el-select v-model="docStatus" placeholder="全部状态" clearable style="width: 130px" @change="loadDocs">
                  <el-option v-for="(v, k) in docStatusMap" :key="k" :label="v.label" :value="k" />
                </el-select>
                <el-button v-if="selectedDocs.length" type="danger" plain @click="handleBatchDelete">
                  批量删除（{{ selectedDocs.length }}）
                </el-button>
              </div>

              <div class="right">
                <el-upload
                  :http-request="customUpload"
                  :show-file-list="false"
                  multiple
                  accept=".pdf,.doc,.docx,.xlsx,.pptx,.md,.txt,.html,.csv"
                >
                  <el-button type="primary">
                    <el-icon><Upload /></el-icon>上传文档
                  </el-button>
                </el-upload>
              </div>
            </div>

            <!-- 上传进度 -->
            <div v-if="uploading" class="upload-progress">
              <el-progress :percentage="uploadPercent" :stroke-width="6" />
              <span class="text-muted">正在上传并解析文档…</span>
            </div>

            <el-table
              v-loading="knowledgeStore.docLoading"
              :data="knowledgeStore.documents"
              style="width: 100%"
              @selection-change="selectedDocs = $event"
            >
              <el-table-column type="selection" width="44" />
              <el-table-column label="文件名" min-width="260">
                <template #default="{ row }">
                  <div class="doc-cell">
                    <DocTypeIcon :type="row.type" />
                    <el-tooltip :content="row.name" placement="top" :show-after="300" :hide-after="0">
                      <span class="doc-name text-ellipsis">{{ row.name }}</span>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="切片数" width="90" prop="chunkCount" align="right" />
              <el-table-column label="大小" width="100" align="right">
                <template #default="{ row }">{{ formatSize(row.size) }}</template>
              </el-table-column>
              <el-table-column label="页数" width="80" prop="pages" align="right" />
              <el-table-column label="状态" width="150">
                <template #default="{ row }">
                  <el-tag :type="docStatusMap[row.status].type" size="small" effect="light">
                    {{ docStatusMap[row.status].label }}
                  </el-tag>
                  <el-progress
                    v-if="row.status === 'parsing' || row.status === 'indexing'"
                    :percentage="row.progress"
                    :stroke-width="4"
                    style="width: 90px; margin-top: 4px"
                  />
                  <div v-if="row.errorMsg" class="doc-error">{{ row.errorMsg }}</div>
                </template>
              </el-table-column>
              <el-table-column label="上传者" width="100" prop="uploader" />
              <el-table-column label="更新时间" width="160">
                <template #default="{ row }">{{ fromNow(row.updatedAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="250" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openPreview(row)">预览</el-button>
                  <el-button link type="primary" size="small" @click="handleDownload(row)">下载</el-button>
                  <el-button link type="primary" size="small" @click="openChunks(row)">切片</el-button>
                  <el-button link type="primary" size="small" @click="handleReparse(row)">重解析</el-button>
                  <el-button link type="danger" size="small" @click="handleDeleteDoc(row)">删除</el-button>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无文档，点击右上角上传" :image-size="80" />
              </template>
            </el-table>
          </el-tab-pane>

          <!-- 检索测试 -->
          <el-tab-pane label="检索测试" name="search">
            <div class="retrieval">
              <div class="retrieval-form">
                <el-input
                  v-model="query"
                  type="textarea"
                  :rows="3"
                  placeholder="输入测试问题，例如：支持哪些文档格式？"
                  @keydown.ctrl.enter="runRetrieval"
                />
                <div class="param-row">
                  <span class="param">
                    <span class="p-label">Top K</span>
                    <el-input-number v-model="retrieval.topK" :min="1" :max="20" size="small" />
                  </span>
                  <span class="param">
                    <span class="p-label">相似度阈值</span>
                    <el-slider v-model="retrieval.threshold" :min="0" :max="1" :step="0.01" style="width: 150px" />
                    <span class="p-value">{{ retrieval.threshold.toFixed(2) }}</span>
                  </span>
                  <span class="param">
                    <el-checkbox v-model="retrieval.rerank">Rerank 精排</el-checkbox>
                  </span>
                  <el-button type="primary" :loading="retrieving" @click="runRetrieval">
                    <el-icon><Search /></el-icon>开始检索
                  </el-button>
                </div>
                <p class="form-tip">Ctrl + Enter 快速检索 · 检索结果用于验证召回效果，不消耗模型 Token</p>
              </div>

              <div v-if="retrievalResult" class="retrieval-result">
                <div class="result-head">
                  <span>命中 <b>{{ retrievalResult.total }}</b> 个片段</span>
                  <span class="text-muted">耗时 {{ retrievalResult.elapsedMs }}ms</span>
                  <span class="text-muted">Top K={{ retrievalResult.topK }} · 阈值={{ retrievalResult.threshold }}</span>
                </div>

                <div v-for="item in retrievalResult.results" :key="item.chunkId" class="result-item">
                  <div class="result-top">
                    <span class="rank">#{{ item.chunkIndex }}</span>
                    <DocTypeIcon :type="item.docType" />
                    <span class="result-doc text-ellipsis">{{ item.docName }}</span>
                    <span class="text-muted">第 {{ item.page }} 页</span>
                    <div class="score-wrap">
                      <el-progress
                        :percentage="Math.round(item.score * 100)"
                        :stroke-width="6"
                        :show-text="false"
                        style="width: 80px"
                      />
                      <span class="score">{{ (item.score * 100).toFixed(1) }}%</span>
                    </div>
                  </div>
                  <p class="result-content">{{ item.content }}</p>
                </div>

                <el-empty v-if="!retrievalResult.total" description="未命中任何片段，建议下调阈值或启用混合检索" :image-size="80" />
              </div>

              <el-empty v-else description="输入问题后点击「开始检索」查看召回效果" :image-size="80" />
            </div>
          </el-tab-pane>

          <!-- 配置 -->
          <el-tab-pane label="知识库配置" name="config">
            <el-form :model="configForm" label-width="120px" class="config-form">
              <el-divider content-position="left">基本信息</el-divider>
              <el-form-item label="名称">
                <el-input v-model="configForm.name" style="width: 420px" />
              </el-form-item>
              <el-form-item label="描述">
                <el-input v-model="configForm.description" type="textarea" :rows="2" style="width: 420px" />
              </el-form-item>
              <el-form-item label="可见范围">
                <el-radio-group v-model="configForm.visibility">
                  <el-radio value="internal">企业内可见</el-radio>
                  <el-radio value="private">仅成员可见</el-radio>
                  <el-radio value="public">公开</el-radio>
                </el-radio-group>
              </el-form-item>

              <el-divider content-position="left">索引配置</el-divider>
              <el-form-item label="Embedding">
                <el-select v-model="configForm.embeddingModel" style="width: 420px">
                  <el-option v-for="m in embeddingModels" :key="m.value" :label="m.label" :value="m.value" />
                </el-select>
                <span class="form-hint">更换模型需重建索引</span>
              </el-form-item>
              <el-form-item label="解析策略">
                <el-select v-model="configForm.parser" style="width: 420px">
                  <el-option v-for="p in parserOptions" :key="p.value" :label="p.label" :value="p.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="切片参数">
                <span class="p-label">大小</span>
                <el-input-number v-model="configForm.chunkSize" :min="128" :max="2048" :step="64" size="small" />
                <span class="p-label" style="margin-left: 16px">重叠</span>
                <el-input-number v-model="configForm.chunkOverlap" :min="0" :max="256" :step="16" size="small" />
              </el-form-item>

              <el-divider content-position="left">检索配置</el-divider>
              <el-form-item label="Top K">
                <el-input-number v-model="configForm.topK" :min="1" :max="20" size="small" />
                <span class="form-hint">送入大模型的片段数量</span>
              </el-form-item>
              <el-form-item label="相似度阈值">
                <el-slider v-model="configForm.threshold" :min="0" :max="1" :step="0.01" style="width: 300px" />
                <span class="form-hint">{{ configForm.threshold.toFixed(2) }}</span>
              </el-form-item>
              <el-form-item label="增强选项">
                <el-checkbox v-model="configForm.rerank">Rerank 精排</el-checkbox>
                <el-checkbox v-model="configForm.hybrid">混合检索（向量 + BM25）</el-checkbox>
              </el-form-item>

              <el-divider content-position="left">生成配置</el-divider>
              <el-form-item label="推理模型">
                <el-select v-model="configForm.llmModel" style="width: 420px">
                  <el-option v-for="m in llmModels" :key="m.value" :label="m.label" :value="m.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="温度">
                <el-slider v-model="configForm.temperature" :min="0" :max="1" :step="0.1" style="width: 300px" />
                <span class="form-hint">{{ configForm.temperature.toFixed(1) }}</span>
              </el-form-item>

              <el-form-item>
                <el-button type="primary" :loading="saving" @click="handleSaveConfig">保存配置</el-button>
                <el-button @click="resetConfigForm">重置</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 统计 -->
          <el-tab-pane label="使用统计" name="stats">
            <div v-if="usage" class="stats-tab">
              <div class="stat-grid">
                <div class="stat-box">
                  <div class="s-label">本周问答量</div>
                  <div class="s-value">{{ formatNumber(usage.summary.weekQuestions) }}</div>
                </div>
                <div class="stat-box">
                  <div class="s-label">平均命中率</div>
                  <div class="s-value">{{ (usage.summary.avgHitRate * 100).toFixed(1) }}%</div>
                </div>
                <div class="stat-box">
                  <div class="s-label">平均响应耗时</div>
                  <div class="s-value">{{ usage.summary.avgLatency }}ms</div>
                </div>
                <div class="stat-box">
                  <div class="s-label">累计 Token</div>
                  <div class="s-value">{{ formatNumber(usage.summary.totalTokens) }}</div>
                </div>
              </div>

              <el-divider content-position="left">近 7 日问答量</el-divider>
              <div class="bar-chart">
                <div v-for="d in usage.trend" :key="d.date" class="bar-item">
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ height: `${(d.questions / maxQuestions) * 100}%` }" />
                  </div>
                  <span class="bar-value">{{ d.questions }}</span>
                  <span class="bar-label">{{ d.date }}</span>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 检索评测：golden QA 数据集跑 HitRate@5 / MRR，rerank 关/开对比 -->
          <el-tab-pane label="检索评测" name="eval" lazy>
            <div class="eval-tab">
              <div class="eval-toolbar">
                <div class="eval-info">
                  <span>数据集</span>
                  <el-tag size="small" effect="plain">{{ dataset?.dataset || '未加载' }}</el-tag>
                  <span class="text-muted">{{ dataset?.cases?.length || 0 }} 条用例 · TopK=5 · 阈值=0 · 精排关/开对比 · 命中=文档锚点切片±1</span>
                </div>
                <div class="eval-actions">
                  <el-button v-if="hardCount" :disabled="evalRunning" @click="exportHardCases">
                    导出难例（{{ hardCount }}）
                  </el-button>
                  <el-button v-if="evalRunning" @click="stopEval">停止</el-button>
                  <el-button type="primary" :loading="evalRunning" :disabled="!dataset" @click="runEval">
                    <el-icon><VideoPlay /></el-icon>{{ evalRunning ? '评测中…' : '运行评测' }}
                  </el-button>
                </div>
              </div>

              <el-progress
                v-if="evalRunning"
                :percentage="evalProgress"
                :stroke-width="6"
                style="margin: 4px 0 14px"
              />

              <template v-if="evalReport">
                <section class="metrics" style="margin-bottom: 16px">
                  <div v-for="m in evalMetricCards" :key="m.label" class="metric-card">
                    <div class="m-label">{{ m.label }}</div>
                    <div class="m-value">{{ m.value }}</div>
                    <div class="m-sub">{{ m.sub }}</div>
                  </div>
                </section>

                <el-table :data="evalReport.rows" size="small" style="width: 100%">
                  <el-table-column label="#" type="index" width="44" />
                  <el-table-column label="问题" min-width="210" show-overflow-tooltip>
                    <template #default="{ row }">{{ row.question }}</template>
                  </el-table-column>
                  <el-table-column label="目标文档" width="130" show-overflow-tooltip>
                    <template #default="{ row }">{{ row.docNameContains }}</template>
                  </el-table-column>
                  <el-table-column label="锚点" width="88" align="center">
                    <template #default="{ row }">{{ row.anchorText || '—' }}</template>
                  </el-table-column>
                  <el-table-column label="排名·精排关" width="92" align="center">
                    <template #default="{ row }">
                      <span v-if="row.offRank">Top{{ row.offRank }}</span>
                      <span v-else class="text-muted">—</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="排名·精排开" width="92" align="center">
                    <template #default="{ row }">
                      <span v-if="row.onRank">Top{{ row.onRank }}</span>
                      <span v-else class="text-muted">—</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="耗时 关/开" width="110" align="right">
                    <template #default="{ row }">{{ row.offMs }} / {{ row.onMs }}ms</template>
                  </el-table-column>
                  <el-table-column label="结论" width="96" align="center">
                    <template #default="{ row }">
                      <el-tag size="small" :type="row.onRank ? 'success' : 'danger'" effect="light">
                        {{ row.onRank ? `命中#${row.onRank}` : '未命中' }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </template>
              <el-empty
                v-else-if="!evalRunning"
                :description="dataset ? '点击「运行评测」生成 HitRate / MRR 报告' : '正在加载评测数据集…'"
                :image-size="80"
              />
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <!-- 切片抽屉 -->
    <el-drawer v-model="chunkVisible" :title="currentDoc?.name || '文档切片'" size="520px">
      <div v-if="chunks.length" class="chunk-list">
        <div v-for="ck in chunks" :key="ck.id" class="chunk-item">
          <div class="chunk-head">
            <span class="chunk-idx">#{{ ck.index }}</span>
            <span class="text-muted">第 {{ ck.page }} 页 · {{ ck.charCount }} 字</span>
          </div>
          <p class="chunk-content">{{ ck.content }}</p>
        </div>
      </div>
      <el-empty v-else description="该文档暂无切片数据" />
    </el-drawer>

    <!-- 文档预览抽屉：PDF 用 vue-pdf-embed 渲染（支持页码跳转），文本类直接展示，其余格式引导下载 -->
    <DocPreviewDrawer
      v-model="previewVisible"
      :doc-id="previewDoc?.id || ''"
      :name="previewDoc?.name || ''"
      :type="previewDoc?.type || ''"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useKnowledgeStore } from '@/store'
import { retrievalTest, getDocumentChunks, downloadDocument } from '@/api/knowledge'
import { watchKb, stopWatch } from '@/composables/useParseWatcher'
import { getUsageStats } from '@/api/user'
import { kbStatusMap, docStatusMap, embeddingModels, parserOptions, llmModels } from '@/mock/knowledge'
import { formatSize, formatNumber, fromNow } from '@/utils/format'
import DocTypeIcon from '@/components/DocTypeIcon.vue'
import DocPreviewDrawer from '@/components/DocPreviewDrawer.vue'

const route = useRoute()
const knowledgeStore = useKnowledgeStore()

const activeTab = ref('docs')
const kb = computed(() => knowledgeStore.current)

/* ---------------- 文档 ---------------- */
const docKeyword = ref('')
const docStatus = ref('')
const selectedDocs = ref([])
const uploading = ref(false)
const uploadPercent = ref(0)

const metrics = computed(() => {
  if (!kb.value) return []
  return [
    { label: '文档数', value: kb.value.docCount },
    { label: '切片数', value: formatNumber(kb.value.chunkCount) },
    { label: '占用空间', value: formatSize(kb.value.totalSize) },
    { label: '向量维度', value: kb.value.vectorDim },
    { label: '本周问答', value: formatNumber(kb.value.stats?.weekQuestions || 0) },
    { label: '命中率', value: `${((kb.value.stats?.hitRate || 0) * 100).toFixed(1)}%` }
  ]
})

async function loadDocs() {
  await knowledgeStore.fetchDocuments(route.params.id, {
    keyword: docKeyword.value,
    status: docStatus.value,
    pageSize: 50
  })
}

let docTimer = null
watch(docKeyword, () => {
  clearTimeout(docTimer)
  docTimer = setTimeout(loadDocs, 300)
})

/** 本页面启动的解析监听，离开页面时清理 */
const watchedKbIds = new Set()
onBeforeUnmount(() => watchedKbIds.forEach((id) => stopWatch(id)))

async function customUpload(options) {
  uploading.value = true
  uploadPercent.value = 0
  try {
    const docs = await knowledgeStore.upload(route.params.id, [options.file], (p) => {
      uploadPercent.value = p
    })
    ElMessage.success('上传成功，后台正在解析')
    // 解析完成后应用内 + 浏览器通知（浏览器通知权限由聊天页拖拽 / 列表页导入的手势统一请求）
    watchKb(
      route.params.id,
      docs.map((d) => d.id),
      { names: Object.fromEntries(docs.map((d) => [d.id, d.name])) }
    )
    watchedKbIds.add(route.params.id)
    options.onSuccess?.()
  } catch (e) {
    options.onError?.(e)
  } finally {
    setTimeout(() => (uploading.value = false), 400)
  }
}

async function handleReparse(row) {
  await knowledgeStore.reparseDocument(route.params.id, row.id)
  ElMessage.success('已提交重新解析任务')
}

async function handleDeleteDoc(row) {
  try {
    await ElMessageBox.confirm(`确定删除文档「${row.name}」吗？相关切片将一并移除。`, '删除文档', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    await knowledgeStore.removeDocument(route.params.id, row.id)
    ElMessage.success('已删除')
  } catch (e) {
    /* 取消 */
  }
}

async function handleBatchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedDocs.value.length} 个文档吗？`, '批量删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    for (const doc of selectedDocs.value) {
      await knowledgeStore.removeDocument(route.params.id, doc.id)
    }
    ElMessage.success('已删除')
    selectedDocs.value = []
  } catch (e) {
    /* 取消 */
  }
}

/* ---------------- 切片 ---------------- */
const chunkVisible = ref(false)
const currentDoc = ref(null)
const chunks = ref([])

async function openChunks(row) {
  currentDoc.value = row
  chunks.value = (row.chunks || []).slice()
  if (!chunks.value.length) {
    chunks.value = await getDocumentChunks(row.id)
  }
  chunkVisible.value = true
}

/* ---------------- 预览 / 下载 ---------------- */
const previewVisible = ref(false)
const previewDoc = ref(null)

/** 打开文档预览（加载与渲染逻辑统一收敛在 DocPreviewDrawer 组件内） */
function openPreview(row) {
  previewDoc.value = row
  previewVisible.value = true
}

async function handleDownload(row) {
  try {
    await downloadDocument(row.id, row.name)
    ElMessage.success('已开始下载')
  } catch (e) {
    ElMessage.error(e.message || '下载失败')
  }
}

/* ---------------- 检索测试 ---------------- */
const query = ref('')
const retrieving = ref(false)
const retrievalResult = ref(null)
const retrieval = reactive({ topK: 5, threshold: 0.28, rerank: true })

async function runRetrieval() {
  if (!query.value.trim()) {
    ElMessage.warning('请输入测试问题')
    return
  }
  retrieving.value = true
  try {
    retrievalResult.value = await retrievalTest({
      kbId: route.params.id,
      query: query.value.trim(),
      topK: retrieval.topK,
      threshold: retrieval.threshold,
      rerank: retrieval.rerank
    })
  } finally {
    retrieving.value = false
  }
}

/* ---------------- 检索评测（golden QA · HitRate@5 / MRR@5，精排关/开对比） ---------------- */
const dataset = ref(null)
const evalRunning = ref(false)
const evalProgress = ref(0)
const evalReport = ref(null)
let evalAborted = false

/** 进入评测 tab 时懒加载数据集（public/datasets，随构建产物分发） */
watch(activeTab, (t) => {
  if (t === 'eval' && !dataset.value) {
    fetch('/datasets/golden-qa.json')
      .then((r) => r.json())
      .then((d) => (dataset.value = d))
      .catch(() => ElMessage.error('评测数据集加载失败'))
  }
})

/** 关键词命中（最严格口径）：目标文档 + 任一关键词出现在切片内容 */
function kwHit(r, c) {
  return (
    (r.docName || '').includes(c.docNameContains) &&
    (c.keywords || []).some((k) => (r.content || '').includes(k))
  )
}

/**
 * 命中判定 v2：目标文档内「锚点切片 ±1」窗口（相邻切片是连续正文的切分，
 * 语义等价换位不再误判脱靶），关键词命中始终兜底。
 */
function hitRank(results, c, anchorIdx) {
  const inDoc = (r) => (r.docName || '').includes(c.docNameContains)
  const idx = (results || []).findIndex((r) => {
    if (!inDoc(r)) return false
    if (kwHit(r, c)) return true
    return anchorIdx != null && r.chunkIndex != null && Math.abs(r.chunkIndex - anchorIdx) <= 1
  })
  return idx === -1 ? 0 : idx + 1
}

/** 校准轮（精排关 TopK=10，不计分）：定位每条用例的目标切片锚点 */
async function calibrate(c) {
  try {
    const res = await retrievalTest({
      kbId: route.params.id,
      query: c.question,
      topK: 10,
      threshold: 0,
      rerank: false
    })
    const hit = (res.results || []).find((r) => kwHit(r, c))
    return hit && hit.chunkIndex != null ? hit.chunkIndex : null
  } catch {
    return null
  }
}

/** Bootstrap 95% 置信区间：对逐条指标（RR / 命中 0-1）重采样 1000 次取 2.5/97.5 分位 */
function bootstrapCI(values, iterations = 1000) {
  if (!values.length) return [0, 0]
  const stats = []
  for (let i = 0; i < iterations; i++) {
    let s = 0
    for (let j = 0; j < values.length; j++) s += values[(Math.random() * values.length) | 0]
    stats.push(s / values.length)
  }
  stats.sort((a, b) => a - b)
  return [stats[Math.floor(iterations * 0.025)], stats[Math.ceil(iterations * 0.975) - 1]]
}

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

async function runEval() {
  const cases = dataset.value?.cases || []
  if (!cases.length) return
  evalRunning.value = true
  evalAborted = false
  evalProgress.value = 0
  evalReport.value = null
  const rows = cases.map((c) => ({ ...c, anchorText: '', offRank: 0, onRank: 0, offMs: 0, onMs: 0, onRoute: '' }))
  const totalSteps = cases.length * 3
  let done = 0
  let completed = 0
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const row = rows[i]
    // 第 1 步：校准轮，定位目标切片（不计分）
    const anchorIdx = await calibrate(c)
    done += 1
    evalProgress.value = Math.round((done / totalSteps) * 100)
    row.anchorText = anchorIdx != null ? `#${anchorIdx}` : '关键词'
    // 第 2/3 步：精排关、开各检索一次
    for (const rerank of [false, true]) {
      const key = rerank ? 'on' : 'off'
      const t0 = performance.now()
      try {
        const res = await retrievalTest({
          kbId: route.params.id,
          query: c.question,
          topK: 5,
          threshold: 0,
          rerank
        })
        row[`${key}Rank`] = hitRank(res.results, c, anchorIdx)
        row[`${key}Ms`] = Math.round(performance.now() - t0)
        if (rerank) row.onRoute = res.route || 'rerank'
      } catch {
        /* 单条失败记 0 分，不中断整体评测 */
      }
      done += 1
      evalProgress.value = Math.round((done / totalSteps) * 100)
    }
    if (evalAborted) break
    completed += 1
  }
  const evaluated = rows.slice(0, completed)
  const n = evaluated.length
  const avg = (a) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0)
  evalReport.value = {
    rows,
    metrics: {
      cases: n,
      anchored: evaluated.filter((r) => r.anchorText !== '关键词').length,
      offHitRate: n ? evaluated.filter((r) => r.offRank).length / n : 0,
      onHitRate: n ? evaluated.filter((r) => r.onRank).length / n : 0,
      offMRR: n ? evaluated.reduce((s, r) => s + (r.offRank ? 1 / r.offRank : 0), 0) / n : 0,
      onMRR: n ? evaluated.reduce((s, r) => s + (r.onRank ? 1 / r.onRank : 0), 0) / n : 0,
      offMrrCI: bootstrapCI(evaluated.map((r) => (r.offRank ? 1 / r.offRank : 0))),
      onMrrCI: bootstrapCI(evaluated.map((r) => (r.onRank ? 1 / r.onRank : 0))),
      offHitCI: bootstrapCI(evaluated.map((r) => (r.offRank ? 1 : 0))),
      onHitCI: bootstrapCI(evaluated.map((r) => (r.onRank ? 1 : 0))),
      offMsMed: median(evaluated.map((r) => r.offMs).filter((v) => v > 0)),
      onMsMed: median(evaluated.map((r) => r.onMs).filter((v) => v > 0)),
      offMsAvg: avg(evaluated.map((r) => r.offMs).filter((v) => v > 0)),
      onMsAvg: avg(evaluated.map((r) => r.onMs).filter((v) => v > 0)),
      onSkipped: evaluated.filter((r) => r.onRoute === 'skipped').length
    }
  }
  evalRunning.value = false
  if (!evalAborted) ElMessage.success('评测完成')
}

function stopEval() {
  evalAborted = true
}

const evalMetricCards = computed(() => {
  const m = evalReport.value?.metrics
  if (!m) return []
  const ciPct = (c) => `${(c[0] * 100).toFixed(0)}–${(c[1] * 100).toFixed(0)}%`
  const ci3 = (c) => `${c[0].toFixed(3)}–${c[1].toFixed(3)}`
  return [
    {
      label: 'HitRate@5 · 未精排',
      value: `${(m.offHitRate * 100).toFixed(0)}%`,
      sub: `命中 ${Math.round(m.offHitRate * m.cases)}/${m.cases} · 95%CI ${ciPct(m.offHitCI)}`
    },
    {
      label: 'HitRate@5 · Rerank',
      value: `${(m.onHitRate * 100).toFixed(0)}%`,
      sub: `命中 ${Math.round(m.onHitRate * m.cases)}/${m.cases} · 95%CI ${ciPct(m.onHitCI)}`
    },
    {
      label: 'MRR@5（开 / 关）',
      value: `${m.onMRR.toFixed(3)} / ${m.offMRR.toFixed(3)}`,
      sub: `95%CI 开 ${ci3(m.onMrrCI)} · 关 ${ci3(m.offMrrCI)}`
    },
    {
      label: '耗时中位（开 / 关）',
      value: `${m.onMsMed} / ${m.offMsMed} ms`,
      sub: `均值 开 ${m.onMsAvg} / 关 ${m.offMsAvg} ms · 精排跳过 ${m.onSkipped}/${m.cases}`
    }
  ]
})

const hardCount = computed(
  () => (evalReport.value?.rows || []).filter((r) => !r.offRank || !r.onRank).length
)

/** 导出未命中用例（含两种模式的排名与锚点），作为后续检索改动的回归集 */
function exportHardCases() {
  const list = (evalReport.value?.rows || []).filter((r) => !r.offRank || !r.onRank)
  if (!list.length) return
  const payload = {
    dataset: 'kb-eval-hard-cases',
    exportedAt: new Date().toISOString(),
    hitCriteria: 'anchor chunk ±1 or keyword',
    cases: list.map(
      ({ id, question, docNameContains, keywords, note, anchorText, offRank, onRank, offMs, onMs }) => ({
        id,
        question,
        docNameContains,
        keywords,
        note,
        anchorText,
        offRank,
        onRank,
        offMs,
        onMs
      })
    )
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'hard-cases.json'
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------------- 配置 ---------------- */
const configForm = reactive({
  name: '',
  description: '',
  visibility: 'internal',
  embeddingModel: '',
  parser: 'smart',
  chunkSize: 512,
  chunkOverlap: 64,
  topK: 5,
  threshold: 0.28,
  rerank: true,
  hybrid: true,
  llmModel: '',
  temperature: 0.3
})
const saving = ref(false)

function resetConfigForm() {
  const data = kb.value
  if (!data) return
  Object.assign(configForm, {
    name: data.name,
    description: data.description,
    visibility: data.visibility,
    embeddingModel: data.embeddingModel,
    parser: data.parser,
    chunkSize: data.chunkSize,
    chunkOverlap: data.chunkOverlap,
    topK: data.retriever?.topK,
    threshold: data.retriever?.threshold,
    rerank: data.retriever?.rerank,
    hybrid: data.retriever?.hybrid,
    llmModel: data.llm?.model,
    temperature: data.llm?.temperature
  })
}

async function handleSaveConfig() {
  saving.value = true
  try {
    await knowledgeStore.update(route.params.id, {
      name: configForm.name,
      description: configForm.description,
      visibility: configForm.visibility,
      embeddingModel: configForm.embeddingModel,
      parser: configForm.parser,
      chunkSize: configForm.chunkSize,
      chunkOverlap: configForm.chunkOverlap,
      retriever: {
        topK: configForm.topK,
        threshold: configForm.threshold,
        rerank: configForm.rerank,
        rerankModel: configForm.rerank ? 'bge-reranker-large' : '',
        hybrid: configForm.hybrid
      },
      llm: {
        provider: configForm.llmModel.includes('glm') ? 'glm' : 'qwen',
        model: configForm.llmModel,
        temperature: configForm.temperature
      }
    })
    ElMessage.success('配置已保存')
  } finally {
    saving.value = false
  }
}

async function handleRebuild() {
  await knowledgeStore.rebuildIndex(route.params.id)
  ElMessage.success('已提交重建索引任务')
  await knowledgeStore.fetchDetail(route.params.id)
}

/* ---------------- 统计 ---------------- */
const usage = ref(null)
const maxQuestions = computed(() =>
  Math.max(...(usage.value?.trend || [{ questions: 1 }]).map((d) => d.questions))
)

onMounted(async () => {
  await knowledgeStore.fetchDetail(route.params.id)
  resetConfigForm()
  if (kb.value) {
    Object.assign(retrieval, {
      topK: kb.value.retriever?.topK,
      threshold: kb.value.retriever?.threshold,
      rerank: kb.value.retriever?.rerank
    })
  }
  await loadDocs()
  usage.value = await getUsageStats()
})
</script>

<style scoped>
.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.head-left {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--c-text-2);
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: all 0.16s;
}

.back-btn:hover {
  color: var(--brand);
  border-color: var(--brand);
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-title {
  font-size: 19px;
  font-weight: 600;
}

.page-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--c-text-3);
}

.head-right {
  display: flex;
  gap: 8px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.metric-card {
  padding: 12px 14px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
}

.metric-card .m-label {
  font-size: 12px;
  color: var(--c-text-4);
}

.metric-card .m-value {
  margin-top: 2px;
  font-size: 17px;
  font-weight: 600;
}

/* 检索评测 tab */
.eval-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.eval-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}

.eval-actions {
  display: flex;
  gap: 8px;
}

.metric-card .m-sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--c-text-4);
}

.detail-tabs {
  padding: 4px 16px 24px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
}

.tab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.tab-toolbar .left,
.tab-toolbar .right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doc-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.doc-name {
  font-size: 13px;
}

.doc-error {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-danger);
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
  background: var(--c-bg-soft);
  border-radius: var(--radius-s);
}

.upload-progress :deep(.el-progress) {
  flex: 1;
}

/* 检索测试 */
.retrieval-form {
  padding: 16px;
  background: var(--c-bg-soft);
  border-radius: var(--radius);
}

.param-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.param {
  display: flex;
  align-items: center;
  gap: 8px;
}

.p-label {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.p-value {
  font-size: 12.5px;
  color: var(--c-text-2);
}

.form-tip {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.retrieval-result {
  margin-top: 18px;
}

.result-head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 13px;
}

.result-item {
  padding: 14px;
  margin-bottom: 10px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
  transition: all 0.16s;
}

.result-item:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-s);
}

.result-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12.5px;
}

.rank {
  font-weight: 600;
  color: var(--brand);
}

.result-doc {
  max-width: 280px;
  font-weight: 500;
}

.score-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.score {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-success);
}

.result-content {
  font-size: 13px;
  line-height: 1.75;
  color: var(--c-text-2);
}

/* 配置 */
.config-form {
  max-width: 720px;
  padding-top: 8px;
}

.form-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--c-text-4);
}

/* 统计 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.stat-box {
  padding: 16px;
  background: var(--c-bg-soft);
  border-radius: var(--radius);
}

.s-label {
  font-size: 12.5px;
  color: var(--c-text-4);
}

.s-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 600;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  height: 200px;
  padding: 16px 8px 0;
}

.bar-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}

.bar-track {
  display: flex;
  align-items: flex-end;
  flex: 1;
  width: 100%;
  max-width: 44px;
}

.bar-fill {
  width: 100%;
  background: linear-gradient(180deg, #7e9cec, #3f6ae1);
  border-radius: 4px 4px 0 0;
  transition: height 0.4s ease;
}

.bar-value {
  font-size: 12px;
  font-weight: 600;
}

.bar-label {
  font-size: 11.5px;
  color: var(--c-text-4);
}

/* 切片 */
.chunk-item {
  padding: 14px;
  margin-bottom: 10px;
  background: var(--c-bg-soft);
  border-radius: var(--radius);
}

.chunk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12.5px;
}

.chunk-idx {
  font-weight: 600;
  color: var(--brand);
}

.chunk-content {
  font-size: 13px;
  line-height: 1.8;
  color: var(--c-text-2);
}
</style>
