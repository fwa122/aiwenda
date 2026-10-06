<template>
  <div class="page-container">
    <div class="page-inner">
      <!-- 页头 -->
      <header class="page-head">
        <div>
          <h1 class="page-title">回答收藏夹</h1>
          <p class="page-desc">收藏有价值的问答快照，消息或文档删除后收藏内容不受影响</p>
        </div>
        <div class="head-actions">
          <el-select
            v-model="kbId"
            placeholder="全部知识库"
            clearable
            style="width: 190px"
            @change="handleFilterChange"
          >
            <el-option
              v-for="kb in knowledgeStore.options"
              :key="kb.id"
              :label="kb.name"
              :value="kb.id"
            />
          </el-select>
          <el-button :disabled="!total" @click="handleExport">
            <el-icon><Download /></el-icon>导出 Markdown
          </el-button>
        </div>
      </header>

      <!-- 收藏卡片列表 -->
      <section v-loading="loading" class="fav-list">
        <article v-for="fav in list" :key="fav.id" class="fav-card app-card">
          <!-- 问题（引用块） -->
          <div class="fav-question">
            <el-icon :size="14" class="q-icon"><ChatDotRound /></el-icon>
            <span class="q-text">{{ fav.question || '（未记录到原问题）' }}</span>
            <el-tooltip content="取消收藏" placement="top">
              <button class="fav-remove" @click="handleRemove(fav)">
                <el-icon :size="14"><StarFilled /></el-icon>
              </button>
            </el-tooltip>
          </div>

          <!-- 回答摘要（Markdown 渲染，超高折叠） -->
          <div
            class="answer-wrap"
            :class="{ expanded: expandedIds.has(fav.id) }"
          >
            <div class="md-body answer-md" v-html="renderAnswer(fav.answer)" />
          </div>
          <button
            v-if="fav.answer.length > 160"
            class="expand-btn"
            @click="toggleExpand(fav.id)"
          >
            {{ expandedIds.has(fav.id) ? '收起' : '展开全文' }}
            <el-icon :size="12">
              <ArrowUp v-if="expandedIds.has(fav.id)" />
              <ArrowDown v-else />
            </el-icon>
          </button>

          <!-- 引用来源 -->
          <div v-if="fav.sources?.length" class="fav-sources">
            <el-tag
              v-for="s in fav.sources"
              :key="`${fav.id}-${s.index}`"
              size="small"
              effect="plain"
              class="source-tag"
            >
              {{ s.docName || s.docId }} · 第 {{ s.page }} 页
              <template v-if="s.score">· 相似度 {{ (s.score * 100).toFixed(1) }}%</template>
            </el-tag>
          </div>

          <!-- 底部信息 -->
          <footer class="fav-foot">
            <span class="foot-meta text-ellipsis">
              来自会话「{{ fav.conversationTitle || '已删除的会话' }}」 · {{ formatDateTime(fav.createdAt) }}
            </span>
            <el-button link type="primary" @click="goConversation(fav)">
              查看会话<el-icon><ArrowRight /></el-icon>
            </el-button>
          </footer>
        </article>

        <el-empty
          v-if="!loading && !list.length"
          :description="kbId ? '该知识库下暂无收藏' : '暂无收藏，去问答页点亮回答下方的星标吧'"
          :image-size="96"
        />
      </section>

      <!-- 分页 -->
      <footer v-if="total > pageSize" class="fav-pagination">
        <el-pagination
          v-model:current-page="page"
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          @current-change="load"
        />
      </footer>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useKnowledgeStore } from '@/store'
import { getFavorites, removeFavorite } from '@/api/favorite'
import { renderMarkdown, stripMarkdown } from '@/utils/markdown'
import { formatDateTime } from '@/utils/format'

const router = useRouter()
const knowledgeStore = useKnowledgeStore()

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const kbId = ref('')
const loading = ref(false)
/** 已展开全文的收藏卡片集合 */
const expandedIds = ref(new Set())

onMounted(async () => {
  // 知识库筛选选项（失败不阻断收藏列表加载）
  knowledgeStore.fetchOptions().catch(() => {})
  await load()
})

async function load() {
  loading.value = true
  try {
    const res = await getFavorites({ kbId: kbId.value, page: page.value, pageSize })
    list.value = res.list || []
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

/** 切换知识库筛选：回到第一页重新加载 */
function handleFilterChange() {
  page.value = 1
  load()
}

/** 回答 Markdown 渲染（卡片内不解析内联引用点击，纯展示） */
function renderAnswer(answer) {
  return renderMarkdown(answer || '')
}

function toggleExpand(id) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function goConversation(fav) {
  router.push(`/chat/${fav.conversationId}`)
}

async function handleRemove(fav) {
  try {
    await ElMessageBox.confirm(
      `确定取消收藏「${stripMarkdown(fav.question || '').slice(0, 30) || '该问答'}」吗？`,
      '取消收藏',
      { type: 'warning', confirmButtonText: '取消收藏', cancelButtonText: '保留' }
    )
  } catch (e) {
    return /* 用户取消 */
  }
  await removeFavorite(fav.id)
  // 本地移除并修正总数，避免翻页偏移
  list.value = list.value.filter((f) => f.id !== fav.id)
  total.value = Math.max(0, total.value - 1)
  ElMessage.success('已取消收藏')
}

/** 导出当前筛选下的全部收藏为 Markdown（格式与 ChatView 会话导出一致） */
async function handleExport() {
  try {
    // 拉取当前筛选的全部收藏（上限 1000 条，收藏场景足够）
    const res = await getFavorites({ kbId: kbId.value, page: 1, pageSize: 1000 })
    const all = res.list || []
    if (!all.length) {
      ElMessage.info('当前筛选条件下没有可导出的收藏')
      return
    }
    const lines = [
      '# 回答收藏夹',
      '',
      `> 导出时间：${formatDateTime(new Date(), 'YYYY-MM-DD HH:mm:ss')} · 共 ${all.length} 条收藏`,
      ''
    ]
    all.forEach((fav, i) => {
      lines.push(`## ${i + 1}. ${fav.question || '（未记录到原问题）'}`)
      lines.push('')
      lines.push(`> 来自会话「${fav.conversationTitle || '已删除的会话'}」 · ${formatDateTime(fav.createdAt)}`)
      lines.push('')
      lines.push('**回答**')
      lines.push('')
      lines.push(fav.answer || '')
      lines.push('')
      if (fav.sources?.length) {
        lines.push('**引用来源**')
        lines.push('')
        fav.sources.forEach((s) => {
          lines.push(
            `- [${s.index}] ${s.docName || s.docId}（第 ${s.page} 页，相似度 ${(s.score * 100).toFixed(1)}%）`
          )
        })
        lines.push('')
      }
      lines.push('---')
      lines.push('')
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `回答收藏夹_${formatDateTime(new Date(), 'YYYYMMDD_HHmmss')}.md`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出 Markdown')
  } catch (e) {
    /* 拉取失败：拦截器已提示 */
  }
}
</script>

<style scoped>
/* 页头（与知识库管理页同款布局） */
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

/* 收藏卡片 */
.fav-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 200px;
}

.fav-card {
  padding: 16px 18px;
}

/* 问题引用块 */
.fav-question {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.6;
  background: var(--brand-soft-2);
  border-left: 3px solid var(--brand);
  border-radius: 0 var(--radius-s) var(--radius-s) 0;
}

.q-icon {
  flex-shrink: 0;
  margin-top: 3px;
  color: var(--brand);
}

.q-text {
  flex: 1;
  min-width: 0;
}

.fav-remove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  color: var(--brand);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.16s;
}

.fav-remove:hover {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}

/* 回答摘要：默认限高折叠，expanded 解除 */
.answer-wrap {
  position: relative;
  max-height: 220px;
  overflow: hidden;
}

.answer-wrap.expanded {
  max-height: none;
}

.answer-wrap::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 48px;
  background: linear-gradient(to bottom, transparent, var(--c-bg));
  pointer-events: none;
}

.answer-wrap.expanded::after {
  display: none;
}

.answer-md {
  font-size: 13.5px;
}

.expand-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--c-text-3);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.16s;
}

.expand-btn:hover {
  color: var(--brand);
  background: var(--brand-soft);
}

/* 引用来源标签 */
.fav-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.source-tag {
  max-width: 100%;
}

/* 底部信息 */
.fav-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--c-border-soft);
}

.foot-meta {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--c-text-4);
}

/* 分页 */
.fav-pagination {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}
</style>
