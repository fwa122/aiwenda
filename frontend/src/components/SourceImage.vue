<template>
  <!-- 引用命中图片切片时展示原文档插图（v0.9.64 方案B） -->
  <div v-if="src?.imageId" class="src-image">
    <div v-if="!url && !failed" class="img-loading" v-loading="true" element-loading-text="加载插图…" />
    <div v-else-if="failed" class="img-failed">插图加载失败</div>
    <el-image
      v-else
      :src="url"
      :preview-src-list="[url]"
      :preview-teleported="true"
      :hide-on-click-modal="true"
      fit="contain"
      class="img-main"
    >
      <template #error>
        <div class="img-failed">插图加载失败</div>
      </template>
    </el-image>
    <div class="img-cap" :title="src.snippet || ''">来自原文档的插图 · 点击可放大</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchDocumentImage } from '@/api/knowledge'

const props = defineProps({
  src: { type: Object, default: null }
})

const url = ref('')
const failed = ref(false)
let currentId = ''

watch(
  () => props.src?.imageId,
  async (id) => {
    if (!id) {
      release()
      return
    }
    if (id === currentId && url.value) return
    currentId = id
    failed.value = false
    try {
      const blob = await fetchDocumentImage(id)
      if (currentId !== id) return // 竞态：期间切换到其他图则丢弃
      release()
      url.value = URL.createObjectURL(blob)
    } catch {
      failed.value = true
    }
  },
  { immediate: true }
)

function release() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}

onBeforeUnmount(release)
</script>

<style scoped>
.src-image {
  margin-top: 8px;
}

.img-loading {
  min-height: 80px;
  border: 1px dashed var(--c-border-soft);
  border-radius: var(--radius-s);
}

.img-main {
  max-width: 100%;
  max-height: 220px;
  border-radius: var(--radius-s);
  border: 1px solid var(--c-border-soft);
  cursor: zoom-in;
}

.img-failed {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  font-size: 12px;
  color: var(--c-danger, #d03050);
  background: var(--c-bg-soft);
  border: 1px dashed var(--c-border-soft);
  border-radius: var(--radius-s);
}

.img-cap {
  margin-top: 3px;
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
