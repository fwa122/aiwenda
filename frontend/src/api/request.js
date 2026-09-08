import axios from 'axios'
import { ElMessage } from 'element-plus'

/**
 * 是否启用 Mock 数据。
 * 后端就绪后，在 .env.development 中设置 VITE_USE_MOCK=false 即可切换到真实接口，
 * 页面与 store 代码无需任何改动。
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/** 响应统一结构：{ code, data, message } */
export const SUCCESS_CODE = 0

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 60000
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('kb_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (res) => {
    const body = res.data
    // 后端若未使用统一包装，则直接透传 data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== SUCCESS_CODE) {
        ElMessage.error(body.message || '请求失败')
        return Promise.reject(new Error(body.message || '请求失败'))
      }
      return body.data
    }
    return body
  },
  (err) => {
    const status = err.response?.status
    if (status === 401) {
      localStorage.removeItem('kb_token')
      ElMessage.error('登录已过期，请重新登录')
      window.location.href = '/login'
      return Promise.reject(err)
    }
    ElMessage.error(err.response?.data?.message || err.message || '网络异常')
    return Promise.reject(err)
  }
)

/** 真实请求入口 */
export function request(config) {
  return http(config)
}

/* ==========================================================================
   Mock 辅助方法
   ========================================================================== */

/** 模拟成功响应（含网络延迟） */
export function mockOk(data, delay = 260) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), delay + Math.random() * 160)
  })
}

/** 模拟失败响应 */
export function mockFail(message = '模拟请求失败', delay = 260) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      ElMessage.error(message)
      reject(new Error(message))
    }, delay)
  })
}

/**
 * 模拟 SSE 流式输出：把文本切片后按随机间隔推送
 * @param {string} text 完整文本
 * @param {object} options
 * @param {(piece:string)=>void} options.onChunk 增量回调
 * @param {(info?:{aborted:boolean})=>void} options.onDone 结束回调
 * @param {number} options.interval 基础推送间隔（毫秒）
 * @returns {{abort:Function}} 控制器，调用 abort() 可中断
 */
export function mockStreamText(text, { onChunk, onDone, interval = 16 } = {}) {
  let cursor = 0
  let timer = null
  let aborted = false

  const step = () => {
    if (aborted) return
    if (cursor >= text.length) {
      onDone?.()
      return
    }
    // 每次推送 2~6 个字符，模拟真实 token 粒度
    const size = 2 + Math.floor(Math.random() * 5)
    onChunk?.(text.slice(cursor, cursor + size))
    cursor += size
    timer = setTimeout(step, interval + Math.random() * 24)
  }

  timer = setTimeout(step, 220)

  return {
    abort() {
      if (aborted) return
      aborted = true
      if (timer) clearTimeout(timer)
      onDone?.({ aborted: true })
    }
  }
}

/** 前端分页 */
export function paginate(list = [], page = 1, pageSize = 10) {
  const start = (page - 1) * pageSize
  return {
    list: list.slice(start, start + pageSize),
    total: list.length,
    page,
    pageSize
  }
}

export default http
