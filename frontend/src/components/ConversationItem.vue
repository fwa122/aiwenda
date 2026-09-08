<template>
  <div class="conv-item" :class="{ active }" @click="$emit('select', conversation)">
    <el-icon :size="14" class="conv-icon"><ChatLineSquare /></el-icon>
    <span class="conv-title text-ellipsis">{{ conversation.title }}</span>

    <el-dropdown
      trigger="click"
      placement="bottom-end"
      @command="(cmd) => $emit(cmd, conversation)"
    >
      <span class="conv-more" @click.stop>
        <el-icon :size="14"><MoreFilled /></el-icon>
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="pin">
            <el-icon><Star /></el-icon>{{ conversation.pinned ? '取消置顶' : '置顶' }}
          </el-dropdown-item>
          <el-dropdown-item command="rename">
            <el-icon><EditPen /></el-icon>重命名
          </el-dropdown-item>
          <el-dropdown-item command="remove" divided>
            <el-icon><Delete /></el-icon>删除
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
defineProps({
  conversation: { type: Object, required: true },
  active: { type: Boolean, default: false }
})

defineEmits(['select', 'rename', 'pin', 'remove'])
</script>

<style scoped>
.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 10px;
  border-radius: var(--radius-s);
  color: var(--c-text-2);
  cursor: pointer;
  transition: background 0.16s;
}

.conv-item:hover {
  background: var(--c-bg-hover);
}

.conv-item.active {
  background: var(--brand-soft);
  color: var(--brand);
}

.conv-icon {
  flex-shrink: 0;
  color: var(--c-text-4);
}

.conv-item.active .conv-icon {
  color: var(--brand);
}

.conv-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.conv-more {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--c-text-4);
  border-radius: 4px;
  opacity: 0;
  transition: all 0.16s;
}

.conv-item:hover .conv-more {
  opacity: 1;
}

.conv-more:hover {
  color: var(--c-text);
  background: var(--c-bg-active);
}
</style>
