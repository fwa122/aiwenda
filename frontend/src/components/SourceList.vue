<template>
  <div v-if="sources.length" class="sources">
    <div class="sources-head" @click="expanded = !expanded">
      <el-icon :size="14"><Document /></el-icon>
      <span>引用来源（{{ sources.length }}）</span>
      <el-icon :size="13" class="caret" :class="{ open: expanded }"><ArrowDown /></el-icon>
    </div>

    <div v-show="expanded" class="source-list fade-in">
      <div
        v-for="src in sources"
        :key="src.id"
        class="source-item"
        @click="$emit('preview', src)"
      >
        <span class="idx">[{{ src.index }}]</span>
        <div class="source-main">
          <div class="source-name">
            <DocTypeIcon :type="src.docType" />
            <span class="text-ellipsis">{{ src.docName }}</span>
            <span class="score">{{ (src.score * 100).toFixed(1) }}%</span>
          </div>
          <p class="snippet text-clamp-2">{{ src.snippet }}</p>
          <div class="source-tags">
            <span>{{ src.kbName }}</span>
            <span>第 {{ src.page }} 页</span>
            <span>切片 #{{ src.chunkIndex }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import DocTypeIcon from './DocTypeIcon.vue'

const props = defineProps({
  sources: { type: Array, default: () => [] },
  /** 最新一条助手消息默认展开来源列表 */
  defaultExpanded: { type: Boolean, default: false }
})

defineEmits(['preview'])

const expanded = ref(props.defaultExpanded)
</script>

<style scoped>
.sources {
  margin-top: 10px;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
  background: var(--c-bg);
  overflow: hidden;
}

.sources-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--c-text-2);
  cursor: pointer;
  user-select: none;
  transition: background 0.16s;
}

.sources-head:hover {
  background: var(--c-bg-soft);
}

.caret {
  margin-left: auto;
  transition: transform 0.2s;
}

.caret.open {
  transform: rotate(180deg);
}

.source-list {
  padding: 0 8px 8px;
}

.source-item {
  display: flex;
  gap: 8px;
  padding: 10px;
  margin-top: 4px;
  background: var(--c-bg-soft);
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: all 0.16s;
}

.source-item:hover {
  background: var(--brand-soft-2);
  box-shadow: inset 0 0 0 1px var(--brand-soft);
}

.idx {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
}

.source-main {
  flex: 1;
  min-width: 0;
}

.source-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
}

.source-name .text-ellipsis {
  flex: 1;
  min-width: 0;
}

.score {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--c-success);
}

.snippet {
  margin: 4px 0 6px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.source-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--c-text-4);
}

.source-tags span {
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--c-border-soft);
  border-radius: 3px;
}
</style>
