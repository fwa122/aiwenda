<template>
  <div class="layout">
    <!-- 移动端顶栏：汉堡开关 + 页面标题 + 全局搜索（桌面隐藏） -->
    <header class="mobile-topbar">
      <button class="topbar-icon" aria-label="打开菜单" @click="sidebarOpen = true">
        <el-icon :size="20"><Menu /></el-icon>
      </button>
      <div class="topbar-title text-ellipsis">{{ route.meta.title }}</div>
      <button class="topbar-icon" aria-label="全局搜索" @click="searchOpen = true">
        <el-icon :size="19"><Search /></el-icon>
      </button>
    </header>

    <!-- 移动端侧栏遮罩 -->
    <div class="sidebar-mask" :class="{ show: sidebarOpen }" @click="sidebarOpen = false" />

    <AppSidebar :mobile-open="sidebarOpen" @search="searchOpen = true" />

    <main class="layout-main">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <!-- 全局搜索弹窗（Ctrl+K / 移动端顶栏触发） -->
    <GlobalSearch v-model="searchOpen" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import GlobalSearch from '@/components/GlobalSearch.vue'
import { useUserStore } from '@/store'
import { useIsMobile } from '@/composables/useIsMobile'

const route = useRoute()
const userStore = useUserStore()
const isMobile = useIsMobile()

/** 移动端侧栏抽屉显隐 */
const sidebarOpen = ref(false)
/** 全局搜索弹窗显隐（Ctrl+K / 顶栏搜索触发） */
const searchOpen = ref(false)

// 路由变化（导航、选中会话）后自动收起移动端抽屉
watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
  }
)

// 桌面窗口拉宽时复位抽屉状态
watch(isMobile, (mobile) => {
  if (!mobile) sidebarOpen.value = false
})

onMounted(() => {
  if (!userStore.profile && userStore.token) {
    userStore.fetchProfile()
  }
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = true
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--c-bg-soft);
}

.layout-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

/* 移动端顶栏 */
.mobile-topbar {
  display: none;
}

.sidebar-mask {
  display: none;
}

@media (max-width: 768px) {
  .layout {
    flex-direction: column;
  }

  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    width: 100%;
    height: var(--topbar-h);
    padding: 0 10px;
    background: var(--c-bg-soft);
    border-bottom: 1px solid var(--c-border-soft);
  }

  .topbar-title {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    text-align: center;
    font-family: var(--serif);
    letter-spacing: 1px;
  }

  .topbar-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    color: var(--c-text-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
  }

  .topbar-icon:active {
    background: var(--c-bg-hover);
  }

  .layout-main {
    flex: 1;
    min-height: 0;
    height: auto;
  }

  .sidebar-mask {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(51, 48, 42, 0.4);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.24s ease;
  }

  .sidebar-mask.show {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
