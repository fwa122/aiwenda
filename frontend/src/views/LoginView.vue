<template>
  <div class="login">
    <!-- 背景装饰（暖纸书卷） -->
    <div class="paper-noise" aria-hidden="true"></div>
    <div class="bg-blob blob-a" aria-hidden="true"></div>
    <div class="bg-blob blob-b" aria-hidden="true"></div>
    <div class="deco-note" aria-hidden="true">今天也要<br />好好读书 ✎</div>
    <div class="deco-page" aria-hidden="true">翻开第 42 页</div>

    <div class="login-card">
      <span class="tape" aria-hidden="true"></span>
      <!-- 品牌区 -->
      <div class="brand">
        <div class="brand-left">
          <div class="logo"><el-icon :size="18"><ChatDotRound /></el-icon></div>
          <span class="brand-name">智核智库 · AI 共读计划</span>
        </div>
        <a class="back-home" title="返回官网首页" @click="router.push({ name: 'landing' })">← 回到官网</a>
      </div>

      <h2 class="form-title">
        <template v-if="mode === 'login'">欢迎<em>回来</em></template>
        <template v-else-if="mode === 'register'">创建<em>账号</em></template>
        <template v-else>找回<em>密码</em></template>
      </h2>
      <p class="form-sub">
        {{
          mode === 'login'
            ? '登录以继续使用企业知识库问答'
            : mode === 'register'
              ? '注册需邮箱验证码验证，注册后返回登录页登录'
              : '通过账号绑定邮箱验证码重置密码，无需原密码'
        }}
      </p>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleSubmit()">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" :prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item v-if="mode !== 'forgot'" prop="password">
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

        <!-- 注册 / 忘记密码共用：邮箱 + 图形验证码 + 邮箱验证码 -->
        <template v-if="mode !== 'login'">
          <el-form-item prop="email">
            <el-input v-model="form.email" placeholder="绑定邮箱（用于接收验证码）" :prefix-icon="Message" clearable />
          </el-form-item>
          <el-form-item prop="captchaCode">
            <div class="captcha-row">
              <el-input v-model="form.captchaCode" placeholder="图形验证码" maxlength="4" clearable />
              <img
                v-if="captchaSvg"
                class="captcha-img"
                :src="`data:image/svg+xml;utf8,${encodeURIComponent(captchaSvg)}`"
                title="看不清？点击刷新"
                alt="图形验证码"
                @click="refreshCaptcha"
              />
              <el-button v-else class="captcha-img captcha-btn" link @click="refreshCaptcha">获取</el-button>
            </div>
          </el-form-item>
          <el-form-item prop="emailCode">
            <div class="code-row">
              <el-input v-model="form.emailCode" placeholder="邮箱验证码（6 位）" maxlength="6" clearable />
              <el-button class="send-btn" :disabled="cooldown > 0 || sendingCode" @click="handleSendCode">
                {{ sendingCode ? '发送中…' : cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码' }}
              </el-button>
            </div>
          </el-form-item>
        </template>

        <!-- 忘记密码：新密码两连 -->
        <template v-if="mode === 'forgot'">
          <el-form-item prop="newPassword">
            <el-input v-model="form.newPassword" type="password" placeholder="新密码（8~32 位，字母+数字）" :prefix-icon="Lock" show-password clearable />
          </el-form-item>
          <el-form-item prop="confirmPassword">
            <el-input v-model="form.confirmPassword" type="password" placeholder="请再次输入新密码" :prefix-icon="Lock" show-password clearable />
          </el-form-item>
        </template>

        <div class="form-extra">
          <el-checkbox v-if="mode === 'login'" v-model="form.remember">记住我</el-checkbox>
          <a v-if="mode === 'login'" class="link" @click="switchToForgot">忘记密码？</a>
          <a v-else class="link" @click="backToLogin">已有账号？返回登录</a>
        </div>

        <el-button v-if="mode !== 'forgot'" type="primary" class="submit" :loading="loading" @click="handleSubmit()">
          {{ mode === 'login' ? '登录' : '注册' }}
        </el-button>
        <el-button v-else type="primary" class="submit" :loading="loading" @click="handleResetPassword">
          重置密码
        </el-button>
      </el-form>

      <div v-if="mode === 'login'" class="register-hint">
        还没有账号？<a class="link" @click="switchToRegister">立即注册</a>
      </div>
    </div>

    <p class="foot-note">
      <template v-if="mode !== 'login'"><a class="link" @click="backToLogin">返回登录</a><span class="dot">·</span></template>
      Vue 3 + Node.js + Python · 企业私有化知识库解决方案
    </p>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, Message } from '@element-plus/icons-vue'
import { useUserStore } from '@/store'
import * as userApi from '@/api/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref(null)
const loading = ref(false)
const mode = ref('login') // login | register | forgot

const form = reactive({
  username: 'admin',
  password: 'admin123',
  confirmPassword: '',
  nickname: '',
  email: '',
  captchaCode: '',
  emailCode: '',
  newPassword: '',
  remember: true
})

/* ---------------- 图形验证码 + 邮箱验证码（注册/忘记密码共用） ---------------- */
const captchaSvg = ref('')
let captchaId = ''
const sendingCode = ref(false)
const cooldown = ref(0)
let cooldownTimer = null

async function refreshCaptcha() {
  try {
    const data = await userApi.getCaptcha()
    captchaId = data.id
    captchaSvg.value = data.svg || ''
    form.captchaCode = ''
  } catch {
    captchaSvg.value = ''
  }
}

async function handleSendCode() {
  if (!form.email) return ElMessage.warning('请先填写邮箱')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return ElMessage.warning('邮箱格式不正确')
  if (!form.captchaCode) {
    ElMessage.warning('请先输入图形验证码')
    return
  }
  sendingCode.value = true
  try {
    await userApi.sendEmailCode({
      scene: mode.value === 'forgot' ? 'reset' : 'register',
      email: form.email,
      captchaId,
      captchaCode: form.captchaCode
    })
    ElMessage.success('验证码已发送，请查收邮箱（含垃圾箱）')
    cooldown.value = 60
    cooldownTimer = setInterval(() => {
      cooldown.value -= 1
      if (cooldown.value <= 0) clearInterval(cooldownTimer)
    }, 1000)
  } catch {
    // 图形码/邮箱占用/SMTP 未配置等错误已由 api 层提示；换一张图形码便于重试
    refreshCaptcha()
  } finally {
    sendingCode.value = false
  }
}

const rules = computed(() => {
  const base = {
    username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
    password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
  }
  if (mode.value !== 'login') {
    base.email = [
      { required: true, message: '请输入邮箱', trigger: 'blur' },
      { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
    ]
    base.captchaCode = [{ required: true, message: '请输入图形验证码', trigger: 'blur' }]
    base.emailCode = [
      { required: true, message: '请输入邮箱验证码', trigger: 'blur' },
      { pattern: /^\d{6}$/, message: '验证码为 6 位数字', trigger: 'blur' }
    ]
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
  if (mode.value === 'forgot') {
    base.newPassword = [
      { required: true, message: '请输入新密码', trigger: 'blur' },
      { pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, message: '8~32 位，且同时包含字母和数字', trigger: 'blur' }
    ]
    base.confirmPassword = [
      { required: true, message: '请再次输入新密码', trigger: 'blur' },
      {
        validator: (rule, value, callback) =>
          value === form.newPassword ? callback() : callback(new Error('两次输入的密码不一致')),
        trigger: 'blur'
      }
    ]
  }
  return base
})

function resetForm(...keep) {
  const defaults = {
    username: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    email: '',
    captchaCode: '',
    emailCode: '',
    newPassword: ''
  }
  for (const k of keep) defaults[k] = form[k]
  Object.assign(form, defaults)
  formRef.value?.clearValidate()
}

function switchToRegister() {
  mode.value = 'register'
  resetForm('username')
  refreshCaptcha()
}

function switchToForgot() {
  mode.value = 'forgot'
  resetForm('username')
  refreshCaptcha()
}

function backToLogin() {
  mode.value = 'login'
  resetForm('username', 'password')
}

function handleSubmit() {
  if (mode.value === 'login') return handleLogin()
  if (mode.value === 'register') return handleRegister()
  return handleResetPassword()
}

async function handleRegister() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const res = await userApi.register({
      username: form.username,
      password: form.password,
      nickname: form.nickname || undefined,
      email: form.email,
      emailCode: form.emailCode
    })
    // 注册即登录（v0.9.56）：服务端返回令牌对，直接进系统，免去二次登录
    if (res?.token) {
      userStore.token = res.token
      userStore.profile = res.user
      ElMessage.success('注册成功，欢迎加入共读')
      router.push(route.query.redirect || '/chat')
    } else {
      ElMessage.success('注册成功，请使用新账号登录')
      backToLogin()
    }
  } catch (e) {
    /* 错误已由 api 层提示；验证码一次性消费，换新码便于重试 */
    refreshCaptcha()
  } finally {
    loading.value = false
  }
}

async function handleResetPassword() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await userApi.resetPassword({
      email: form.email,
      code: form.emailCode,
      newPassword: form.newPassword
    })
    ElMessage.success('密码已重置，请使用新密码登录（已登录设备将全部下线）')
    backToLogin()
  } catch {
    refreshCaptcha()
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

</script>

<style scoped>
/* ===== 暖纸书卷风（与官网 LandingView 同一设计语言）===== */
.login {
  --paper: #faf6ee;
  --ink: #33302a;
  --accent: #ff6a3d;
  --accent-soft: #ff8a63;
  --hl: #ffe58a;
  --line: #e5dcc8;
  --dim: #8a8272;
  --serif: 'Songti SC', 'Noto Serif SC', 'STSong', 'SimSun', serif;
  --mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--paper);
  color: var(--ink);
  overflow: hidden;
}

/* 纸张颗粒 */
.paper-noise {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.6;
  background-image: radial-gradient(rgba(120, 100, 70, 0.05) 1px, transparent 1px),
    radial-gradient(rgba(120, 100, 70, 0.035) 1px, transparent 1px);
  background-size: 26px 26px, 34px 34px;
  background-position: 0 0, 13px 17px;
}

/* 淡棕虚线装饰环 */
.bg-blob {
  position: absolute;
  border: 1.5px dashed rgba(150, 130, 95, 0.22);
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
}
.blob-a {
  width: 560px;
  height: 560px;
  left: -180px;
  top: -180px;
  background: rgba(255, 229, 138, 0.14);
}
.blob-b {
  width: 440px;
  height: 440px;
  right: -140px;
  bottom: -160px;
  background: rgba(255, 106, 61, 0.06);
}

/* 角落装饰便签与纸页 */
.deco-note {
  position: absolute;
  top: 44px;
  right: 7%;
  z-index: 0;
  padding: 14px 18px;
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.8;
  color: #6d6246;
  background: #fff8d6;
  border-radius: 2px 10px 2px 2px;
  box-shadow: 0 8px 20px rgba(120, 95, 60, 0.16);
  transform: rotate(5deg);
  pointer-events: none;
}
.deco-note::before {
  content: '';
  position: absolute;
  top: -7px;
  left: 50%;
  width: 44px;
  height: 14px;
  transform: translateX(-50%) rotate(-2deg);
  background: rgba(255, 179, 130, 0.5);
  border-radius: 2px;
}
.deco-page {
  position: absolute;
  bottom: 64px;
  left: 6%;
  z-index: 0;
  padding: 10px 16px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--dim);
  background: #fffdf7;
  border: 1px solid var(--line);
  border-radius: 4px 12px 12px 4px;
  box-shadow: 0 6px 16px rgba(120, 95, 60, 0.12);
  transform: rotate(-3deg);
  pointer-events: none;
}
.deco-page::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: rgba(255, 106, 61, 0.4);
}
@media (max-width: 860px) {
  .deco-note,
  .deco-page {
    display: none;
  }
}

/* 白纸卡片 + 顶部胶带 */
.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 404px;
  padding: 38px 36px 30px;
  background: #fffdf7;
  border: 1.5px dashed var(--line);
  border-radius: 18px;
  box-shadow: 0 18px 44px rgba(120, 95, 60, 0.18);
}
.tape {
  position: absolute;
  top: -12px;
  left: 50%;
  width: 116px;
  height: 26px;
  transform: translateX(-50%) rotate(-2deg);
  background: rgba(255, 200, 160, 0.55);
  border-left: 1px dashed rgba(150, 130, 95, 0.25);
  border-right: 1px dashed rgba(150, 130, 95, 0.25);
  border-radius: 2px;
}

/* 品牌区 */
.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 24px;
}
.brand-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.back-home {
  font-size: 12.5px;
  color: var(--c-text-3, #8a8070);
  cursor: pointer;
  transition: color 0.15s;
}
.back-home:hover {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: var(--accent);
  color: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 10px rgba(255, 106, 61, 0.32);
}
.brand-name {
  font-family: var(--serif);
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--ink);
}

.form-title {
  font-family: var(--serif);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--ink);
}
.form-title em {
  font-style: normal;
  background: linear-gradient(transparent 58%, var(--hl) 58%, var(--hl) 92%, transparent 92%);
}
.form-sub {
  margin: 8px 0 22px;
  font-size: 13.5px;
  color: var(--dim);
}

/* Element Plus 融合：圆角 + 橘色主色 */
.login :deep(.el-input__wrapper) {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.75);
}
.login :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1.5px var(--accent) inset !important;
}
.login :deep(.el-button--primary) {
  --el-button-bg-color: var(--accent);
  --el-button-border-color: var(--accent);
  --el-button-hover-bg-color: var(--accent-soft);
  --el-button-hover-border-color: var(--accent-soft);
  --el-button-active-bg-color: #f55a2b;
  --el-button-active-border-color: #f55a2b;
}
.login :deep(.el-checkbox__input.is-checked .el-checkbox__inner),
.login :deep(.el-checkbox__input.is-indeterminate .el-checkbox__inner) {
  background-color: var(--accent);
  border-color: var(--accent);
}
.login :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
  color: var(--ink);
}

/* 图形验证码 / 邮箱验证码行 */
.captcha-row,
.code-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.captcha-img {
  flex: 0 0 104px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--line);
}

.captcha-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.send-btn {
  flex: 0 0 118px;
  border-radius: 10px;
}
.send-btn:not(.is-disabled) {
  color: var(--accent);
  border-color: rgba(255, 106, 61, 0.55);
}

.form-extra {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -6px 0 18px;
  font-size: 13px;
}

.link {
  color: var(--accent);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* 主按钮：橘色胶囊 */
.submit {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 4px;
  border-radius: 999px;
  box-shadow: 0 8px 20px rgba(255, 106, 61, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}
.submit:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 26px rgba(255, 106, 61, 0.38);
}

.register-hint {
  margin-top: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--dim);
}

.foot-note {
  position: relative;
  z-index: 1;
  margin-top: 22px;
  text-align: center;
  font-size: 12.5px;
  color: var(--dim);
}
.foot-note .link {
  color: var(--accent);
}
.foot-note .dot {
  margin: 0 8px;
  opacity: 0.55;
}
</style>
