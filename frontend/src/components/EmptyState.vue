<template>
  <div class="empty">
    <div class="logo">
      <el-icon :size="28"><ChatDotRound /></el-icon>
    </div>
    <h1 class="title">{{ greeting }}，{{ nickname }}</h1>
    <p class="subtitle">基于企业知识库的智能问答，回答均可追溯引用来源</p>

    <!-- 能力说明 -->
    <div class="features">
      <div v-for="f in features" :key="f.title" class="feature">
        <el-icon :size="15" class="f-icon"><component :is="f.icon" /></el-icon>
        <span>{{ f.title }}</span>
      </div>
    </div>

    <!-- 范围提示 -->
    <div v-if="kbCount" class="kb-hint">
      <el-tag size="small" effect="light" type="info">
        已接入 {{ kbCount }} 个知识库
      </el-tag>
    </div>

    <!-- 推荐问题 -->
    <div class="suggestions">
      <div
        v-for="item in suggestions"
        :key="item.title"
        class="sug-card"
        @click="$emit('select', item.title)"
      >
        <el-icon :size="16" class="sug-icon"><component :is="item.icon" /></el-icon>
        <div class="sug-body">
          <div class="sug-title">{{ item.title }}</div>
          <div class="sug-desc text-ellipsis">{{ item.desc }}</div>
        </div>
        <el-icon :size="14" class="sug-arrow"><Right /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useUserStore } from '@/store'

defineProps({
  suggestions: { type: Array, default: () => [] },
  kbCount: { type: Number, default: 0 }
})

defineEmits(['select'])

const userStore = useUserStore()
const nickname = computed(() => userStore.profile?.nickname || '同学')

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const features = [
  { title: 'RAG 检索增强', icon: 'Search' },
  { title: '引用可溯源', icon: 'Link' },
  { title: '多知识库切换', icon: 'Collection' },
  { title: '流式实时输出', icon: 'Lightning' }
]
</script>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 24px 40px;
  text-align: center;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 18px;
  color: #fff;
  background: linear-gradient(135deg, #6b8ff5, #3f6ae1);
  border-radius: 16px;
  box-shadow: 0 6px 20px rgba(63, 106, 225, 0.22);
}

.title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.subtitle {
  margin-top: 8px;
  font-size: 14px;
  color: var(--c-text-3);
}

.features {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
}

.feature {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--c-text-2);
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: 14px;
}

.f-icon {
  color: var(--brand);
}

.suggestions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 780px;
  margin-top: 32px;
}

.sug-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  text-align: left;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.18s;
}

.sug-card:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}

.sug-icon {
  flex-shrink: 0;
  color: var(--brand);
}

.sug-body {
  flex: 1;
  min-width: 0;
}

.sug-title {
  font-size: 13.5px;
  font-weight: 500;
}

.sug-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-4);
}

.sug-arrow {
  flex-shrink: 0;
  color: var(--c-text-4);
}

.kb-hint {
  margin-top: 10px;
}

@media (max-width: 900px) {
  .suggestions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
