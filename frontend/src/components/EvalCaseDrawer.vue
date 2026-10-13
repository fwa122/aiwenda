<template>
  <el-drawer v-model="visible" title="评测用例管理" size="660px">
    <div class="case-drawer">
      <div class="case-toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜索问题 / 目标文档"
          clearable
          size="small"
          style="width: 190px"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div v-if="canWrite" class="case-actions">
          <el-button size="small" type="primary" @click="openCreate">
            <el-icon><Plus /></el-icon>新增用例
          </el-button>
          <el-dropdown trigger="click" @command="handleImportCommand">
            <el-button size="small">
              <el-icon><Upload /></el-icon>导入<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="file">导入 JSON 文件</el-dropdown-item>
                <el-dropdown-item command="template">导入内置模板（20 条）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" @click="exportCases">
            <el-icon><Download /></el-icon>导出
          </el-button>
          <input ref="fileInput" type="file" accept=".json" style="display: none" @change="handleFileImport" />
        </div>
      </div>

      <el-table v-loading="loading" :data="filtered" size="small" style="width: 100%">
        <el-table-column label="问题" min-width="210" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="q-cell">{{ row.question }}</span>
            <el-tag v-if="row.isHard" size="small" type="danger" effect="light">难例</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目标文档" width="118" show-overflow-tooltip>
          <template #default="{ row }">{{ row.docNameContains || '—' }}</template>
        </el-table-column>
        <el-table-column label="关键词" min-width="130">
          <template #default="{ row }">
            <el-tag v-for="k in row.keywords.slice(0, 2)" :key="k" size="small" effect="plain" class="kw-tag">
              {{ k }}
            </el-tag>
            <span v-if="row.keywords.length > 2" class="text-muted">+{{ row.keywords.length - 2 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="72" align="center">
          <template #default="{ row }">
            <span class="text-muted">{{ sourceMap[row.source] || '手工' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="60" align="center">
          <template #default="{ row }">
            <el-switch
              v-if="canWrite"
              :model-value="row.enabled"
              size="small"
              @change="(v) => toggleEnabled(row, v)"
            />
            <span v-else class="text-muted">{{ row.enabled ? '是' : '否' }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="148" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.isHard" link type="success" size="small" @click="promote(row)">
              转为正式
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无评测用例，可导入内置模板或手工新建" :image-size="70" />
        </template>
      </el-table>

      <p class="case-tip">
        仅「启用」的用例参与评测评分。评测报告未命中的用例可一键标记为难例用于回归验证，检索修复后在此「转为正式」。
      </p>
    </div>

    <!-- 新增 / 编辑用例（@submit.prevent：拦截 el-form 原生 form 的回车隐式提交，避免整页刷新跳回默认 tab） -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑用例' : '新增用例'" width="520px" append-to-body>
      <el-form :model="form" label-width="86px" @submit.prevent>
        <el-form-item label="测试问题" required>
          <el-input
            v-model="form.question"
            type="textarea"
            :rows="2"
            maxlength="512"
            show-word-limit
            placeholder="用户可能的提问方式，如：检索时两路结果怎么融合？"
          />
        </el-form-item>
        <el-form-item label="目标文档" required>
          <el-input
            v-model="form.docNameContains"
            maxlength="128"
            placeholder="期望命中的文档名关键字，如：开发文档"
          />
        </el-form-item>
        <el-form-item label="关键词">
          <el-select
            v-model="form.keywords"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            placeholder="切片内容中应出现的关键词，输入后回车添加"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="2000"
            show-word-limit
            placeholder="用例出处或依据，如：开发文档 6.8.1 RRF 融合重排"
          />
        </el-form-item>
        <el-form-item label="难例标记">
          <el-switch v-model="form.isHard" />
          <span class="form-hint" style="margin-left: 10px">难例参与「仅难例」回归评测，可随时转正</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Upload, Download, ArrowDown } from '@element-plus/icons-vue'
import {
  getEvalCases,
  createEvalCase,
  updateEvalCase,
  deleteEvalCase,
  importEvalCases
} from '@/api/knowledge'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  kbId: { type: String, default: '' },
  canWrite: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'changed'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const sourceMap = { manual: '手工', template: '模板', hardcase: '回归' }

const list = ref([])
const loading = ref(false)
const keyword = ref('')
const saving = ref(false)
const fileInput = ref(null)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    (c) =>
      c.question.toLowerCase().includes(kw) ||
      (c.docNameContains || '').toLowerCase().includes(kw)
  )
})

watch(
  () => props.modelValue,
  (v) => {
    if (v) load()
  }
)

async function load() {
  if (!props.kbId) return
  loading.value = true
  try {
    const data = await getEvalCases(props.kbId)
    list.value = data.list || []
  } catch (e) {
    ElMessage.error(e.message || '评测用例加载失败')
  } finally {
    loading.value = false
  }
}

/** 变更后刷新并通知父视图重新拉取（评测数据集同步） */
async function reload() {
  await load()
  emit('changed')
}

/* ---------------- 新增 / 编辑 ---------------- */
const dialogVisible = ref(false)
const editingId = ref('')
const form = ref({ question: '', docNameContains: '', keywords: [], note: '', isHard: false })

function openCreate() {
  editingId.value = ''
  form.value = { question: '', docNameContains: '', keywords: [], note: '', isHard: false }
  dialogVisible.value = true
}

function openEdit(row) {
  editingId.value = row.id
  form.value = {
    question: row.question,
    docNameContains: row.docNameContains,
    keywords: [...(row.keywords || [])],
    note: row.note || '',
    isHard: !!row.isHard
  }
  dialogVisible.value = true
}

async function save() {
  const payload = {
    question: form.value.question.trim(),
    docNameContains: form.value.docNameContains.trim(),
    keywords: form.value.keywords,
    note: form.value.note.trim(),
    isHard: form.value.isHard
  }
  if (!payload.question) {
    ElMessage.warning('请填写测试问题')
    return
  }
  if (!payload.docNameContains) {
    ElMessage.warning('请填写目标文档关键字')
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await updateEvalCase(props.kbId, editingId.value, payload)
      ElMessage.success('用例已更新')
    } else {
      await createEvalCase(props.kbId, payload)
      ElMessage.success('用例已创建')
    }
    dialogVisible.value = false
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/* ---------------- 启用 / 转正 / 删除 ---------------- */
async function toggleEnabled(row, v) {
  try {
    await updateEvalCase(props.kbId, row.id, { enabled: v })
    row.enabled = v
    emit('changed')
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function promote(row) {
  try {
    await ElMessageBox.confirm(
      `将「${row.question}」转为正式用例？将取消难例标记，参与常规评测评分。`,
      '转为正式用例',
      { type: 'info', confirmButtonText: '转为正式', cancelButtonText: '取消' }
    )
    await updateEvalCase(props.kbId, row.id, { isHard: false })
    ElMessage.success('已转为正式用例')
    await reload()
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message)
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除用例「${row.question}」吗？`, '删除用例', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    await deleteEvalCase(props.kbId, row.id)
    ElMessage.success('已删除')
    await reload()
  } catch (e) {
    /* 取消 */
  }
}

/* ---------------- 导入 / 导出 ---------------- */
function handleImportCommand(cmd) {
  if (cmd === 'file') {
    fileInput.value?.click()
  } else if (cmd === 'template') {
    importTemplate()
  }
}

/**
 * 兼容三种 JSON 形态：golden 数据集 / 难例导出文件 / 裸数组。
 * 难例文件（含 offRank/onRank 字段）自动标记 hardcase 来源并附回归证据。
 */
function toImportItem(c) {
  const isHardFile = c.source === 'hardcase' || c.offRank !== undefined || c.onRank !== undefined
  let note = c.note || ''
  if (isHardFile && (c.offRank !== undefined || c.onRank !== undefined)) {
    note = `${note ? `${note}；` : ''}[回归证据] 精排关#${c.offRank ?? 0} 精排开#${c.onRank ?? 0}`
  }
  return {
    question: String(c.question || ''),
    docNameContains: String(c.docNameContains || ''),
    keywords: Array.isArray(c.keywords)
      ? c.keywords
      : String(c.keywords || '')
          .split(/[,，\s]+/)
          .filter(Boolean),
    note,
    source: isHardFile ? 'hardcase' : c.source === 'template' ? 'template' : 'manual',
    isHard: isHardFile || !!c.isHard
  }
}

async function doImport(cases, label) {
  if (!cases.length) {
    ElMessage.warning('文件中没有可用用例')
    return
  }
  try {
    const res = await importEvalCases(props.kbId, cases)
    ElMessage.success(`${label}完成：新增 ${res.created} 条，跳过重复 ${res.skipped} 条`)
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  }
}

async function importTemplate() {
  try {
    const res = await fetch('/datasets/golden-qa.json')
    const payload = await res.json()
    await doImport((payload.cases || []).map((c) => ({ ...toImportItem(c), source: 'template' })), '内置模板导入')
  } catch {
    ElMessage.error('内置模板加载失败')
  }
}

async function handleFileImport(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const payload = JSON.parse(text)
    const rawCases = Array.isArray(payload) ? payload : payload.cases || []
    await doImport(rawCases.map(toImportItem), '导入')
  } catch (e) {
    ElMessage.error('JSON 解析失败，请检查文件格式')
  }
}

function exportCases() {
  if (!list.value.length) {
    ElMessage.warning('暂无用例可导出')
    return
  }
  const payload = {
    dataset: 'kb-eval-export',
    exportedAt: new Date().toISOString(),
    cases: list.value.map(({ question, docNameContains, keywords, note, source, isHard }) => ({
      question,
      docNameContains,
      keywords,
      note,
      source,
      isHard
    }))
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'eval-cases.json'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.case-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.case-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.case-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.q-cell {
  margin-right: 6px;
}

.kw-tag {
  margin-right: 4px;
}

.case-tip {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
</style>
