import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({
  html: false, // 禁止原始 HTML，防止 XSS
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : null
    if (language) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      } catch (e) {
        /* 高亮失败则回退为纯文本 */
      }
    }
    return md.utils.escapeHtml(code)
  }
})

/* --------------------------------------------------------------------------
   内联引用徽标：正文中的 [1] [2] 渲染为可点击 <sup class="cite">
   （由 ChatMessage 事件委托处理点击 → 打开来源预览）
   -------------------------------------------------------------------------- */
md.inline.ruler.push('kb_citation', (state, silent) => {
  const start = state.pos
  if (state.src[start] !== '[') return false
  const end = state.src.indexOf(']', start + 1)
  if (end < 0 || end - start > 3) return false
  const num = state.src.slice(start + 1, end)
  if (!/^\d{1,2}$/.test(num)) return false
  if (!silent) {
    const token = state.push('kb_cite', '', 0)
    token.meta = { num }
  }
  state.pos = end + 1
  return true
})

md.renderer.rules.kb_cite = (tokens, idx) => {
  const num = tokens[idx].meta.num
  return `<sup class="cite" data-cite="${num}">[${num}]</sup>`
}

/* --------------------------------------------------------------------------
   代码块：包裹复制按钮（无内联 JS，点击由事件委托处理，避免被 DOMPurify 清洗）
   -------------------------------------------------------------------------- */
const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const raw = defaultFence(tokens, idx, options, env, self)
  // raw 形如 <pre><code ...>…</code></pre> 或 <pre class="hljs">…
  return `<div class="code-block"><button class="code-copy" type="button">复制</button>${raw}</div>`
}

/* --------------------------------------------------------------------------
   表格：同款包裹复制按钮（复制为纯文本：单元格 \t 分隔、行 \n 分隔）。
   注意：markdown-it 渲染表格走的是 table_open / table_close 两个 token 规则，
   不存在被调用的 'table' 键——包裹必须成对挂在 open/close 上（渲染期生成
   HTML 字符串而非 DOM 操作，流式重渲染整体替换，天然不重复包裹）
   -------------------------------------------------------------------------- */
// markdown-it 对 table_open/table_close 无默认渲染器（undefined），需 fallback 到
// 内置的 renderToken，否则解构调用抛 TypeError（本项目安装版本实测如此）
const defaultTableOpen =
  md.renderer.rules.table_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.table_open = (...args) =>
  `<div class="table-block"><button class="table-copy" type="button">复制</button>${defaultTableOpen(...args)}`
const defaultTableClose = md.renderer.rules.table_close || (() => '')
md.renderer.rules.table_close = (...args) => `${defaultTableClose(...args)}</div>`

// 强制带 target 的链接补 rel，防 _blank 反向标签劫持（tabnabbing）
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * 将 Markdown 渲染为安全的 HTML 字符串
 * @param {string} source Markdown 源文本
 * @returns {string} 经过 DOMPurify 净化的 HTML
 */
export function renderMarkdown(source = '') {
  const raw = md.render(source)
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
}

/**
 * 去除 Markdown 标记，用于会话列表摘要展示
 * @param {string} source
 * @returns {string}
 */
export function stripMarkdown(source = '') {
  return source
    .replace(/```[\s\S]*?```/g, '[代码块]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[>#*_\-~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default md
