<template>
  <div class="layout">
    <AppSidebar />
    <main class="layout-main">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
  </div>
</template>

<script setup>
import AppSidebar from '@/components/AppSidebar.vue'
import { useUserStore } from '@/store'
import { onMounted } from 'vue'

const userStore = useUserStore()

onMounted(() => {
  if (!userStore.profile && userStore.token) {
    userStore.fetchProfile()
  }
})
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
</style>
