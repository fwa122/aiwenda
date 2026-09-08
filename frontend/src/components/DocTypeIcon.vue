<template>
  <span class="doc-type" :style="{ color, background: `${color}14` }">
    {{ label }}
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { docTypeMap } from '@/mock/knowledge'

const props = defineProps({
  type: { type: String, default: 'txt' }
})

const meta = computed(() => docTypeMap[props.type] || { label: props.type.toUpperCase(), color: '#8f959e' })
const label = computed(() => meta.value.label)
const color = computed(() => meta.value.color)
</script>

<style scoped>
.doc-type {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  border-radius: 4px;
  white-space: nowrap;
}
</style>
