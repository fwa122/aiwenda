import { defineStore } from 'pinia'
import * as userApi from '@/api/user'
import { rankOf } from '@/utils/rbac'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('kb_token') || '',
    profile: null,
    loading: false
  }),

  getters: {
    isLogin: (state) => !!state.token,
    nickname: (state) => state.profile?.nickname || '未登录',
    // 四级角色 rank：站长4 / 超管3 / 管理员2 / 普通用户1（v0.9.61）
    roleRank: (state) => rankOf(state.profile?.role),
    // 平台运维级（站长+超管）：模型/检索/密钥/安全策略/部门/日志 tab、建库
    isPlatform() {
      return this.roleRank >= 3
    },
    // 用户管理级（管理员及以上）：用户管理 tab、数据分析
    canManageUsers() {
      return this.roleRank >= 2
    },
    permissions() {
      const role = this.profile?.role || 'viewer'
      const rank = rankOf(role)
      if (rank >= 3) return ['chat', 'kb:read', 'kb:write', 'kb:create', 'settings', 'user']
      if (rank >= 2) return ['chat', 'kb:read', 'user']
      return ['chat', 'kb:read']
    }
  },

  actions: {
    async login(payload) {
      this.loading = true
      try {
        const res = await userApi.login(payload)
        this.token = res.token
        this.profile = res.user
        return res
      } finally {
        this.loading = false
      }
    },

    async fetchProfile() {
      if (!this.token) return null
      this.profile = await userApi.getProfile()
      return this.profile
    },

    async updateProfile(payload) {
      this.profile = await userApi.updateProfile(payload)
      return this.profile
    },

    logout() {
      userApi.logout()
      this.token = ''
      this.profile = null
    }
  }
})
