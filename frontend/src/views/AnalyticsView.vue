<template>
  <div class="analytics-page">
    <!-- 页头：标题 + 时间范围 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">数据分析</h2>
        <p class="page-sub">Token 成本与回答质量闭环分析（仅管理员可见）</p>
      </div>
      <div class="header-actions">
        <el-button size="small" :disabled="!cost.byModel?.length" @click="exportReport">
          <el-icon style="margin-right: 4px"><Download /></el-icon>
          导出报表
        </el-button>
        <el-radio-group v-model="rangeDays" size="small" @change="loadAll">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div v-loading="loading" class="page-body">
      <!-- 概览卡片 -->
      <div class="stat-grid">
        <div class="stat-box">
          <div class="s-label">问答次数</div>
          <div class="s-value">{{ formatNumber(cost.total?.questions || 0) }}</div>
          <div class="s-foot">所选时间范围累计</div>
        </div>
        <div class="stat-box">
          <div class="s-label">Token 消耗</div>
          <div class="s-value">{{ formatNumber(cost.total?.tokens || 0) }}</div>
          <div class="s-foot">生成 + 输入合计</div>
        </div>
        <div class="stat-box">
          <div class="s-label">估算成本</div>
          <div class="s-value accent">¥{{ estCost.toFixed(2) }}</div>
          <div class="s-foot">按内置公开定价估算，仅供参考</div>
        </div>
        <div class="stat-box">
          <div class="s-label">缓存节省</div>
          <div class="s-value accent">¥{{ cacheSavedCost.toFixed(2) }}</div>
          <div class="s-foot">
            {{ cost.cacheSaved?.hits || 0 }} 次命中 · 省 {{ formatNumber(cost.cacheSaved?.tokens || 0) }} tokens 重放
          </div>
        </div>
        <div class="stat-box">
          <div class="s-label">满意度</div>
          <div class="s-value" :class="{ danger: fb.summary && fb.summary.satisfaction < 0.8 }">
            {{ pct(fb.summary?.satisfaction) }}
          </div>
          <div class="s-foot">点赞 / 已评价（{{ ratedCount }} 条）</div>
        </div>
      </div>

      <!-- 成本分析 -->
      <div class="section-title">
        <span>成本分析</span>
        <span class="section-hint">按模型拆分输入/输出 Token，按用户定位消耗大头</span>
      </div>

      <div class="panel">
        <div class="panel-title">Token 日趋势</div>
        <div v-if="cost.trend?.length" class="bar-chart">
          <div
            v-for="d in cost.trend"
            :key="d.date"
            class="bar-item"
            :title="`${d.date} · ${d.questions} 次问答 · ${formatNumber(d.tokens)} tokens`"
          >
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: barHeight(d.tokens) }" />
            </div>
            <span v-if="showLabel" class="bar-label">{{ d.date.slice(3) }}</span>
          </div>
        </div>
        <el-empty v-else description="所选范围内暂无问答数据" :image-size="64" />
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-title">按模型分布</div>
          <el-table :data="cost.byModel || []" size="small" :show-header="true">
            <el-table-column label="模型" prop="model" min-width="130">
              <template #default="{ row }">
                <span class="mono">{{ row.model || '未知' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="次数" prop="count" width="64" align="right" />
            <el-table-column label="Tokens" width="96" align="right">
              <template #default="{ row }">{{ formatNumber(row.tokens) }}</template>
            </el-table-column>
            <el-table-column label="估算成本" width="96" align="right">
              <template #default="{ row }">¥{{ modelCost(row).toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="平均耗时" width="88" align="right">
              <template #default="{ row }">{{ (row.avgLatency / 1000).toFixed(1) }}s</template>
            </el-table-column>
            <el-table-column min-width="90" align="right">
              <template #default="{ row }">
                <div class="mini-bar">
                  <div
                    class="mini-fill"
                    :style="{ width: `${(row.tokens / maxModelTokens) * 100}%` }"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="panel-note">
            未匹配定价的模型按兜底单价估算；输入 {{ '¥' + (defaultPrice[0]) }}/M、输出 {{ '¥' + defaultPrice[1] }}/M；语义缓存命中回答已剔除
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">按部门排行</div>
          <el-table :data="cost.byDept || []" size="small">
            <el-table-column label="部门" prop="department" min-width="100" />
            <el-table-column label="人数" prop="users" width="64" align="right" />
            <el-table-column label="提问" prop="questions" width="64" align="right" />
            <el-table-column label="Tokens" width="96" align="right">
              <template #default="{ row }">{{ formatNumber(row.tokens) }}</template>
            </el-table-column>
            <el-table-column label="占比" min-width="110">
              <template #default="{ row }">
                <div class="mini-bar">
                  <div
                    class="mini-fill"
                    :style="{ width: `${(row.tokens / maxDeptTokens) * 100}%` }"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">按用户排行</div>
        <el-table :data="cost.byUser || []" size="small">
          <el-table-column label="用户" min-width="110">
            <template #default="{ row }">{{ row.nickname || row.username }}</template>
          </el-table-column>
          <el-table-column label="部门" prop="department" width="110" />
          <el-table-column label="提问" prop="questions" width="70" align="right" />
          <el-table-column label="Tokens" width="96" align="right">
            <template #default="{ row }">{{ formatNumber(row.tokens) }}</template>
          </el-table-column>
          <el-table-column label="占比" min-width="110">
            <template #default="{ row }">
              <div class="mini-bar">
                <div
                  class="mini-fill"
                  :style="{ width: `${(row.tokens / maxUserTokens) * 100}%` }"
                />
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 评价分析 -->
      <div class="section-title">
        <span>评价分析</span>
        <span class="section-hint">差评明细可定位知识库盲区，点击跳转原会话复核</span>
      </div>

      <div class="stat-grid four">
        <div class="stat-box plain">
          <div class="s-label">点赞</div>
          <div class="s-value ok">{{ fb.summary?.likes || 0 }}</div>
        </div>
        <div class="stat-box plain">
          <div class="s-label">点踩</div>
          <div class="s-value danger">{{ fb.summary?.dislikes || 0 }}</div>
        </div>
        <div class="stat-box plain">
          <div class="s-label">评价率</div>
          <div class="s-value">{{ pct(fb.summary?.ratedRate) }}</div>
        </div>
        <div class="stat-box plain">
          <div class="s-label">差评率</div>
          <div class="s-value" :class="{ danger: dislikeRate > 0.15 }">{{ pct(dislikeRate) }}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">最近差评（{{ fb.disliked?.length || 0 }} 条）· 可一键转难例回流评测</div>
        <el-table v-if="fb.disliked?.length" :data="fb.disliked" size="small">
          <el-table-column label="用户提问" min-width="180">
            <template #default="{ row }">
              <span class="q-text">{{ row.question || '（未找到原始提问）' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="原因" width="92">
            <template #default="{ row }">
              <el-tag v-if="row.reason" :type="reasonTagType(row.reason)" size="small" effect="light">
                {{ REASON_LABELS[row.reason] || row.reason }}
              </el-tag>
              <span v-else class="dim">—</span>
            </template>
          </el-table-column>
          <el-table-column label="引用文档" min-width="120">
            <template #default="{ row }">
              <span class="a-text">{{ (row.sourceDocs || []).join('、') || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="84" align="center">
            <template #default="{ row }">
              <span v-if="row.reflowed" class="reflowed-ok">已回流 ✓</span>
              <span v-else class="dim">未处理</span>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="100">
            <template #default="{ row }">{{ formatDateTime(row.createdAt, 'MM-DD HH:mm') }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="goConversation(row)">
                查看会话
              </el-button>
              <el-button
                link
                type="primary"
                size="small"
                :disabled="row.reflowed"
                @click="openReflow(row)"
              >
                转难例
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无差评，继续保持" :image-size="64" />
      </div>
    </div>

    <!-- 差评转难例对话框：回流为回归用例（isHard + source=hardcase） -->
    <el-dialog v-model="reflowVisible" title="差评转难例" width="480px" append-to-body>
      <el-form label-width="88px" label-position="left" size="small">
        <el-form-item label="目标库">
          <el-select v-model="reflowForm.kbId" filterable placeholder="选择知识库" style="width: 100%">
            <el-option
              v-for="kb in kbStore.options"
              :key="kb.id"
              :value="kb.id"
              :label="kb.name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="提问">
          <el-input v-model="reflowForm.question" type="textarea" :rows="2" maxlength="512" />
        </el-form-item>
        <el-form-item label="文档包含">
          <el-input
            v-model="reflowForm.docNameContains"
            maxlength="128"
            placeholder="目标文档名包含（用于检索命中判定）"
          />
        </el-form-item>
        <el-form-item label="命中关键词">
          <el-select
            v-model="reflowForm.keywords"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            placeholder="输入后回车创建"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="reflowForm.note" type="textarea" :rows="2" maxlength="2000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="reflowVisible = false">取消</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="reflowSubmitting"
          :disabled="!reflowForm.kbId || !reflowForm.question.trim()"
          @click="submitReflow"
        >
          创建回归用例
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getCostAnalytics, getFeedbackAnalytics } from '@/api/user'
import { createEvalCase } from '@/api/knowledge'
import { useKnowledgeStore } from '@/store/knowledge'
import { formatNumber, formatDateTime } from '@/utils/format'

const router = useRouter()
const kbStore = useKnowledgeStore()

/** 模型单价表（元 / 百万 tokens：[输入, 输出]）。公开定价近似值，可按最新价目调整 */
const MODEL_PRICES = {
  'glm-4-flash': [0, 0],
  'glm-4.5': [2, 8],
  'glm-4.6': [2, 8],
  'qwen3.7-flash': [0.15, 0.75],
  'qwen3.8-max': [2.4, 9.6],
  'deepseek-v4-pro': [2, 8],
  'kimi-k2.6': [4, 16]
}
/** 未收录模型的兜底单价 */
const defaultPrice = [2, 8]

const loading = ref(false)
const rangeDays = ref(30)
const cost = ref({})
const fb = ref({})

/** 模型名匹配：kimi-k2.6-instruct 等变体按前缀命中 */
function priceOf(model) {
  if (!model) return defaultPrice
  if (MODEL_PRICES[model]) return MODEL_PRICES[model]
  const hit = Object.keys(MODEL_PRICES).find((k) => model.startsWith(k))
  return hit ? MODEL_PRICES[hit] : defaultPrice
}

function modelCost(row) {
  const [inP, outP] = priceOf(row.model)
  return ((row.promptTokens || 0) * inP + (row.completionTokens || 0) * outP) / 1e6
}

const estCost = computed(() => (cost.value.byModel || []).reduce((s, r) => s + modelCost(r), 0))
/** 缓存节省估算：重放 tokens 按兜底单价输入/输出均值折算（命中模型各异，取近似值） */
const cacheSavedCost = computed(() => {
  const tokens = cost.value.cacheSaved?.tokens || 0
  return (tokens * ((defaultPrice[0] + defaultPrice[1]) / 2)) / 1e6
})
const ratedCount = computed(
  () => (fb.value.summary?.likes || 0) + (fb.value.summary?.dislikes || 0)
)
const dislikeRate = computed(() => {
  const s = fb.value.summary
  if (!s || !(s.likes + s.dislikes)) return 0
  return s.dislikes / (s.likes + s.dislikes)
})

/** 趋势柱高 */
const maxTrendTokens = computed(() =>
  Math.max(...(cost.value.trend || []).map((d) => d.tokens || 0), 1)
)
function barHeight(v) {
  return `${Math.max(((v || 0) / maxTrendTokens.value) * 100, 2)}%`
}
/** 超过 31 根柱子时隐藏逐日文字标签（保留悬停提示） */
const showLabel = computed(() => (cost.value.trend || []).length <= 31)

const maxModelTokens = computed(() =>
  Math.max(...(cost.value.byModel || []).map((r) => r.tokens || 0), 1)
)
const maxUserTokens = computed(() =>
  Math.max(...(cost.value.byUser || []).map((r) => r.tokens || 0), 1)
)
const maxDeptTokens = computed(() =>
  Math.max(...(cost.value.byDept || []).map((r) => r.tokens || 0), 1)
)

/* ---------- CSV 报表导出（前端生成：单价表/估算成本单点维护，所见即所得） ---------- */

/** CSV 单元格转义：含逗号/引号/换行时加引号包裹 */
function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"` : s
}

function csvRow(arr) {
  return arr.map(csvCell).join(',')
}

function exportReport() {
  const rangeText = { 7: '近7天', 30: '近30天', 90: '近90天' }[rangeDays.value] || `近${rangeDays.value}天`
  const s = []
  s.push(['知识库问答系统 · 数据分析报表'])
  s.push([`统计范围,${rangeText},生成时间,${new Date().toLocaleString()}`])
  s.push([])
  s.push(['【成本概览】'])
  s.push(['指标', '数值'])
  s.push(['问答次数', cost.value.total?.questions || 0])
  s.push(['Token 消耗', cost.value.total?.tokens || 0])
  s.push(['估算成本(元)', estCost.value.toFixed(2)])
  s.push(['缓存命中次数', cost.value.cacheSaved?.hits || 0])
  s.push(['缓存节省Tokens', cost.value.cacheSaved?.tokens || 0])
  s.push(['缓存节省估算(元)', cacheSavedCost.value.toFixed(2)])
  s.push(['满意度', pct(fb.value.summary?.satisfaction)])
  s.push(['点赞', fb.value.summary?.likes || 0])
  s.push(['点踩', fb.value.summary?.dislikes || 0])
  s.push(['评价率', pct(fb.value.summary?.ratedRate)])
  s.push(['差评率', pct(dislikeRate.value)])
  s.push([])
  s.push(['【按模型】'])
  s.push(['模型', '次数', 'Tokens', '输入', '输出', '估算成本(元)', '平均耗时(ms)'])
  ;(cost.value.byModel || []).forEach((r) => {
    s.push([r.model || '未知', r.count, r.tokens, r.promptTokens, r.completionTokens, modelCost(r).toFixed(2), r.avgLatency])
  })
  s.push([])
  s.push(['【按部门】'])
  s.push(['部门', '人数', '提问数', 'Tokens'])
  ;(cost.value.byDept || []).forEach((r) => s.push([r.department, r.users, r.questions, r.tokens]))
  s.push([])
  s.push(['【按用户】'])
  s.push(['用户', '部门', '提问数', 'Tokens'])
  ;(cost.value.byUser || []).forEach((r) =>
    s.push([r.nickname || r.username, r.department || '未设置', r.questions, r.tokens])
  )
  s.push([])
  s.push(['【最近差评】'])
  s.push(['时间', '提问', '回答摘要'])
  ;(fb.value.disliked || []).forEach((r) =>
    s.push([formatDateTime(r.createdAt), r.question || '', answerPlain(r.answer || '')])
  )

  // \ufeff BOM 保证 Excel 正确识别 UTF-8 中文
  const csv = `\ufeff${s.map(csvRow).join('\r\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `数据分析报表_${rangeText}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function pct(v) {
  return `${((v || 0) * 100).toFixed(1)}%`
}

/** 回答摘要去 Markdown 符号，截断展示 */
function answerPlain(md = '') {
  return md.replace(/[#*`>\-\[\]()!]/g, '').slice(0, 120)
}

function goConversation(row) {
  router.push(`/chat/${row.conversationId}`)
}

/* ---------- 差评回流（v0.9.39）：差评 → 难例回归用例 ---------- */

/** 点踩原因中文映射（与后端枚举一致） */
const REASON_LABELS = {
  offtopic: '答非所问',
  citation: '引用错误',
  outdated: '内容过时',
  other: '其他'
}

function reasonTagType(reason) {
  return { citation: 'danger', offtopic: 'warning', outdated: 'warning' }[reason] || 'info'
}

const reflowVisible = ref(false)
const reflowSubmitting = ref(false)
const reflowForm = reactive({
  kbId: '',
  question: '',
  docNameContains: '',
  keywords: [],
  note: ''
})

/** 从提问粗提候选关键词（评测 fallback 命中用，可编辑） */
function guessKeywords(q = '') {
  const parts = q
    .replace(/[?？!！。.,，、；;：:"'「」『』（）()~*《》]/g, ' ')
    .replace(/是什么|怎么样|怎么|如何|为什么|哪些|什么|请问|帮我|一下|谢谢|吗|呢/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
  return [...new Set(parts)].slice(0, 3)
}

async function openReflow(row) {
  reflowForm.kbId = row.refKbId || ''
  reflowForm.question = row.question || ''
  reflowForm.docNameContains = (row.sourceDocs || [])[0] || ''
  reflowForm.keywords = guessKeywords(row.question || '')
  reflowForm.note = `差评回流 · @${row.username || '未知用户'} · 原因：${
    REASON_LABELS[row.reason] || row.reason || '未标注'
  }${row.note ? ` · 备注：${row.note}` : ''}`
  reflowVisible.value = true

  // 库下拉兜底：默认 refKbId，若不在就绪列表（如库被删）回落到第一个可用库
  if (!kbStore.options.length) {
    await kbStore.fetchOptions().catch(() => {})
  }
  if (reflowForm.kbId && !kbStore.options.some((k) => k.id === reflowForm.kbId)) {
    reflowForm.kbId = kbStore.options[0]?.id || ''
  }
}

async function submitReflow() {
  reflowSubmitting.value = true
  try {
    await createEvalCase(reflowForm.kbId, {
      question: reflowForm.question.trim(),
      docNameContains: reflowForm.docNameContains.trim(),
      keywords: reflowForm.keywords,
      note: reflowForm.note,
      isHard: true,
      source: 'hardcase'
    })
    ElMessage.success('已创建难例回归用例')
    reflowVisible.value = false
    await loadAll() // 刷新明细，状态列更新为「已回流」
  } finally {
    reflowSubmitting.value = false
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [c, f] = await Promise.all([
      getCostAnalytics(rangeDays.value),
      getFeedbackAnalytics(rangeDays.value)
    ])
    cost.value = c
    fb.value = f
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.analytics-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--c-border-soft);
  background: var(--c-bg);
  flex-shrink: 0;
}

.page-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text);
}

.page-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--c-text-4);
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
}

.page-body {
  flex: 1;
  padding: 18px 24px 32px;
}

/* 概览卡片 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stat-box {
  padding: 14px 16px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
}

.stat-box.plain {
  margin-bottom: 0;
}

.s-label {
  font-size: 12px;
  color: var(--c-text-4);
}

.s-value {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 600;
  color: var(--c-text);
  line-height: 1.3;
}

.s-value.accent {
  color: var(--brand);
}

.s-value.ok {
  color: #16a34a;
}

.s-value.danger {
  color: #dc2626;
}

.s-foot {
  margin-top: 4px;
  font-size: 11px;
  color: var(--c-text-4);
}

/* 分区标题 */
.section-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 4px 0 10px;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--c-text);
}

.section-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--c-text-4);
}

/* 面板 */
.panel {
  padding: 14px 16px;
  margin-bottom: 14px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
}

.panel-title {
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
}

.panel-note {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.two-col {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 14px;
}

.two-col .panel {
  margin-bottom: 14px;
}

/* 日趋势柱状图（纯 CSS，悬停显示数值） */
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 150px;
  padding-top: 6px;
}

.bar-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
  min-width: 0;
  cursor: default;
}

.bar-track {
  display: flex;
  flex: 1;
  align-items: flex-end;
  width: 100%;
  max-width: 26px;
}

.bar-fill {
  width: 100%;
  min-height: 2px;
  background: linear-gradient(180deg, var(--brand), var(--brand-soft-2, #8fa8ef));
  border-radius: 3px 3px 0 0;
  transition: height 0.3s ease;
}

.bar-item:hover .bar-fill {
  filter: brightness(0.92);
}

.bar-label {
  overflow: hidden;
  max-width: 100%;
  font-size: 9.5px;
  color: var(--c-text-4);
  white-space: nowrap;
}

/* 迷你占比条 */
.mini-bar {
  height: 6px;
  background: var(--c-bg-soft);
  border-radius: 3px;
  overflow: hidden;
}

.mini-fill {
  height: 100%;
  background: var(--brand);
  border-radius: 3px;
}

.mono {
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  font-size: 12px;
}

.q-text,
.a-text {
  font-size: 12.5px;
  color: var(--c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.dim {
  font-size: 12px;
  color: var(--c-text-4);
}

.reflowed-ok {
  font-size: 12px;
  color: #16a34a;
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
