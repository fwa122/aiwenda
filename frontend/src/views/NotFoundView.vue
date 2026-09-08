<template>
  <div class="not-found">
    <div class="code">404</div>
    <h2 class="title">页面不存在</h2>
    <p class="desc">你访问的页面已被移除或链接有误</p>
    <div class="actions">
      <el-button type="primary" @click="$router.push('/chat')">返回问答首页</el-button>
      <el-button @click="$router.back()">返回上一页</el-button>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  background: var(--c-bg-soft);
}

.code {
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  color: var(--brand);
  opacity: 0.85;
}

.title {
  margin-top: 16px;
  font-size: 19px;
  font-weight: 600;
}

.desc {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--c-text-3);
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 22px;
}
</style>
