<template>
  <div class="login">
    <!-- 背景装饰 -->
    <div class="bg-blob blob-a"></div>
    <div class="bg-blob blob-b"></div>

    <div class="login-card">
      <!-- 品牌区 -->
      <div class="brand">
        <div class="logo"><el-icon :size="18"><ChatDotRound /></el-icon></div>
        <span class="brand-name">AI 知识库问答系统</span>
      </div>

      <h2 class="form-title">{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h2>
      <p class="form-sub">{{ mode === 'login' ? '登录以继续使用企业知识库问答' : '注册后返回登录页，使用新账号登录' }}</p>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="mode === 'login' ? handleLogin() : handleRegister()">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" :prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="mode === 'login' ? '请输入密码' : '8~32 位，需同时包含字母和数字'"
            :prefix-icon="Lock"
            show-password
            clearable
          />
        </el-form-item>
        <template v-if="mode === 'register'">
          <el-form-item prop="confirmPassword">
            <el-input v-model="form.confirmPassword" type="password" placeholder="请再次输入密码" :prefix-icon="Lock" show-password clearable />
          </el-form-item>
          <el-form-item prop="nickname">
            <el-input v-model="form.nickname" placeholder="昵称（选填）" :prefix-icon="User" clearable />
          </el-form-item>
        </template>

        <div class="form-extra">
          <el-checkbox v-if="mode === 'login'" v-model="form.remember">记住我</el-checkbox>
          <a v-if="mode === 'login'" class="link" @click="ElMessage.info('请联系系统管理员重置密码')">忘记密码？</a>
          <a v-else class="link" @click="backToLogin">已有账号？返回登录</a>
        </div>

        <el-button v-if="mode === 'login'" type="primary" class="submit" :loading="loading" @click="handleLogin">
          登录
        </el-button>
        <el-button v-else type="primary" class="submit" :loading="loading" @click="handleRegister">
          注册
        </el-button>
      </el-form>

      <div v-if="mode === 'login'" class="register-hint">
        还没有账号？<a class="link" @click="switchToRegister">立即注册</a>
      </div>
    </div>

    <p class="foot-note">
      <template v-if="mode === 'login'">
        <span>演示账号：<a class="demo-fill" @click="fill(demoAccounts[0])">admin / admin123</a></span>
        <span class="dot">·</span>
        <a class="link" @click="switchToRegister">注册账号</a>
      </template>
      <template v-else>
        <a class="link" @click="backToLogin">返回登录</a>
        <span class="dot">·</span>
      </template>
      <span class="dot">·</span>
      Vue 3 + Node.js + Python · 企业私有化知识库解决方案
    </p>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/store'
import * as userApi from '@/api/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref(null)
const loading = ref(false)
const mode = ref('login') // login | register

const form = reactive({
  username: 'admin',
  password: 'admin123',
  confirmPassword: '',
  nickname: '',
  remember: true
})

const rules = computed(() => {
  const base = {
    username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
    password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
  }
  if (mode.value === 'register') {
    base.username = [
      { required: true, message: '请输入用户名', trigger: 'blur' },
      { pattern: /^[A-Za-z][A-Za-z0-9_]{2,31}$/, message: '3~32 位、字母开头，仅含字母/数字/下划线', trigger: 'blur' }
    ]
    base.password = [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, message: '8~32 位，且同时包含字母和数字', trigger: 'blur' }
    ]
    base.confirmPassword = [
      { required: true, message: '请再次输入密码', trigger: 'blur' },
      {
        validator: (rule, value, callback) =>
          value === form.password ? callback() : callback(new Error('两次输入的密码不一致')),
        trigger: 'blur'
      }
    ]
  }
  return base
})

function switchToRegister() {
  mode.value = 'register'
  form.username = ''
  form.password = ''
  form.confirmPassword = ''
  form.nickname = ''
  formRef.value?.clearValidate()
}

function backToLogin() {
  mode.value = 'login'
  form.password = ''
  form.confirmPassword = ''
  formRef.value?.clearValidate()
}

async function handleRegister() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await userApi.register({
      username: form.username,
      password: form.password,
      nickname: form.nickname || undefined
    })
    ElMessage.success('注册成功，请使用新账号登录')
    form.password = ''
    form.confirmPassword = ''
    form.nickname = ''
    mode.value = 'login'
  } catch (e) {
    /* 错误已由 api 层提示 */
  } finally {
    loading.value = false
  }
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await userStore.login({ username: form.username, password: form.password })
    ElMessage.success('登录成功')
    router.push(route.query.redirect || '/chat')
  } catch (e) {
    /* 错误已由 api 层提示 */
  } finally {
    loading.value = false
  }
}

function fill(acc) {
  form.username = acc.username
  form.password = acc.password
}

const demoAccounts = [
  { username: 'admin', password: 'admin123', desc: '超级管理员' },
  { username: 'editor', password: 'editor123', desc: '知识库编辑' },
  { username: 'viewer', password: 'viewer123', desc: '只读访客' }
]
</script>

<style scoped>
.login {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: linear-gradient(135deg, #27408f 0%, #3f6ae1 52%, #6b8ff0 100%);
  overflow: hidden;
}

/* 装饰圆环（白色低透明度，蓝白层次） */
.bg-blob {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  pointer-events: none;
}
.blob-a {
  width: 560px;
  height: 560px;
  left: -180px;
  top: -180px;
  background: rgba(255, 255, 255, 0.05);
}
.blob-b {
  width: 440px;
  height: 440px;
  right: -140px;
  bottom: -160px;
  background: rgba(255, 255, 255, 0.04);
}

.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 400px;
  padding: 36px 36px 30px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(15, 34, 84, 0.35);
}

/* 品牌区 */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 26px;
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: var(--brand);
  color: #fff;
  border-radius: 10px;
  box-shadow: 0 3px 8px rgba(63, 106, 225, 0.32);
}
.brand-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text);
}

.form-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--c-text);
}
.form-sub {
  margin: 6px 0 22px;
  font-size: 13.5px;
  color: var(--c-text-3);
}

.form-extra {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -6px 0 18px;
  font-size: 13px;
}

.link {
  color: var(--brand);
  cursor: pointer;
}

.submit {
  width: 100%;
  height: 42px;
  font-size: 15px;
}

.register-hint {
  margin-top: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-3);
}

.foot-note {
  position: fixed;
  bottom: 16px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.78);
}
.foot-note .link,
.foot-note .demo-fill {
  color: #fff;
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}
.foot-note .dot {
  margin: 0 8px;
  opacity: 0.55;
}
</style>
