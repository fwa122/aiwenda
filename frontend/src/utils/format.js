import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

/**
 * 相对时间：刚刚 / 5 分钟前 / 昨天 14:30 / 2026-08-01
 */
export function fromNow(time) {
  if (!time) return '-'
  const t = dayjs(time)
  const now = dayjs()
  if (now.diff(t, 'minute') < 1) return '刚刚'
  if (now.diff(t, 'hour') < 1) return `${now.diff(t, 'minute')} 分钟前`
  if (t.isSame(now, 'day')) return t.format('HH:mm')
  if (t.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${t.format('HH:mm')}`
  if (t.isSame(now, 'year')) return t.format('M月D日')
  return t.format('YYYY-MM-DD')
}

export function formatDateTime(time, pattern = 'YYYY-MM-DD HH:mm') {
  return time ? dayjs(time).format(pattern) : '-'
}

/** 文件大小格式化 */
export function formatSize(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 千分位数字 */
export function formatNumber(num = 0) {
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 毫秒转可读耗时 */
export function formatDuration(ms = 0) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 生成简易唯一 ID */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 数组深拷贝（Mock 层使用，避免引用污染） */
export function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

/** 睡眠（模拟网络延迟） */
export function sleep(ms = 200) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
