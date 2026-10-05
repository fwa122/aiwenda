import { ElNotification } from 'element-plus'
import { getDocuments } from '@/api/knowledge'

/** 解析状态轮询周期（ms） */
const POLL_INTERVAL = 5000
/** 单个知识库最长监听时长（ms），超时自动停止 */
const MAX_WATCH_DURATION = 5 * 60 * 1000
/** 非终态状态（后端 status：pending | parsing | indexing | parsed | failed） */
const PENDING_STATUSES = ['pending', 'parsing', 'indexing']

/**
 * 已激活的监听器：kbId -> { timer, expireTimer, tracking: Map<docId, { name, status }> }
 * 模块级共享：同一 KB 重复调用 watchKb 只合并跟踪目标，不会叠加定时器
 */
const watchers = new Map()

/**
 * 请求浏览器通知权限。必须在用户手势（drop / click）回调中调用；
 * 权限为 denied 时静默跳过，仅保留应用内 ElNotification。
 */
export async function ensureNotifyPermission() {
  if (!('Notification' in window)) return
  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  } catch {
    /* 部分环境（如非 HTTPS）不支持，忽略 */
  }
}

/** 同步发送浏览器通知（仅在已授权时） */
function notifyBrowser(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body })
  } catch {
    /* 通知构造失败不影响应用内通知 */
  }
}

/**
 * 监听一个知识库内指定文档的解析状态。
 * - 每 5 秒轮询文档列表接口，仅跟踪传入的 docIds；
 * - status 变为 parsed / failed（含首次轮询即终态）时发应用内 + 浏览器通知；
 * - 全部到达终态或超过 5 分钟后自动停止；
 * - 同一 KB 重复监听会合并 docIds，不会叠加定时器。
 * @param {string} kbId
 * @param {string[]} docIds
 * @param {{ names?: Record<string, string> }} [options] docId -> 文档名
 */
export function watchKb(kbId, docIds = [], { names = {} } = {}) {
  if (!kbId || !docIds.length) return
  let entry = watchers.get(kbId)
  if (!entry) {
    entry = { timer: null, expireTimer: null, tracking: new Map() }
    watchers.set(kbId, entry)
  }
  docIds.forEach((id) => {
    const prev = entry.tracking.get(id)
    // 已在跟踪中的文档保留原状态，避免重置后重复通知
    entry.tracking.set(id, { name: names[id] || prev?.name || '', status: prev?.status ?? null })
  })
  if (entry.timer) return // 该 KB 已在轮询，仅合并目标即可

  entry.timer = setInterval(() => poll(kbId), POLL_INTERVAL)
  entry.expireTimer = setTimeout(() => stopWatch(kbId), MAX_WATCH_DURATION)
}

/** 单次轮询：对比状态变化并发通知 */
async function poll(kbId) {
  const entry = watchers.get(kbId)
  if (!entry) return
  let list = []
  try {
    const res = await getDocuments(kbId, { page: 1, pageSize: 100 })
    list = res?.list || []
  } catch {
    return // 请求失败（拦截器已提示）时本轮跳过，下轮继续
  }
  for (const [docId, tracked] of entry.tracking) {
    const doc = list.find((d) => d.id === docId)
    if (!doc) continue // 文档可能已被删除，不更新状态
    if (doc.status === tracked.status) continue
    tracked.status = doc.status
    const name = tracked.name || doc.name || docId
    if (doc.status === 'parsed') {
      ElNotification.success({ title: '解析完成', message: `《${name}》解析完成，可以开始提问`, duration: 5000 })
      notifyBrowser('解析完成', `《${name}》解析完成，可以开始提问`)
    } else if (doc.status === 'failed') {
      const reason = doc.errorMsg ? `：${doc.errorMsg}` : ''
      ElNotification.error({ title: '解析失败', message: `《${name}》解析失败${reason}`, duration: 8000 })
      notifyBrowser('解析失败', `《${name}》解析失败${reason}`)
    }
  }
  // 全部文档到达终态（parsed / failed）后自动停止
  const allSettled = [...entry.tracking.values()].every((t) => !PENDING_STATUSES.includes(t.status))
  if (allSettled) stopWatch(kbId)
}

/** 停止指定知识库的监听并清理定时器 */
export function stopWatch(kbId) {
  const entry = watchers.get(kbId)
  if (!entry) return
  clearInterval(entry.timer)
  clearTimeout(entry.expireTimer)
  watchers.delete(kbId)
}

/** 停止全部监听（页面离开兜底用） */
export function stopAllWatches() {
  ;[...watchers.keys()].forEach(stopWatch)
}
