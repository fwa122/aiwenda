import { defineStore } from 'pinia'
import * as userApi from '@/api/user'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('kb_token') || '',
    profile: null,
    loading: false
  }),

  getters: {
    isLogin: (state) => !!state.token,
    nickname: (state) => state.profile?.nickname || '未登录',
    isAdmin: (state) => state.profile?.role === 'admin',
    permissions() {
      const role = this.profile?.role || 'viewer'
      return {
        admin: ['chat', 'kb:read', 'kb:write', 'settings', 'user'],
        editor: ['chat', 'kb:read', 'kb:write'],
        viewer: ['chat', 'kb:read']
      }[role] || ['chat']
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
