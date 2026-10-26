import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    // 官网首界面（企业门户）：公开访问，系统入口按登录态分流
    path: '/',
    name: 'landing',
    component: () => import('@/views/LandingView.vue'),
    meta: { title: '智核智库 · 企业级 AI 知识库问答平台', public: true }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', public: true }
  },
  {
    // 系统容器：官网占 / 后父路由改用真实前缀 /sys（空 path 在 vue-router 中也匹配 /，
    // 会与官网冲突触发登录重定向）；子路由用绝对路径，站内 /chat 等地址保持不变
    path: '/sys',
    component: () => import('@/layouts/MainLayout.vue'),
    redirect: '/chat',
    children: [
      {
        path: '/chat',
        name: 'chat',
        component: () => import('@/views/ChatView.vue'),
        meta: { title: '知识库问答' }
      },
      {
        path: '/chat/:id',
        name: 'chat-detail',
        component: () => import('@/views/ChatView.vue'),
        meta: { title: '知识库问答' }
      },
      {
        path: '/knowledge',
        name: 'knowledge',
        component: () => import('@/views/KnowledgeListView.vue'),
        meta: { title: '知识库管理' }
      },
      {
        path: '/knowledge/:id',
        name: 'knowledge-detail',
        component: () => import('@/views/KnowledgeDetailView.vue'),
        meta: { title: '知识库详情' }
      },
      {
        path: '/favorites',
        name: 'favorites',
        component: () => import('@/views/FavoritesView.vue'),
        meta: { title: '回答收藏夹' }
      },
      {
        path: '/analytics',
        name: 'analytics',
        component: () => import('@/views/AnalyticsView.vue'),
        meta: { title: '数据分析' }
      },
      {
        path: '/settings',
        name: 'settings',
        component: () => import('@/views/SettingsView.vue'),
        meta: { title: '系统设置' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在', public: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 简单的登录守卫（后续接入真实鉴权后替换为 token 校验接口）
router.beforeEach((to) => {
  const token = localStorage.getItem('kb_token')
  if (!to.meta.public && !token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && token) {
    return { name: 'chat' }
  }
  // 数据分析为平台级（站长/超管）：管理员/普通用户手输 URL 直闯时跳回问答页
  if (to.name === 'analytics') {
    let profile = null
    try {
      profile = JSON.parse(localStorage.getItem('kb_user') || 'null')
    } catch {
      /* 损坏的缓存视为未登录态，交给后端 403 */
    }
    if (!['owner', 'super_admin'].includes(profile?.role)) return { name: 'chat' }
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · AI 知识库问答系统` : 'AI 知识库问答系统'
})

export default router
