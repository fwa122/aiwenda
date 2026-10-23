import { ref } from 'vue'
import { getEmbeddingSummary } from '@/api/user'

/**
 * 嵌入渠道可用性摘要（聊天页/知识库页横幅预警共用）。
 * session 内单例缓存：双页共享一次请求结果，避免进入页面重复请求；
 * force=true 强制重查（如探测/报错后刷新状态）。请求失败按可用兜底（软提示不阻塞）。
 */
const summary = ref({ available: true, message: '', loaded: false })
let pending = null

export function useEmbeddingSummary() {
  async function refresh(force = false) {
    if (summary.value.loaded && !force) return summary.value
    if (!pending) {
      pending = getEmbeddingSummary()
        .then((data) => Object.assign(summary.value, data, { loaded: true }))
        .catch(() => Object.assign(summary.value, { available: true, message: '', loaded: true }))
        .finally(() => {
          pending = null
        })
    }
    await pending
    return summary.value
  }
  return { summary, refresh }
}
