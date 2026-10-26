<template>
  <div class="land">
    <canvas ref="bgCanvas" class="bg-canvas" aria-hidden="true"></canvas>
    <div class="paper-noise" aria-hidden="true"></div>

    <!-- 导航 -->
    <header class="nav" :class="{ solid: scrolled }">
      <div class="nav-in">
        <a class="logo" href="#top" @click.prevent="scrollTo('top')">
          <svg viewBox="0 0 24 24" class="logo-book" fill="none">
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Z" stroke="currentColor" stroke-width="1.8"/>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="1.8"/>
            <path d="M9 7h7M9 10.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="logo-name">智核智库</span>
          <span class="logo-sub">AI 共读计划</span>
        </a>
        <nav class="nav-links">
          <a href="#buddy" @click.prevent="scrollTo('buddy')">问书搭子</a>
          <a href="#creed" @click.prevent="scrollTo('creed')">共读宣言</a>
          <a href="#skills" @click.prevent="scrollTo('skills')">它会的事</a>
          <a href="#road" @click.prevent="scrollTo('road')">共读轨迹</a>
        </nav>
        <button class="nav-btn" @click="enterSystem">{{ hasToken ? '回到书桌' : '登录 / 注册' }} ↗</button>
      </div>
    </header>

    <!-- Hero：左文案 + 右翻页书 -->
    <section class="hero" id="top">
      <div class="hero-left">
        <p class="eyebrow">READING, TOGETHER <i>·</i> 阅读陪伴计划</p>
        <h1 class="hero-h1">
          <span class="w" style="--d:.05s">把厚书</span>
          <span class="w accent" style="--d:.15s">读薄</span><span class="w" style="--d:.25s">，</span><br />
          <span class="w" style="--d:.35s">把问</span>
          <span class="w accent" style="--d:.45s">读透</span>
        </h1>
        <p class="hero-sub">
          智核智库是你书桌旁的<b>共读搭子</b>：替你啃完 12 万页文档，
          划好重点、记牢出处，然后等你随口一问。
        </p>
        <div class="hero-cta">
          <button class="btn main" @click="enterSystem">{{ hasToken ? '回到书桌' : '登录 / 注册' }} ↗</button>
          <a class="btn ghost" href="#buddy" @click.prevent="scrollTo('buddy')">先聊聊 ↓</a>
        </div>
        <p class="type-line mono">»&nbsp;<span>{{ typeText }}</span><span class="type-caret"></span></p>
        <p class="hero-note">
          <span class="stamp">不背锅宣言</span>
          它不替你读书——它让你更爱读。
        </p>
      </div>

      <div class="hero-right">
        <!-- 可点击翻页的 3D 书（放大版：页缘堆叠 + 弯曲翻页 + 双面笔记 + 纸屑） -->
        <div class="book-wrap" @click="flipBook" title="点一点，翻一页">
          <div class="book" :class="{ flipping: flipping }">
            <span class="book-shadow"></span>
            <span class="stack-left" :style="{ width: stackLeftW }"></span>
            <span class="stack-right" :style="{ width: stackRightW }"></span>
            <div class="book-cover">
              <span class="cover-mark">NOVA</span>
              <b>共读笔记</b>
              <small>智核智库 · 第 3 卷</small>
            </div>
            <div class="page under"></div>
            <div class="page leaf" v-for="(p, i) in bookPages" :key="i"
                 :class="{ turned: flippedCount > i }"
                 :style="{ zIndex: flippedCount > i ? (justFlipped === i ? 60 : 10 + i) : 30 + (bookPages.length - i) }">
              <div class="page-front">
                <p class="pg-ch">{{ p }}</p>
                <span class="pg-no">{{ i + 1 }}</span>
              </div>
              <div class="page-back" :class="'b' + (i % 3)">
                <span class="bk-title"></span>
                <span class="bk-line" v-for="k in 6" :key="k" :class="'lw' + ((k + i) % 4)"></span>
                <span class="bk-mark"></span>
                <span class="bk-note" :class="'b' + (i % 3)">好句！</span>
                <span class="pg-no bk-no">{{ i * 2 + 2 }}</span>
              </div>
            </div>
          </div>
          <span class="confetti" v-for="c in confetti" :key="c.id" :style="c.style"></span>
          <span class="book-hint">点一点，翻一页 ↻</span>
        </div>
        <span class="float-tag t1">📌 划重点</span>
        <span class="float-tag t2">☕ 随口一问</span>
        <span class="float-tag t3">🔖 有据可查</span>
      </div>
    </section>

    <!-- 书单跑马灯 -->
    <div class="ticker" aria-hidden="true" @mouseenter="tickerPause = true" @mouseleave="tickerPause = false"
         @mouseover="tickerOver($event)" @mouseout="tickerOut($event)">
      <div class="ticker-track" :class="{ paused: tickerPause }">
        <span v-for="t in [...tickerBooks, ...tickerBooks]" :key="t + Math.random()">
          <i>《</i>{{ t }}<i>》</i>
        </span>
      </div>
    </div>

    <!-- 01 问书搭子：气泡聊天演示 -->
    <section class="buddy" id="buddy">
      <div class="sec-head">
        <span class="no">01</span>
        <h2>问书搭子<span class="dot-accent">。</span></h2>
        <p class="sec-sub">挑个问题，看它翻书、找页、举手回答。每句都带书页出处，从不瞎编。</p>
      </div>

      <div class="chat">
        <div class="chat-qs">
          <button v-for="(q, i) in demoQuestions" :key="i" class="q-chip"
                  :class="{ active: qi === i }" :disabled="running"
                  @click="runDemo(i)">{{ q.text }}</button>
        </div>
        <div class="chat-flow" ref="chatFlowEl">
          <div class="bubble user" :class="{ show: qi >= 0 && step >= 0 }">
            <span class="who">你</span>
            <p v-if="qi >= 0">{{ demoQuestions[qi].text }}</p>
          </div>
          <div class="bubble ai" :class="{ show: step >= 1 }">
            <span class="who">搭子</span>
            <p class="mono mini" v-if="step === 1">（正在翻书 📖 索引第 1,024 页…）</p>
            <template v-if="step >= 2">
              <p v-if="answer" class="ai-text">{{ answer }}<span class="caret" v-if="running"></span></p>
              <p v-if="done" class="cite-note">📖 出处：{{ demoQuestions[qi]?.cite }}</p>
            </template>
          </div>
        </div>
      </div>
    </section>

    <!-- 02 共读宣言：荧光笔划亮 -->
    <section class="creed" id="creed" ref="creedEl">
      <div class="sec-head">
        <span class="no">02</span>
        <h2>共读宣言<span class="dot-accent">。</span></h2>
      </div>
      <p class="creed-text">
        <span v-for="(seg, si) in creedChars" :key="si" class="seg"
              @pointermove="segMove($event, si)">
          <span v-for="(ch, ci) in seg" :key="ci" class="ch"
                :class="{ lit: chLit(si, ci) }">{{ ch }}</span>
        </span>
      </p>
      <p class="creed-tip mono">✎ 用鼠标划过下面的字，试试这支荧光笔</p>
      <p class="creed-sign">—— 智核智库 · 写给每一位爱读书的人</p>
    </section>

    <!-- 03 它会的事：便签贴纸卡 -->
    <section class="skills" id="skills">
      <div class="sec-head">
        <span class="no">03</span>
        <h2>它会这些事<span class="dot-accent">。</span></h2>
        <p class="sec-sub">像便利贴一样，一条条贴在你书桌上。</p>
      </div>
      <div class="notes">
        <div class="note" v-for="(n, i) in notes" :key="n.t"
             :class="{ dragging: dragIdx === i }"
             :style="{ '--pc': n.color, transform: noteTransform(i) }"
             @pointerdown="noteDown($event, i)"
             @mousedown="noteDown($event, i)">
          <span class="pin"></span>
          <b>{{ n.t }}</b>
          <p>{{ n.d }}</p>
        </div>
      </div>
    </section>

    <!-- 04 共读轨迹 -->
    <section class="road" id="road">
      <div class="sec-head">
        <span class="no">04</span>
        <h2>共读轨迹<span class="dot-accent">。</span></h2>
      </div>
      <div class="miles">
        <div class="mile" v-for="(m, i) in milestones" :key="m.t" :class="{ done: i <= 2 }">
          <time>{{ m.t }}</time>
          <b>{{ m.title }}</b>
          <p>{{ m.desc }}</p>
          <span class="badge" v-if="i <= 2">已读 ✓</span>
        </div>
      </div>
      <div class="stats">
        <div v-for="s in stats" :key="s.label" class="stat">
          <span class="v">{{ s.cur }}<i>{{ s.suffix }}</i></span>
          <span class="l">{{ s.label }}</span>
        </div>
      </div>
    </section>

    <!-- 底部 -->
    <footer class="footer" id="contact">
      <div class="f-in">
        <div class="f-brand">
          <svg viewBox="0 0 24 24" class="f-book" fill="none">
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Z" stroke="currentColor" stroke-width="1.8"/>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          <div>
            <b>智核智库 · AI 共读计划</b>
            <p>替你啃完厚书，陪你把问读透。</p>
          </div>
        </div>
        <button class="btn main small" @click="enterSystem">{{ hasToken ? '回到书桌 ↗' : '登录 / 注册 ↗' }}</button>
      </div>
      <p class="f-copy">© 2026 智核智库 · 把厚书读薄，把问读透</p>
      <p class="f-icp"><span class="icp-badge">ICP 备案审核中</span> 备案通过后展示备案号</p>
    </footer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const hasToken = !!localStorage.getItem('kb_token')

function enterSystem() {
  router.push(hasToken ? { name: 'chat' } : { name: 'login' })
}
function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ================= 翻页书（物理增强 + 纸屑） ================= */
const bookPages = [
  '「检索增强」：先去书里找答案，再开口说话。',
  '「混合精排」：两条路一起找，挑最相关的那几页。',
  '「知识溯源」：每句回答，都夹着一张书签。',
  '「多模态解析」：扫描件、图表、手写批注，都读得懂。',
  '「组织记忆」：全组的书，汇成一座随问随答的图书馆。',
  '「持续学习」：你读过的每一页，它都记得。',
]
const flippedCount = ref(0)
const flipping = ref(false)
const justFlipped = ref(-1)
let autoTimer = null

const stackLeftW = computed(() => flippedCount.value * 3 + 'px')
const stackRightW = computed(() => (bookPages.length - flippedCount.value) * 2.4 + 3 + 'px')

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* 纸屑粒子（点击翻页时迸出） */
const confetti = reactive([])
let cfId = 0
function spawnConfetti() {
  if (reducedMotion) return
  const colors = ['#ff6a3d', '#ffd166', '#a8e6cf', '#ffccc7', '#c7ceff']
  for (let k = 0; k < 7; k++) {
    const id = cfId++
    const st = {
      '--dx': Math.round(Math.random() * 200 - 40) + 'px',
      '--dy': Math.round(-50 - Math.random() * 130) + 'px',
      '--rr': Math.round(Math.random() * 520 - 260) + 'deg',
      '--cc': colors[k % colors.length],
      left: 54 + Math.random() * 22 + '%',
      top: 26 + Math.random() * 18 + '%',
      width: 7 + Math.random() * 6 + 'px',
      height: 10 + Math.random() * 7 + 'px',
      animationDelay: k * 40 + 'ms',
    }
    confetti.push({ id, style: st })
    const rm = setTimeout(() => {
      const idx = confetti.findIndex((c) => c.id === id)
      if (idx >= 0) confetti.splice(idx, 1)
    }, 1500 + k * 40)
    timers.push(rm)
  }
}

function flipBook() {
  if (flipping.value) return
  if (flippedCount.value >= bookPages.length) {
    // 合上书重开：瞬时重置 + 一页首翻的缓动
    flipping.value = true
    flippedCount.value = 0
    justFlipped.value = -1
    setTimeout(() => { flipping.value = false }, 60)
    return
  }
  justFlipped.value = flippedCount.value
  flippedCount.value++
  spawnConfetti()
  timers.push(setTimeout(() => { justFlipped.value = -1 }, 1150))
}
function startAutoFlip() {
  autoTimer = setInterval(() => {
    if (document.hidden) return
    flipBook()
  }, 3200)
}

/* ================= 问书搭子演示 ================= */
const demoQuestions = [
  {
    text: '公司的退货政策是什么？',
    cite: '《售后服务手册》第 12 页 §4.2',
    answer: '签收后 7 天内可无理由退货（定制商品除外），保留原包装和吊牌，质检通过后 3 个工作日原路退款；7–30 天内的质量问题走换货流程。',
  },
  {
    text: 'Q3 研发投入占比多少？',
    cite: '《Q3 财务简报》第 4 页 表 2-1',
    answer: 'Q3 研发投入 4,180 万元，占营收 2.31 亿元的 18.1%，环比上升 1.4 个百分点——主要花在检索引擎和多模态解析两条产品线上。',
  },
  {
    text: '新人入职第一周读什么？',
    cite: '《新人手册》§2 · 《产品白皮书》第 3 章',
    answer: '先读《新人手册》§2 的三天清单，再啃《产品白皮书》第 3 章；配套的检索测试集在知识库里能直接搜到，读完可以自测。',
  },
  {
    text: '扫描版的合同能搜吗？',
    cite: '《采购合同 2024-077》第 9 页（扫描件）',
    answer: '可以。扫描件、图表、手写批注都会先做 OCR 解析再入库——这份合同的付款条款在第 9 页，搜「验收标准」也能直接命中。',
  },
  {
    text: '这些资料谁都能看吗？',
    cite: '《知识库使用说明》§1.3 权限',
    answer: '看得到就能读，改不了。谁能上传、谁能管理，由书架主人说了算，每次操作都留痕——你的资料既开放又安全。',
  },
  {
    text: '重要的答案怎么留下来？',
    cite: '《使用技巧》§4 共读笔记',
    answer: '回答右上角一键收藏，进你的共读笔记；好句子还能高亮标记，下次从收藏夹一秒回翻，不用再问一遍。',
  },
]
const qi = ref(-1)
const step = ref(-1)
const answer = ref('')
const done = ref(false)
const running = ref(false)
let timers = []
function clearTimers() { timers.forEach(clearTimeout); timers = [] }
function runDemo(i) {
  clearTimers()
  qi.value = i; step.value = 0; answer.value = ''; done.value = false; running.value = true
  const q = demoQuestions[i]
  timers.push(setTimeout(() => { step.value = 1 }, 350))   // 翻书中
  timers.push(setTimeout(() => { step.value = 2 }, 1400))  // 开始回答
  q.answer.split('').forEach((_, k) => {
    timers.push(setTimeout(() => { answer.value = q.answer.slice(0, k + 1) }, 1500 + k * 26))
  })
  timers.push(setTimeout(() => { done.value = true; running.value = false }, 1500 + q.answer.length * 26 + 150))
}

/* ================= 荧光笔逐字划亮（滚动 + 鼠标双驱动） ================= */
const creedSegs = [
  '读书最难的不是「读」，是「记得住、找得到、问得出」。',
  '所以这家伙住进了书桌旁：替你翻完每一页，',
  '划好每一处重点，把出处夹得整整齐齐。',
  '而你，只需要负责惊呼「原来如此」。',
  '我们不替你读书——我们让你更爱读。',
]
const creedChars = creedSegs.map((s) => s.split(''))
const segStarts = []
let acc = 0
for (const s of creedSegs) { segStarts.push(acc); acc += s.length }
const totalChars = acc
const litCount = ref(0)
const creedEl = ref(null)

function chLit(si, ci) {
  return segStarts[si] + ci < litCount.value
}
function chHover(si, ci) {
  const idx = segStarts[si] + ci + 1
  if (idx > litCount.value) litCount.value = idx
}
/* 段内 pointermove：点亮到鼠标划过的最后一个字符（快速划动不漏字） */
function segMove(e, si) {
  const els = e.currentTarget.children
  let hit = -1
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect()
    if (e.clientX >= r.left - 6) hit = i
    else break
  }
  if (hit >= 0) chHover(si, hit)
}

function watchCreed() {
  const onScroll = () => {
    if (!creedEl.value) return
    const r = creedEl.value.getBoundingClientRect()
    const vh = window.innerHeight
    const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.3)))
    // 滚动驱动与鼠标驱动取最大值：划亮只进不退，像真的荧光笔
    const byScroll = Math.floor(totalChars * p)
    if (byScroll > litCount.value) litCount.value = byScroll
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

/* ================= 杂项数据 ================= */
const scrolled = ref(false)
function onScroll() { scrolled.value = window.scrollY > 16 }
const tickerPause = ref(false)
/* mouseover/mouseout 兜底（兼容合成事件）：relatedTarget 判定只在真正进出容器时切换 */
function tickerOver(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) tickerPause.value = true
}
function tickerOut(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) tickerPause.value = false
}
const tickerBooks = ['检索增强之道', '向量检索入门', '精排的艺术', '一本书读懂 RAG', '知识溯源笔记', '与 AI 共读', '提示词工作坊', '组织记忆简史']
const notes = reactive([
  { t: '替你啃完厚书', d: 'PDF / Word / Excel / 扫描件全都吃下，OCR 免费解析，12 万页不过夜。', rot: -1.6, color: '#ffd166', dx: 0, dy: 0 },
  { t: '随口一问', d: '意思相近的问法也能命中——它认的是语义，不是关键词。', rot: 1.2, color: '#a8e6cf', dx: 0, dy: 0 },
  { t: '句句带出处', d: '回答自动夹书签，点开就是原文页码，从不瞎编。', rot: -1.2, color: '#ffccc7', dx: 0, dy: 0 },
  { t: '书桌权限', d: '谁能看、谁能传，书架主人说了算；操作全程留痕。', rot: 1.6, color: '#c7ceff', dx: 0, dy: 0 },
  { t: '共读笔记', d: '收藏好答案，建自己的笔记本，随时回翻。', rot: -0.8, color: '#ffd166', dx: 0, dy: 0 },
  { t: '越问越懂你', d: '反馈与纠正会被记住，同一个书架，越用越顺手。', rot: 0.9, color: '#a8e6cf', dx: 0, dy: 0 },
])

/* 便签拖拽（pointer 事件为主 + mouse 事件兜底，拖动时摆正+拿起感，松手停在原地） */
const dragIdx = ref(-1)
let noteDragging = false // 防止 pointer 与 mouse 双路径重复触发
function noteTransform(i) {
  const n = notes[i]
  if (!n.dx && !n.dy) return undefined
  return `translate(${n.dx}px, ${n.dy}px)`
}
function noteDown(e, i) {
  if (noteDragging) return
  if (e.button !== undefined && e.button !== 0) return
  noteDragging = true
  const n = notes[i]
  n._sx = e.clientX; n._sy = e.clientY
  n._ox = n.dx; n._oy = n.dy
  n._moved = false
  dragIdx.value = i
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* mouse 事件无 pointerId */ }
  window.addEventListener('pointermove', noteMove)
  window.addEventListener('pointerup', noteUp)
  window.addEventListener('pointercancel', noteUp)
  window.addEventListener('mousemove', noteMove)
  window.addEventListener('mouseup', noteUp)
}
function noteMove(e) {
  if (!noteDragging) return
  const n = notes[dragIdx.value]
  if (!n) return
  const dx = e.clientX - n._sx, dy = e.clientY - n._sy
  if (!n._moved && Math.abs(dx) + Math.abs(dy) < 6) return
  n._moved = true
  n.dx = n._ox + dx
  n.dy = n._oy + dy
}
function noteUp() {
  if (!noteDragging) return
  noteDragging = false
  window.removeEventListener('pointermove', noteMove)
  window.removeEventListener('pointerup', noteUp)
  window.removeEventListener('pointercancel', noteUp)
  window.removeEventListener('mousemove', noteMove)
  window.removeEventListener('mouseup', noteUp)
  dragIdx.value = -1
}

/* Hero 打字机轮播（轻松的书桌旁白） */
const typeLines = [
  '正在替你读：《售后服务手册》第 1,024 页……',
  '刚划完 38 处重点，夹好书签 12 张。',
  '有人问「退货政策」，它已经翻到那一页了。',
]
const typeText = ref('')
let typeTimer = null
function startType() {
  if (reducedMotion) { typeText.value = typeLines[0]; return }
  let li = 0, ci = 0, deleting = false
  const stepType = () => {
    const line = typeLines[li]
    if (!deleting) {
      ci++
      typeText.value = line.slice(0, ci)
      if (ci >= line.length) { deleting = true; typeTimer = setTimeout(stepType, 2000); return }
      typeTimer = setTimeout(stepType, 62 + Math.random() * 55)
    } else {
      ci -= 2
      if (ci <= 0) {
        ci = 0; deleting = false
        li = (li + 1) % typeLines.length
        typeText.value = ''
        typeTimer = setTimeout(stepType, 480)
        return
      }
      typeText.value = line.slice(0, ci)
      typeTimer = setTimeout(stepType, 26)
    }
  }
  stepType()
}

/* ================= 背景 Canvas：光尘 + 飘页 + 鼠标风场 + 点击墨涟漪 ================= */
const bgCanvas = ref(null)
const bgCleanups = []
function initBg() {
  const canvas = bgCanvas.value
  if (!canvas || reducedMotion) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const DPR = Math.min(window.devicePixelRatio || 1, 2)
  let W = window.innerWidth, H = window.innerHeight
  function resize() {
    W = window.innerWidth; H = window.innerHeight
    canvas.width = W * DPR; canvas.height = H * DPR
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  // 午后书房的光尘
  const dust = []
  for (let i = 0; i < 55; i++) {
    dust.push({
      x: Math.random() * W, y: Math.random() * H,
      r: 0.8 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.1,
      ph: Math.random() * Math.PI * 2,
      a: 0.16 + Math.random() * 0.3,
    })
  }
  // 偶尔飘落的纸页
  function newSheet(init) {
    return {
      x: Math.random() * W, y: init ? Math.random() * H : -30,
      w: 9 + Math.random() * 7, h: 12 + Math.random() * 9,
      vy: 0.25 + Math.random() * 0.4,
      ph: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.012,
      sway: 0.4 + Math.random() * 0.5,
    }
  }
  const sheets = []
  for (let i = 0; i < 9; i++) sheets.push(newSheet(true))
  const ripples = []
  const mouse = { x: -9999, y: -9999, vx: 0, vy: 0 }

  function onMove(e) {
    mouse.vx = e.clientX - mouse.x
    mouse.vy = e.clientY - mouse.y
    mouse.x = e.clientX; mouse.y = e.clientY
  }
  function onClick(e) {
    ripples.push({ x: e.clientX, y: e.clientY, r: 4, a: 0.38, w: 2.2, delay: 0 })
    ripples.push({ x: e.clientX, y: e.clientY, r: 1, a: 0.26, w: 1.4, delay: 9 })
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('click', onClick, { passive: true })

  function tick() {
    ctx.clearRect(0, 0, W, H)
    // 光尘：鼠标拂过像一阵风
    for (const d of dust) {
      d.ph += 0.008
      const dx = d.x - mouse.x, dy = d.y - mouse.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 130 && dist > 0.01) {
        const f = (1 - dist / 130) * 0.5
        d.x += mouse.vx * f * 0.14
        d.y += mouse.vy * f * 0.14
      }
      d.x += d.vx + Math.sin(d.ph) * 0.08
      d.y += d.vy
      if (d.x < -12) d.x = W + 12
      if (d.x > W + 12) d.x = -12
      if (d.y < -12) d.y = H + 12
      if (d.y > H + 12) d.y = -12
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(196, 148, 66, ' + d.a.toFixed(3) + ')'
      ctx.fill()
    }
    // 飘页：摇摆下落，鼠标能把它吹偏
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i]
      s.ph += 0.01
      s.y += s.vy
      s.rot += s.vr + Math.sin(s.ph) * 0.004
      const dx = s.x - mouse.x, dy = s.y - mouse.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 150 && dist > 0.01) {
        const f = (1 - dist / 150) * 0.7
        s.x += mouse.vx * f * 0.1
        s.vr += mouse.vx * f * 0.0005
      }
      if (s.y > H + 30) { sheets[i] = newSheet(false); continue }
      ctx.save()
      ctx.translate(s.x + Math.sin(s.ph) * s.sway, s.y)
      ctx.rotate(s.rot)
      ctx.beginPath()
      ctx.moveTo(-s.w / 2, -s.h / 2)
      ctx.lineTo(s.w / 2, -s.h / 2 + 1.5)
      ctx.lineTo(s.w / 2, s.h / 2)
      ctx.lineTo(-s.w / 2, s.h / 2 - 1.5)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 253, 247, 0.85)'
      ctx.strokeStyle = 'rgba(150, 130, 95, 0.4)'
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    // 点击墨涟漪：墨滴在纸上晕开
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i]
      if (rp.delay > 0) { rp.delay--; continue }
      rp.r += 3.1
      rp.a *= 0.952
      if (rp.a < 0.015) { ripples.splice(i, 1); continue }
      ctx.beginPath()
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(90, 74, 48, ' + rp.a.toFixed(3) + ')'
      ctx.lineWidth = rp.w
      ctx.stroke()
    }
    mouse.vx *= 0.82
    mouse.vy *= 0.82
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  bgCleanups.push(() => window.removeEventListener('resize', resize))
  bgCleanups.push(() => window.removeEventListener('pointermove', onMove))
  bgCleanups.push(() => window.removeEventListener('click', onClick))
}
const milestones = [
  { t: '2025 · Q3', title: '书架搭好了', desc: 'RAG 引擎跑通首批内部语料，第一问得到第一答' },
  { t: '2026 · Q1', title: '两条路找答案', desc: '向量 + 全文双路检索上线，精排模型开始划重点' },
  { t: '2026 · Q2', title: '扫描件也能读', desc: 'OCR / VLM 免费解析接入，老资料全部翻新' },
  { t: '2026 · Q4', title: '整座图书馆', desc: '跨书架关联检索，对话脉络连续追问' },
  { t: '2027 · H1', title: '帮你列书单', desc: '从回答问题到主动发现知识缺口' },
]
const stats = reactive([
  { target: 120000, cur: 0, suffix: '页', label: '已经替你读过' },
  { target: 98.2, cur: 0, suffix: '%', label: '找得准（命中@5）' },
  { target: 1.8, cur: 0, suffix: '秒', label: '举手就答' },
  { target: 0, cur: 0, suffix: '句', label: '瞎编的回答' },
])
function runStats() {
  stats.forEach((s) => {
    const t0 = performance.now(), dur = 1500
    const stepFn = (t) => {
      const p = Math.min(1, (t - t0) / dur)
      const v = s.target * (1 - Math.pow(1 - p, 3))
      s.cur = s.target % 1 === 0 ? Math.round(v) : v.toFixed(1)
      if (p < 1) requestAnimationFrame(stepFn)
    }
    requestAnimationFrame(stepFn)
  })
}

onMounted(() => {
  startAutoFlip()
  watchCreed()
  startType()
  initBg()
  window.addEventListener('scroll', onScroll, { passive: true })
  setTimeout(runStats, 500)
})
onBeforeUnmount(() => {
  clearTimers()
  clearInterval(autoTimer)
  clearTimeout(typeTimer)
  bgCleanups.forEach((fn) => fn())
  noteUp()
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
/* ============ 暖纸书卷 · 轻松共读 ============ */
.land {
  --paper: #faf6ee;
  --paper2: #f3ecdd;
  --ink: #33302a;
  --dim: #8a8272;
  --line: rgba(120, 105, 80, 0.18);
  --accent: #ff6a3d;
  --accent-soft: rgba(255, 106, 61, 0.12);
  --hl: #ffe58a;
  --serif: 'Songti SC', 'Noto Serif SC', 'SimSun', serif;
  --mono: Consolas, 'JetBrains Mono', monospace;
  min-height: 100vh; background: var(--paper); color: var(--ink);
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  overflow-x: clip;
}
/* 背景互动画布（光尘 / 飘页 / 墨涟漪） */
.bg-canvas {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
}
/* 纸张颗粒 */
.paper-noise {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0.6;
  background-image:
    radial-gradient(rgba(120, 100, 70, 0.05) 1px, transparent 1px),
    radial-gradient(rgba(120, 100, 70, 0.035) 1px, transparent 1px);
  background-size: 26px 26px, 34px 34px;
  background-position: 0 0, 13px 17px;
}
.mono { font-family: var(--mono); }
section { position: relative; z-index: 1; }

/* ============ 导航 ============ */
.nav {
  position: sticky; top: 0; z-index: 60;
  border-bottom: 1px solid transparent; transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
}
.nav.solid { background: rgba(250, 246, 238, 0.92); backdrop-filter: blur(10px); border-bottom-color: var(--line); }
.nav-in {
  max-width: 1240px; margin: 0 auto; padding: 0 28px; height: 70px;
  display: flex; align-items: center; gap: 36px;
}
.logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); }
.logo-book { width: 26px; height: 26px; color: var(--accent); }
.logo-name { font-size: 17px; font-weight: 800; letter-spacing: 1px; }
.logo-sub { font-size: 11px; color: var(--dim); letter-spacing: 2px; border-left: 1px solid var(--line); padding-left: 10px; }
.nav-links { display: flex; gap: 26px; margin-left: auto; }
.nav-links a { color: var(--dim); text-decoration: none; font-size: 14px; transition: color 0.2s; }
.nav-links a:hover { color: var(--accent); }
.nav-btn {
  padding: 10px 20px; border-radius: 999px; border: none; cursor: pointer;
  background: var(--accent); color: #fff; font-size: 13.5px; font-weight: 700; font-family: inherit;
  box-shadow: 0 4px 14px rgba(255, 106, 61, 0.3); transition: transform 0.2s, box-shadow 0.2s;
}
.nav-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(255, 106, 61, 0.4); }
@media (max-width: 900px) { .nav-links { display: none; } }

/* ============ Hero ============ */
.hero {
  max-width: 1240px; margin: 0 auto; padding: 90px 28px 60px;
  display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 40px; align-items: center;
}
.eyebrow {
  font-size: 12px; letter-spacing: 3px; color: var(--dim); margin: 0 0 26px;
}
.eyebrow i { color: var(--accent); font-style: normal; margin: 0 4px; }
.hero-h1 {
  font-family: var(--serif); font-size: clamp(46px, 6.6vw, 84px); line-height: 1.22;
  font-weight: 700; margin: 0 0 28px; letter-spacing: 4px;
}
.hero-h1 .w { display: inline-block; opacity: 0; animation: pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; animation-delay: var(--d); }
@keyframes pop { from { opacity: 0; transform: translateY(24px) scale(0.96); } to { opacity: 1; transform: none; } }
.hero-h1 .accent {
  color: var(--accent); position: relative; font-style: italic;
}
.hero-h1 .accent::after {
  content: ''; position: absolute; left: -2%; right: -4%; bottom: 6px; height: 0.28em;
  background: var(--hl); z-index: -1; border-radius: 4px;
}
.hero-sub { font-size: 16.5px; line-height: 2.05; color: #6d6656; max-width: 520px; margin: 0 0 36px; }
.hero-sub b { color: var(--accent); }
.hero-cta { display: flex; gap: 14px; margin-bottom: 34px; flex-wrap: wrap; }
.btn {
  display: inline-flex; text-decoration: none; cursor: pointer;
  padding: 14px 30px; border-radius: 999px; font-size: 14.5px; font-weight: 700;
  font-family: inherit; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; border: none;
}
.btn.main { background: var(--accent); color: #fff; box-shadow: 0 6px 18px rgba(255, 106, 61, 0.32); }
.btn.main:hover { transform: translateY(-3px) rotate(-0.5deg); box-shadow: 0 10px 26px rgba(255, 106, 61, 0.42); }
.btn.ghost { background: transparent; color: var(--ink); border: 1.5px solid var(--line); }
.btn.ghost:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-3px); }
.btn.small { padding: 10px 22px; font-size: 13px; }
.type-line {
  color: var(--dim); font-size: 13px; letter-spacing: 0.5px;
  min-height: 1.8em; margin: 0 0 18px; display: flex; align-items: center;
}
.type-caret {
  display: inline-block; width: 8px; height: 15px; margin-left: 5px;
  background: var(--accent); animation: blink 0.9s steps(1) infinite;
}
.hero-note { display: flex; align-items: center; gap: 12px; color: var(--dim); font-size: 13.5px; margin: 0; }
.stamp {
  display: inline-block; padding: 4px 12px; border: 2px dashed var(--accent); border-radius: 6px;
  color: var(--accent); font-weight: 700; font-size: 12px; transform: rotate(-3deg);
}
/* 翻页书（放大版：页缘堆叠 + 弯曲翻页 + 双面笔记 + 纸屑） */
.hero-right { display: grid; place-items: center; position: relative; padding: 30px 0; }
.book-wrap { cursor: pointer; text-align: center; position: relative; z-index: 2; }
.book {
  --bw: 240px;
  position: relative; width: var(--bw); height: calc(var(--bw) * 1.33);
  perspective: 1400px; transition: transform 0.35s ease;
}
.book-wrap:hover .book { transform: translateY(-6px) rotate(-0.4deg); }
.book-shadow {
  position: absolute; left: -8%; right: -14%; bottom: -30px; height: 36px; z-index: 0;
  background: radial-gradient(ellipse at center, rgba(90, 70, 40, 0.26), transparent 68%);
  filter: blur(5px); transition: transform 0.35s, opacity 0.35s;
}
.book-wrap:hover .book-shadow { transform: scaleX(1.05) translateY(4px); opacity: 0.85; }
/* 读过的页堆在左缘，没读的页堆在右缘（厚度随翻页变化） */
.stack-left, .stack-right {
  position: absolute; top: 6px; bottom: 8px; z-index: 2;
  background: repeating-linear-gradient(to bottom, #ece2cb 0 2px, #dcd1b4 2px 3.5px);
  border-radius: 3px; transition: width 0.9s cubic-bezier(0.4, 0.08, 0.24, 1);
  box-shadow: 0 2px 6px rgba(90, 70, 40, 0.14);
}
.stack-left { right: calc(100% - 4px); }
.stack-right { left: calc(100% - 4px); }
.book-cover {
  position: absolute; inset: 0; z-index: 1; border-radius: 6px 14px 14px 6px;
  background: linear-gradient(160deg, #ff7a4d, #ff5c38); color: #fff;
  box-shadow: 0 20px 48px rgba(255, 106, 61, 0.38);
  display: flex; flex-direction: column; justify-content: flex-end;
  padding: calc(var(--bw) * 0.075); text-align: left;
}
.book-cover::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: calc(var(--bw) * 0.05);
  background: linear-gradient(to right, rgba(130, 25, 0, 0.4), transparent);
  border-radius: 6px 0 0 6px;
}
.book-cover::after {
  content: ''; position: absolute; right: 12px; top: 14px; bottom: 14px; width: 3px;
  background: rgba(255, 255, 255, 0.22); border-radius: 3px;
}
.cover-mark { font-family: var(--mono); font-size: 12px; letter-spacing: 5px; opacity: 0.85; position: absolute; top: calc(var(--bw) * 0.07); left: calc(var(--bw) * 0.08); }
.book-cover b { font-family: var(--serif); font-size: calc(var(--bw) * 0.11); letter-spacing: 7px; }
.book-cover small { font-size: calc(var(--bw) * 0.037); opacity: 0.85; margin-top: 8px; letter-spacing: 2px; }
.page {
  position: absolute; left: calc(var(--bw) * 0.035); top: calc(var(--bw) * 0.018);
  width: calc(var(--bw) * 0.945); height: calc(var(--bw) * 1.285);
  transform-origin: left center; transform-style: preserve-3d;
}
.page.under { z-index: 3; background: #fffdf7; border-radius: 4px 10px 10px 4px; box-shadow: 0 2px 8px rgba(90, 70, 40, 0.12); border: 1px solid rgba(120, 100, 70, 0.14); }
.page .page-front, .page .page-back {
  position: absolute; inset: 0; backface-visibility: hidden;
  border-radius: 4px 10px 10px 4px; background: #fffdf7;
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.14);
  border: 1px solid rgba(120, 100, 70, 0.14); overflow: hidden;
}
/* 翻页过程：弯曲翻起 + 正面阴影掠过 + 背面投影渐散 */
.page-front::after {
  content: ''; position: absolute; inset: 0; opacity: 0; pointer-events: none;
  background: linear-gradient(to right, rgba(90, 70, 40, 0), rgba(90, 70, 40, 0.22));
}
.page-back::after {
  content: ''; position: absolute; inset: 0; opacity: 0; pointer-events: none;
  background: linear-gradient(to right, rgba(90, 70, 40, 0.4), transparent 55%);
}
.leaf.turned { animation: turnLeaf 1.05s cubic-bezier(0.4, 0.08, 0.24, 1) forwards; }
.leaf.turned .page-front::after { animation: frontShade 1.05s ease forwards; }
.leaf.turned .page-back::after { animation: backShade 1.05s ease forwards; }
@keyframes turnLeaf {
  0% { transform: rotateY(0deg); }
  48% { transform: rotateY(-99deg) rotateZ(1.3deg); }
  100% { transform: rotateY(-160deg); }
}
@keyframes frontShade { from { opacity: 0; } to { opacity: 1; } }
@keyframes backShade { 0% { opacity: 0.5; } 60% { opacity: 0.3; } 100% { opacity: 0; } }
/* 背面：手写笔记页（翻过去能看到笔记横线与荧光笔迹） */
.page-back { transform: rotateY(180deg); background: #fbf7ec; }
.page-back.b1 { background: #f8f2e2; }
.page-back.b2 { background: #fdf9f0; }
.bk-title { display: block; width: 42%; height: 5px; margin: 30px 22px 16px; background: #cfc4a8; border-radius: 3px; }
.page-back .bk-line { display: block; height: 2.5px; margin: 0 22px 11px; background: #ddd3bd; border-radius: 2px; }
.bk-line.lw0 { width: 62%; }
.bk-line.lw1 { width: 84%; }
.bk-line.lw2 { width: 71%; }
.bk-line.lw3 { width: 46%; }
.bk-mark {
  display: block; width: 38%; height: 12px; margin: 6px 22px 0;
  background: linear-gradient(transparent 30%, rgba(255, 229, 138, 0.85) 30%, rgba(255, 229, 138, 0.85) 90%, transparent 90%);
  border-radius: 2px;
}
.bk-note {
  position: absolute; right: 20px; bottom: 34px; font-family: var(--serif); font-style: italic;
  color: var(--accent); font-size: 13px; transform: rotate(-4deg); opacity: 0.9;
}
.bk-note.b1 { color: #d4823d; }
.bk-note.b2 { color: #b05c3a; }
.pg-no { position: absolute; bottom: 12px; right: 16px; font-family: var(--mono); font-size: 11px; color: var(--dim); }
.pg-ch {
  font-size: 16.5px; line-height: 2.1; text-align: left;
  padding: calc(var(--bw) * 0.075) calc(var(--bw) * 0.06) 0; margin: 0;
  color: #57503f; font-family: var(--serif);
}
/* 翻页纸屑 */
.confetti {
  position: absolute; z-index: 70; pointer-events: none; border-radius: 2px;
  background: var(--cc); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  animation: confetti-fly 0.95s cubic-bezier(0.2, 0.5, 0.4, 1) forwards;
}
@keyframes confetti-fly {
  0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  55% { transform: translate(calc(var(--dx) * 0.7), var(--dy)) rotate(calc(var(--rr) * 0.6)); opacity: 1; }
  100% { transform: translate(var(--dx), calc(var(--dy) + 90px)) rotate(var(--rr)); opacity: 0; }
}
.book-hint {
  display: inline-block; margin-top: 26px; color: var(--dim); font-size: 12.5px; letter-spacing: 1px;
  animation: bob 2.4s ease-in-out infinite;
}
@keyframes bob { 50% { transform: translateY(-5px); } }
@media (max-width: 700px) { .book { --bw: min(74vw, 250px); } }
.float-tag {
  position: absolute; padding: 8px 14px; border-radius: 10px; background: #fff;
  box-shadow: 0 6px 18px rgba(90, 70, 40, 0.16); font-size: 13px; font-weight: 600;
  border: 1px solid var(--line); z-index: 3;
  animation: floaty 3.6s ease-in-out infinite;
}
.float-tag.t1 { top: 6%; right: 4%; animation-delay: 0s; }
.float-tag.t2 { bottom: 22%; left: -2%; animation-delay: 1.2s; }
.float-tag.t3 { top: 44%; right: -4%; animation-delay: 2.2s; }
@keyframes floaty { 50% { transform: translateY(-10px) rotate(1.5deg); } }
@media (max-width: 980px) {
  .hero { grid-template-columns: 1fr; padding-top: 60px; }
  .hero-right { order: -1; }
  .float-tag { display: none; }
}

/* ============ 跑马灯 ============ */
.ticker {
  border-top: 1.5px dashed var(--line); border-bottom: 1.5px dashed var(--line);
  overflow: hidden; padding: 16px 0; background: var(--paper2);
}
.ticker-track { display: flex; gap: 40px; width: max-content; animation: marquee 34s linear infinite; }
.ticker:hover .ticker-track, .ticker-track.paused { animation-play-state: paused; }
.ticker-track span { white-space: nowrap; color: #6d6656; font-size: 14px; font-family: var(--serif); letter-spacing: 2px; transition: color 0.2s; cursor: default; }
.ticker-track span:hover { color: var(--accent); }
.ticker-track i { color: var(--accent); font-style: normal; }
@keyframes marquee { to { transform: translateX(-50%); } }

/* ============ 段落头 ============ */
.sec-head { max-width: 1240px; margin: 0 auto; padding: 0 28px; }
.sec-head .no {
  font-family: var(--mono); color: var(--accent); font-size: 14px; font-weight: 700;
  display: inline-block; margin-bottom: 8px;
}
.sec-head h2 { font-family: var(--serif); font-size: clamp(28px, 4vw, 44px); margin: 0 0 10px; letter-spacing: 3px; }
.dot-accent { color: var(--accent); }
.sec-sub { color: var(--dim); margin: 0 0 44px; font-size: 15px; }

/* ============ 01 问书搭子 ============ */
.buddy { max-width: 1240px; margin: 0 auto; padding: 100px 28px 60px; }
.chat {
  border: 1.5px solid var(--line); border-radius: 22px; background: #fffdf7;
  box-shadow: 0 20px 50px rgba(120, 95, 60, 0.12); overflow: hidden;
}
.chat-qs { padding: 22px 26px; border-bottom: 1.5px dashed var(--line); display: flex; gap: 12px; flex-wrap: wrap; }
.q-chip {
  padding: 10px 20px; border-radius: 999px; border: 1.5px solid var(--line);
  background: transparent; color: var(--ink); font-size: 13.5px; font-family: inherit; cursor: pointer;
  transition: all 0.2s;
}
.q-chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); transform: translateY(-2px); }
.q-chip.active { background: var(--accent); border-color: var(--accent); color: #fff; box-shadow: 0 4px 12px rgba(255, 106, 61, 0.3); }
.q-chip:disabled { opacity: 0.5; }
.chat-flow { padding: 28px 26px 34px; min-height: 280px; display: grid; gap: 18px; align-content: start; }
.bubble {
  display: flex; gap: 14px; opacity: 0; transform: translateY(14px); transition: opacity 0.4s, transform 0.4s;
}
.bubble.show { opacity: 1; transform: none; }
.who {
  flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  font-size: 13px; font-weight: 800;
}
.bubble.user .who { background: var(--hl); color: #7a5c00; }
.bubble.ai .who { background: var(--accent-soft); color: var(--accent); border: 1.5px solid var(--accent); }
.bubble p { margin: 0; font-size: 15px; line-height: 1.95; }
.bubble.user p {
  background: var(--hl); padding: 12px 18px; border-radius: 4px 18px 18px 18px; display: inline-block;
}
.bubble.ai p {
  background: #fff; border: 1.5px solid var(--line); padding: 14px 20px;
  border-radius: 18px 4px 18px 18px; color: var(--ink);
}
.bubble.ai { flex-direction: row; }
.bubble.ai p { max-width: 560px; }
.mini { color: var(--dim); font-size: 12px !important; font-family: var(--mono); }
.ai-text { min-height: 28px; }
.caret { display: inline-block; width: 7px; height: 14px; background: var(--accent); margin-left: 4px; vertical-align: -2px; animation: blink 0.9s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.cite-note {
  color: var(--dim) !important; font-size: 13px !important;
  background: var(--paper2) !important; border: 1.5px dashed var(--line) !important;
}

/* ============ 02 荧光笔宣言 ============ */
.creed { max-width: 1240px; margin: 0 auto; padding: 110px 28px; }
.creed-text {
  font-family: var(--serif); font-size: clamp(24px, 3.4vw, 40px); line-height: 2.1;
  letter-spacing: 2px; max-width: 980px; margin: 0 0 34px; font-weight: 600;
}
.creed-text .seg { display: inline; }
.creed-text .ch {
  display: inline; color: rgba(51, 48, 42, 0.34);
  background: linear-gradient(transparent 58%, var(--hl) 58%, var(--hl) 92%, transparent 92%);
  background-size: 0% 100%; background-repeat: no-repeat;
  transition: background-size 0.3s ease, color 0.25s ease;
}
.creed-text .ch.lit { color: var(--ink); background-size: 100% 100%; }
.creed-tip { color: var(--dim); font-size: 12.5px; margin: 0 0 14px; opacity: 0.85; }
.creed-sign { color: var(--dim); font-size: 14px; }

/* ============ 03 便签 ============ */
.skills { max-width: 1240px; margin: 0 auto; padding: 40px 28px 80px; }
.notes { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 26px; }
.note {
  position: relative; padding: 34px 26px 26px; border-radius: 4px 14px 4px 4px;
  background: color-mix(in srgb, var(--pc) 42%, #fffdf7);
  box-shadow: 0 10px 26px rgba(120, 95, 60, 0.14);
  rotate: var(--rot); /* 独立 rotate 属性：与拖拽的 inline translate 互不干扰 */
  transition: rotate 0.3s, box-shadow 0.3s, scale 0.3s;
  cursor: grab; touch-action: none; user-select: none;
}
.note:hover { rotate: 0deg; scale: 1.02; box-shadow: 0 18px 36px rgba(120, 95, 60, 0.2); }
.note.dragging {
  rotate: 0deg; scale: 1.05; cursor: grabbing; z-index: 30; position: relative;
  box-shadow: 0 26px 48px rgba(120, 95, 60, 0.3);
}
.note .pin {
  position: absolute; top: -9px; left: 50%; margin-left: -9px; width: 18px; height: 18px;
  border-radius: 50%; background: var(--accent); box-shadow: 0 3px 6px rgba(0, 0, 0, 0.18), inset 0 -3px 4px rgba(0, 0, 0, 0.15);
}
.note b { display: block; font-size: 17px; margin-bottom: 10px; letter-spacing: 1px; }
.note p { margin: 0; color: #57503f; font-size: 14px; line-height: 1.9; }

/* ============ 04 轨迹 ============ */
.road { max-width: 1240px; margin: 0 auto; padding: 60px 28px 100px; }
.miles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; margin-bottom: 50px; }
.mile {
  background: #fffdf7; border: 1.5px solid var(--line); border-radius: 14px;
  padding: 22px 20px; position: relative; transition: transform 0.25s;
}
.mile:hover { transform: translateY(-5px) rotate(-0.6deg); }
.mile time { font-family: var(--mono); font-size: 12px; color: var(--dim); display: block; margin-bottom: 10px; }
.mile b { display: block; font-size: 15.5px; margin-bottom: 8px; }
.mile p { margin: 0; color: var(--dim); font-size: 13px; line-height: 1.8; }
.mile .badge {
  position: absolute; top: -10px; right: 12px; background: #1f7a5c; color: #fff;
  font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
  transform: rotate(3deg); box-shadow: 0 3px 8px rgba(31, 122, 92, 0.3);
}
.stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;
  border: 1.5px dashed var(--line); border-radius: 18px; padding: 32px 28px; background: var(--paper2);
}
.stat .v { display: block; font-family: var(--serif); font-size: 32px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
.stat .v i { font-style: normal; font-size: 16px; margin-left: 3px; }
.stat .l { color: var(--dim); font-size: 12.5px; letter-spacing: 1px; }
@media (max-width: 1000px) { .miles { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 700px) { .stats { grid-template-columns: repeat(2, 1fr); } }

/* ============ 底部 ============ */
.footer { border-top: 1.5px dashed var(--line); background: var(--paper2); padding: 54px 28px 40px; }
.f-in {
  max-width: 1240px; margin: 0 auto 30px; display: flex; justify-content: space-between;
  align-items: center; gap: 22px; flex-wrap: wrap;
}
.f-brand { display: flex; align-items: center; gap: 14px; }
.f-book { width: 34px; height: 34px; color: var(--accent); }
.f-brand b { font-size: 16px; letter-spacing: 1px; }
.f-brand p { margin: 4px 0 0; color: var(--dim); font-size: 13.5px; }
.f-copy, .f-icp { max-width: 1240px; margin: 0 auto 8px; color: var(--dim); font-size: 12.5px; }
.f-icp { margin-bottom: 0; }
.icp-badge { color: var(--accent); border: 1.5px dashed var(--accent); padding: 2px 10px; border-radius: 6px; margin-right: 8px; font-weight: 600; }

@media (prefers-reduced-motion: reduce) {
  .hero-h1 .w { animation: none; opacity: 1; }
  .ticker-track, .float-tag, .book-hint, .type-caret { animation: none; }
  .bg-canvas { display: none; }
  .leaf { animation: none !important; }
  .leaf.turned { transform: rotateY(-160deg); }
  .leaf.turned .page-front::after, .leaf.turned .page-back::after { animation: none; opacity: 1; }
  .confetti { display: none; }
  .book, .book-shadow, .stack-left, .stack-right { transition: none; }
}
</style>
