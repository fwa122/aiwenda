<template>
  <div class="page-container">
    <div class="page-inner">
      <!-- 页头 -->
      <header class="page-head">
        <div>
          <h1 class="page-title">知识库管理</h1>
          <p class="page-desc">管理文档解析、向量索引与检索参数，支撑问答效果</p>
        </div>
        <div class="head-actions">
          <el-input
            v-model="keyword"
            placeholder="搜索知识库名称 / 描述"
            clearable
            style="width: 220px"
            @input="handleSearch"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="status" placeholder="全部状态" clearable style="width: 130px" @change="load">
            <el-option label="已就绪" value="ready" />
            <el-option label="索引构建中" value="indexing" />
            <el-option label="草稿" value="draft" />
          </el-select>
          <el-button type="primary" @click="openCreate">
            <el-icon><Plus /></el-icon>新建知识库
          </el-button>
        </div>
      </header>

      <!-- 概览卡片 -->
      <section class="stats">
        <div v-for="s in stats" :key="s.label" class="stat-card">
          <div class="stat-icon" :style="{ background: s.bg, color: s.color }">
            <el-icon :size="16"><component :is="s.icon" /></el-icon>
          </div>
          <div>
            <div class="stat-value">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </div>
      </section>

      <!-- 知识库卡片列表 -->
      <section v-loading="knowledgeStore.loading" class="kb-grid">
        <article
          v-for="kb in knowledgeStore.list"
          :key="kb.id"
          class="kb-card"
          @click="goDetail(kb.id)"
        >
          <div class="kb-top">
            <div class="kb-icon" :style="{ background: `${kb.color}18`, color: kb.color }">
              <el-icon :size="18"><component :is="kb.icon" /></el-icon>
            </div>
            <el-tag :type="kbStatusMap[kb.status].type" size="small" effect="light">
              {{ kbStatusMap[kb.status].label }}
            </el-tag>
            <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, kb)">
              <span class="kb-more" @click.stop>
                <el-icon :size="15"><MoreFilled /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="detail">
                    <el-icon><View /></el-icon>查看详情
                  </el-dropdown-item>
                  <el-dropdown-item command="rebuild">
                    <el-icon><RefreshRight /></el-icon>重建索引
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <el-icon><Delete /></el-icon>删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <h3 class="kb-name text-ellipsis">{{ kb.name }}</h3>
          <p class="kb-desc text-clamp-2">{{ kb.description || '暂无描述' }}</p>

          <div class="kb-metrics">
            <div class="metric">
              <span class="m-value">{{ kb.docCount }}</span>
              <span class="m-label">文档</span>
            </div>
            <div class="metric">
              <span class="m-value">{{ formatNumber(kb.chunkCount) }}</span>
              <span class="m-label">切片</span>
            </div>
            <div class="metric">
              <span class="m-value">{{ formatSize(kb.totalSize) }}</span>
              <span class="m-label">容量</span>
            </div>
          </div>

          <footer class="kb-foot">
            <span class="kb-model text-ellipsis">{{ kb.embeddingModel }}</span>
            <span class="kb-time">{{ fromNow(kb.updatedAt) }}</span>
          </footer>
        </article>

        <el-empty
          v-if="!knowledgeStore.loading && !knowledgeStore.list.length"
          description="暂无知识库，点击右上角新建"
          :image-size="96"
        />
      </section>
    </div>

    <!-- 新建知识库弹窗 -->
    <el-dialog v-model="createVisible" title="新建知识库" width="560px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：产品手册知识库" maxlength="30" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            maxlength="120"
            show-word-limit
            placeholder="简要说明知识库用途与覆盖范围"
          />
        </el-form-item>
        <el-form-item label="Embedding">
          <el-select v-model="form.embeddingModel" style="width: 100%">
            <el-option v-for="m in embeddingModels" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="向量库">
          <el-select v-model="form.vectorStore" style="width: 100%">
            <el-option v-for="v in vectorStores" :key="v.value" :label="v.label" :value="v.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="解析策略">
          <el-select v-model="form.parser" style="width: 100%">
            <el-option v-for="p in parserOptions" :key="p.value" :label="p.label" :value="p.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="切片参数">
          <div class="form-inline">
            <span class="inline-label">大小</span>
            <el-input-number v-model="form.chunkSize" :min="128" :max="2048" :step="64" size="small" />
            <span class="inline-label">重叠</span>
            <el-input-number v-model="form.chunkOverlap" :min="0" :max="256" :step="16" size="small" />
          </div>
        </el-form-item>
        <el-form-item label="检索参数">
          <div class="form-inline">
            <span class="inline-label">Top K</span>
            <el-input-number v-model="form.topK" :min="1" :max="20" size="small" />
            <span class="inline-label">阈值</span>
            <el-slider v-model="form.threshold" :min="0" :max="1" :step="0.01" style="width: 120px" />
          </div>
        </el-form-item>
        <el-form-item label="增强选项">
          <el-checkbox v-model="form.rerank">启用 Rerank 精排</el-checkbox>
          <el-checkbox v-model="form.hybrid">启用混合检索（向量 + BM25）</el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useKnowledgeStore } from '@/store'
import {
  kbStatusMap,
  embeddingModels,
  vectorStores,
  parserOptions
} from '@/mock/knowledge'
import { formatSize, formatNumber, fromNow } from '@/utils/format'

const router = useRouter()
const knowledgeStore = useKnowledgeStore()

const keyword = ref('')
const status = ref('')
const createVisible = ref(false)
const submitting = ref(false)
const formRef = ref(null)

const form = reactive({
  name: '',
  description: '',
  embeddingModel: 'bge-large-zh-v1.5',
  vectorStore: 'milvus',
  parser: 'smart',
  chunkSize: 512,
  chunkOverlap: 64,
  topK: 5,
  threshold: 0.28,
  rerank: true,
  hybrid: true
})

const rules = {
  name: [{ required: true, message: '请输入知识库名称', trigger: 'blur' }]
}

const stats = computed(() => {
  const list = knowledgeStore.list
  const docCount = list.reduce((sum, kb) => sum + kb.docCount, 0)
  const chunkCount = list.reduce((sum, kb) => sum + kb.chunkCount, 0)
  const questions = list.reduce((sum, kb) => sum + (kb.stats?.weekQuestions || 0), 0)
  const hitRate = list.length
    ? list.reduce((sum, kb) => sum + (kb.stats?.hitRate || 0), 0) / list.length
    : 0
  return [
    { label: '知识库总数', value: list.length, icon: 'Collection', color: '#3f6ae1', bg: '#eef3ff' },
    { label: '文档总数', value: docCount, icon: 'Document', color: '#18a058', bg: '#eaf7f0' },
    { label: '切片总数', value: formatNumber(chunkCount), icon: 'Files', color: '#e37318', bg: '#fdf3e7' },
    { label: '本周问答量', value: formatNumber(questions), icon: 'ChatDotRound', color: '#8b5cf6', bg: '#f3effd' },
    { label: '平均命中率', value: `${(hitRate * 100).toFixed(1)}%`, icon: 'TrendCharts', color: '#0ea5e9', bg: '#e8f6fd' }
  ]
})

let searchTimer = null
function handleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}

async function load() {
  await knowledgeStore.fetchList({ keyword: keyword.value, status: status.value })
}

onMounted(load)

function goDetail(id) {
  router.push(`/knowledge/${id}`)
}

function openCreate() {
  Object.assign(form, {
    name: '',
    description: '',
    embeddingModel: 'bge-large-zh-v1.5',
    vectorStore: 'milvus',
    parser: 'smart',
    chunkSize: 512,
    chunkOverlap: 64,
    topK: 5,
    threshold: 0.28,
    rerank: true,
    hybrid: true
  })
  createVisible.value = true
}

async function handleCreate() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await knowledgeStore.create({ ...form })
    ElMessage.success('知识库创建成功')
    createVisible.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function handleCommand(cmd, kb) {
  if (cmd === 'detail') return goDetail(kb.id)
  if (cmd === 'rebuild') {
    await knowledgeStore.rebuildIndex(kb.id)
    ElMessage.success('已提交重建索引任务')
    await load()
    return
  }
  if (cmd === 'delete') {
    try {
      await ElMessageBox.confirm(
        `确定删除知识库「${kb.name}」吗？该知识库下的全部文档与向量数据将被移除。`,
        '删除知识库',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
      )
      await knowledgeStore.remove(kb.id)
      ElMessage.success('已删除')
      await load()
    } catch (e) {
      /* 取消 */
    }
  }
}
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
}

.page-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--c-text-3);
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 概览 */
.stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
  box-shadow: var(--shadow-s);
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: var(--c-text-4);
}

/* 卡片网格 */
.kb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  min-height: 200px;
}

.kb-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
  box-shadow: var(--shadow-s);
  cursor: pointer;
  transition: all 0.18s;
}

.kb-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow);
  transform: translateY(-2px);
}

.kb-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.kb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
}

.kb-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  color: var(--c-text-4);
  border-radius: 4px;
}

.kb-more:hover {
  color: var(--c-text);
  background: var(--c-bg-hover);
}

.kb-name {
  font-size: 15px;
  font-weight: 600;
}

.kb-desc {
  margin-top: 6px;
  min-height: 40px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.kb-metrics {
  display: flex;
  gap: 20px;
  padding: 12px 0;
  margin-top: 10px;
  border-top: 1px dashed var(--c-border-soft);
  border-bottom: 1px dashed var(--c-border-soft);
}

.metric {
  display: flex;
  flex-direction: column;
}

.m-value {
  font-size: 15px;
  font-weight: 600;
}

.m-label {
  font-size: 11.5px;
  color: var(--c-text-4);
}

.kb-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.kb-model {
  flex: 1;
  min-width: 0;
  padding: 1px 7px;
  background: var(--c-bg-soft);
  border-radius: 4px;
}

.form-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.inline-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--c-text-3);
}

@media (max-width: 1100px) {
  .stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
