import { request, mockOk, mockFail, paginate, USE_MOCK } from './request'
import {
  mockDb,
  mockSystemSettings,
  mockApiKeys,
  mockUsageTrend,
  mockOperationLogs
} from '@/mock'
import { clone, uid } from '@/utils/format'

/* ==========================================================================
   认证
   ========================================================================== */

/** 登录 */
export async function login(payload) {
  const { username, password } = payload
  if (USE_MOCK) {
    const account = mockDb.accounts.find(
      (acc) => acc.username === username && acc.password === password
    )
    if (!account) return mockFail('用户名或密码不正确', 400)
    const user = mockDb.users.find((u) => u.id === account.userId)
    localStorage.setItem('kb_token', `mock_token_${account.userId}_${Date.now()}`)
    localStorage.setItem('kb_user', JSON.stringify(user))
    return mockOk({ token: localStorage.getItem('kb_token'), user: clone(user) }, 420)
  }
  const res = await request({ url: '/v1/auth/login', method: 'post', data: payload })
  // 真实分支同样需要持久化 token，路由守卫读取的是 localStorage.kb_token
  localStorage.setItem('kb_token', res.token)
  localStorage.setItem('kb_user', JSON.stringify(res.user))
  return res
}

/** 注册（成功后跳回登录页，不自动登录） */
export function register(payload) {
  const { username, password, nickname, email } = payload
  if (USE_MOCK) {
    if (mockDb.accounts.some((acc) => acc.username === username)) {
      return mockFail('用户名已存在', 300)
    }
    const newUser = {
      id: uid('u'),
      username,
      nickname: nickname || username,
      email: email || '',
      role: 'viewer',
      roleName: '只读访客',
      department: '',
      status: 'active'
    }
    mockDb.users.push(newUser)
    mockDb.accounts.push({ userId: newUser.id, username, password })
    return mockOk({ id: newUser.id, username }, 400)
  }
  return request({ url: '/v1/auth/register', method: 'post', data: { username, password, nickname, email } })
}

/** 退出登录 */
export function logout() {
  localStorage.removeItem('kb_token')
  localStorage.removeItem('kb_user')
  if (USE_MOCK) return mockOk({ success: true }, 120)
  return request({ url: '/v1/auth/logout', method: 'post' })
}

/** 获取当前用户信息 */
export function getProfile() {
  if (USE_MOCK) {
    const cached = localStorage.getItem('kb_user')
    const user = cached ? JSON.parse(cached) : mockDb.users[0]
    return mockOk(clone(user), 160)
  }
  return request({ url: '/v1/user/profile', method: 'get' })
}

/** 更新个人信息 */
export function updateProfile(payload) {
  if (USE_MOCK) {
    const cached = JSON.parse(localStorage.getItem('kb_user') || '{}')
    const next = { ...cached, ...payload }
    localStorage.setItem('kb_user', JSON.stringify(next))
    const target = mockDb.users.find((u) => u.id === next.id)
    if (target) Object.assign(target, payload)
    return mockOk(clone(next), 260)
  }
  return request({ url: '/v1/user/profile', method: 'put', data: payload })
}

/** 修改密码 */
export function changePassword(payload) {
  if (USE_MOCK) return mockOk({ success: true }, 320)
  return request({ url: '/v1/user/password', method: 'put', data: payload })
}

/* ==========================================================================
   用户管理
   ========================================================================== */

/** 用户列表 */
export function getUsers(params = {}) {
  const { keyword = '', role = '', page = 1, pageSize = 10 } = params
  if (USE_MOCK) {
    let list = clone(mockDb.users)
    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter(
        (u) => u.username.includes(kw) || u.nickname.includes(kw) || u.email.includes(kw)
      )
    }
    if (role) list = list.filter((u) => u.role === role)
    return mockOk(paginate(list, page, pageSize), 220)
  }
  return request({ url: '/v1/users', method: 'get', params })
}

/** 新建用户 */
export function createUser(payload) {
  if (USE_MOCK) {
    const user = {
      id: uid('u'),
      username: payload.username,
      nickname: payload.nickname || payload.username,
      email: payload.email || '',
      phone: '',
      avatar: '',
      role: payload.role || 'viewer',
      roleName: { admin: '超级管理员', editor: '知识库编辑', viewer: '只读访客' }[payload.role] || '只读访客',
      department: payload.department || '-',
      status: payload.status || 'active',
      lastLoginAt: '-',
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      quota: {
        conversationLimit: 30,
        conversationUsed: 0,
        docLimit: 200,
        docUsed: 0,
        storageLimit: 1024 * 1024 * 1024,
        storageUsed: 0,
        monthlyTokenLimit: 200000,
        monthlyTokenUsed: 0
      }
    }
    mockDb.users.unshift(user)
    return mockOk(clone(user), 300)
  }
  return request({ url: '/v1/users', method: 'post', data: payload })
}

/** 更新用户 */
export function updateUser(id, payload) {
  if (USE_MOCK) {
    const user = mockDb.users.find((u) => u.id === id)
    if (!user) return Promise.reject(new Error('用户不存在'))
    Object.assign(user, payload)
    return mockOk(clone(user), 240)
  }
  return request({ url: `/v1/users/${id}`, method: 'put', data: payload })
}

/** 删除用户 */
export function deleteUser(id) {
  if (USE_MOCK) {
    const idx = mockDb.users.findIndex((u) => u.id === id)
    if (idx > -1) mockDb.users.splice(idx, 1)
    return mockOk({ id }, 240)
  }
  return request({ url: `/v1/users/${id}`, method: 'delete' })
}

/* ==========================================================================
   系统设置 / 密钥 / 统计
   ========================================================================== */

/** 获取系统设置 */
export function getSystemSettings() {
  if (USE_MOCK) return mockOk(clone(mockSystemSettings), 200)
  return request({ url: '/v1/settings', method: 'get' })
}

/** 保存系统设置 */
export function updateSystemSettings(payload) {
  if (USE_MOCK) {
    Object.assign(mockSystemSettings, clone(payload))
    return mockOk(clone(mockSystemSettings), 320)
  }
  return request({ url: '/v1/settings', method: 'put', data: payload })
}

/** API 密钥列表 */
export function getApiKeys() {
  if (USE_MOCK) return mockOk(clone(mockApiKeys), 200)
  return request({ url: '/v1/api-keys', method: 'get' })
}

/** 新建 API 密钥 */
export function createApiKey(payload) {
  if (USE_MOCK) {
    const key = {
      id: uid('key'),
      name: payload.name,
      key: `sk-kb-${Math.random().toString(16).slice(2, 6)}****************${Math.random()
        .toString(16)
        .slice(2, 6)}`,
      scope: payload.scope || [],
      status: 'active',
      quotaPerDay: payload.quotaPerDay || 1000,
      usedToday: 0,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      lastUsedAt: '-',
      expiredAt: payload.expiredAt || '2027-12-31 23:59:59'
    }
    mockApiKeys.unshift(key)
    return mockOk(clone(key), 300)
  }
  return request({ url: '/v1/api-keys', method: 'post', data: payload })
}

/** 删除 / 停用 API 密钥 */
export function deleteApiKey(id) {
  if (USE_MOCK) {
    const idx = mockApiKeys.findIndex((k) => k.id === id)
    if (idx > -1) mockApiKeys.splice(idx, 1)
    return mockOk({ id }, 220)
  }
  return request({ url: `/v1/api-keys/${id}`, method: 'delete' })
}

/** 用量统计概览 */
export function getUsageStats() {
  if (USE_MOCK) {
    return mockOk(
      {
        trend: clone(mockUsageTrend),
        summary: {
          totalQuestions: 6866,
          weekQuestions: 6866,
          avgHitRate: 0.932,
          avgLatency: 1386,
          totalTokens: 1_284_660,
          activeUsers: 168,
          docCount: 15,
          chunkCount: 1222
        }
      },
      220
    )
  }
  return request({ url: '/v1/stats/usage', method: 'get' })
}

/** 操作日志 */
export function getOperationLogs(params = {}) {
  const { page = 1, pageSize = 10 } = params
  if (USE_MOCK) return mockOk(paginate(clone(mockOperationLogs), page, pageSize), 200)
  return request({ url: '/v1/logs/operations', method: 'get', params })
}
