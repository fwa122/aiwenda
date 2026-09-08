<template>
  <aside class="sidebar">
    <!-- 品牌区 -->
    <div class="brand">
      <div class="brand-logo">
        <el-icon :size="16"><ChatDotRound /></el-icon>
      </div>
      <div class="brand-text">
        <div class="brand-name">AI 知识库问答</div>
        <div class="brand-sub">Knowledge Base Assistant</div>
      </div>
    </div>

    <!-- 新建对话 -->
    <button class="new-chat" @click="handleNewChat">
      <el-icon :size="15"><EditPen /></el-icon>
      <span>新建对话</span>
      <kbd>Ctrl + K</kbd>
    </button>

    <!-- 主导航 -->
    <nav class="nav">
      <router-link to="/chat" class="nav-item" :class="{ active: isActive('/chat') }">
        <el-icon :size="16"><ChatDotRound /></el-icon>
        <span>知识库问答</span>
      </router-link>
      <router-link to="/knowledge" class="nav-item" :class="{ active: isActive('/knowledge') }">
        <el-icon :size="16"><Collection /></el-icon>
        <span>知识库管理</span>
      </router-link>
      <router-link to="/settings" class="nav-item" :class="{ active: isActive('/settings') }">
        <el-icon :size="16"><Setting /></el-icon>
        <span>系统设置</span>
      </router-link>
    </nav>

    <!-- 会话列表 -->
    <div class="conv-wrap scroll-thin">
      <div v-if="pinnedList.length" class="group">
        <div class="group-title">
          <el-icon :size="12"><Star /></el-icon> 置顶
        </div>
        <ConversationItem
          v-for="conv in pinnedList"
          :key="conv.id"
          :conversation="conv"
          :active="conv.id === chatStore.currentId"
          @select="handleSelect"
          @rename="handleRename"
          @pin="handlePin"
          @remove="handleRemove"
        />
      </div>

      <div v-for="group in chatStore.groupedConversations" :key="group.label" class="group">
        <div class="group-title">{{ group.label }}</div>
        <ConversationItem
          v-for="conv in group.items"
          :key="conv.id"
          :conversation="conv"
          :active="conv.id === chatStore.currentId"
          @select="handleSelect"
          @rename="handleRename"
          @pin="handlePin"
          @remove="handleRemove"
        />
      </div>

      <el-empty
        v-if="!chatStore.conversations.length && !chatStore.listLoading"
        description="暂无历史会话"
        :image-size="72"
        class="conv-empty"
      />
    </div>

    <!-- 底部用户区 -->
    <div class="sidebar-footer">
      <el-dropdown trigger="click" placement="top-start" @command="handleCommand">
        <div class="user">
          <div class="avatar">{{ avatarText }}</div>
          <div class="user-info">
            <div class="user-name text-ellipsis">{{ userStore.nickname }}</div>
            <div class="user-role">{{ userStore.profile?.roleName || '未登录' }}</div>
          </div>
          <el-icon :size="14" class="arrow"><ArrowUp /></el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              <el-icon><User /></el-icon>个人设置
            </el-dropdown-item>
            <el-dropdown-item command="docs">
              <el-icon><Document /></el-icon>开发文档
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided>
              <el-icon><SwitchButton /></el-icon>退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore, useUserStore } from '@/store'
import ConversationItem from './ConversationItem.vue'

const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
const userStore = useUserStore()

const avatarText = computed(() => (userStore.nickname || 'U').slice(0, 1).toUpperCase())
const pinnedList = computed(() => chatStore.pinnedList)

function isActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

onMounted(async () => {
  await chatStore.fetchConversations()
  await chatStore.fetchSuggestions()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    handleNewChat()
  }
}

function handleNewChat() {
  chatStore.resetConversation()
  if (route.path !== '/chat') router.push('/chat')
}

function handleSelect(conv) {
  if (conv.id === chatStore.currentId) return
  router.push(`/chat/${conv.id}`)
}

async function handleRename(conv) {
  try {
    const { value } = await ElMessageBox.prompt('请输入会话名称', '重命名', {
      inputValue: conv.title,
      inputPlaceholder: '最多 50 个字符',
      inputValidator: (v) => (v && v.trim().length <= 50) || '名称不能为空且不超过 50 个字符',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    await chatStore.renameConversation(conv.id, value.trim())
    ElMessage.success('已重命名')
  } catch (e) {
    /* 用户取消 */
  }
}

async function handlePin(conv) {
  await chatStore.togglePin(conv.id, !conv.pinned)
  ElMessage.success(conv.pinned ? '已取消置顶' : '已置顶')
}

async function handleRemove(conv) {
  try {
    await ElMessageBox.confirm(`确定删除会话「${conv.title}」吗？该操作不可恢复。`, '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    await chatStore.removeConversation(conv.id)
    if (route.params.id === conv.id) router.push('/chat')
    ElMessage.success('已删除')
  } catch (e) {
    /* 用户取消 */
  }
}

function handleCommand(cmd) {
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
    ElMessage.success('已退出登录')
  } else if (cmd === 'profile') {
    router.push('/settings')
  } else if (cmd === 'docs') {
    ElMessage.info('开发文档位于项目根目录 docs/ 下')
  }
}
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--sidebar-w);
  height: 100%;
  background: var(--c-bg-soft);
  border-right: 1px solid var(--c-border-soft);
}

/* 品牌 */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--topbar-h);
  padding: 0 16px;
  flex-shrink: 0;
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #fff;
  background: var(--brand);
  border-radius: 8px;
}

.brand-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}

.brand-sub {
  font-size: 11px;
  color: var(--c-text-4);
  line-height: 1.2;
}

/* 新建对话 */
.new-chat {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 24px);
  margin: 4px 12px 12px;
  padding: 9px 12px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--brand);
  background: var(--brand-soft);
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.18s;
}

.new-chat:hover {
  background: var(--brand-soft-2);
  border-color: var(--brand);
}

.new-chat kbd {
  margin-left: auto;
  padding: 1px 5px;
  font-family: inherit;
  font-size: 10.5px;
  color: var(--c-text-4);
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--c-border);
  border-radius: 4px;
}

/* 主导航 */
.nav {
  padding: 0 12px 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 2px;
  font-size: 13.5px;
  color: var(--c-text-2);
  border-radius: var(--radius-s);
  transition: all 0.16s;
}

.nav-item:hover {
  color: var(--c-text);
  background: var(--c-bg-hover);
}

.nav-item.active {
  color: var(--brand);
  background: var(--brand-soft);
  font-weight: 500;
}

/* 会话列表 */
.conv-wrap {
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  overflow-y: auto;
}

.group {
  margin-bottom: 10px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--c-text-4);
  letter-spacing: 0.3px;
}

.conv-empty {
  padding: 24px 0;
}

/* 底部用户 */
.sidebar-footer {
  flex-shrink: 0;
  padding: 8px 12px 12px;
  border-top: 1px solid var(--c-border-soft);
}

.user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: background 0.16s;
}

.user:hover {
  background: var(--c-bg-hover);
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6b8ff5, #3f6ae1);
  border-radius: 50%;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
}

.user-role {
  font-size: 11.5px;
  color: var(--c-text-4);
  line-height: 1.3;
}

.arrow {
  color: var(--c-text-4);
}
</style>
