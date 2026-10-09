import { describe, it, expect } from 'vitest'
import DOMPurify from 'dompurify'
import { renderMarkdown, stripMarkdown } from './markdown'

/* --------------------------------------------------------------------------
   渲染安全与包裹规则回归（v0.9.4 表格复制按钮静默失效的坑固化于此）
   -------------------------------------------------------------------------- */

describe('renderMarkdown 基础与安全', () => {
  it('普通段落正常渲染', () => {
    const html = renderMarkdown('**粗体** 文本')
    expect(html).toContain('<strong>粗体</strong>')
  })

  it('原始 HTML 被转义（html: false 防 XSS）', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('含 onerror 的原始 HTML 被转义为纯文本（不可执行）', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x')
  })

  it('DOMPurify 钩子：带 target 的 a 补 rel=noopener（防 tabnabbing），无 target 不加', () => {
    const withTarget = DOMPurify.sanitize('<a href="http://x" target="_blank">a</a>', {
      ADD_ATTR: ['target', 'rel']
    })
    expect(withTarget).toContain('rel="noopener noreferrer"')
    const withoutTarget = DOMPurify.sanitize('<a href="http://x">a</a>')
    expect(withoutTarget).not.toContain('rel=')
  })
})

describe('代码块与表格包裹（复制按钮由事件委托处理）', () => {
  it('有语言代码块：包裹 + 高亮', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')
    expect(html).toContain('<div class="code-block"><button class="code-copy" type="button">复制</button>')
    expect(html).toContain('hljs')
  })

  it('无语言代码块：仍包裹，内容转义', () => {
    const html = renderMarkdown('```\n<b>\n```')
    expect(html).toContain('code-block')
    expect(html).toContain('&lt;b&gt;')
  })

  it('表格：成对挂在 table_open/close 上，单层包裹', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<div class="table-block"><button class="table-copy" type="button">复制</button>')
    expect(html).toContain('<table>')
    // 流式重渲染整体替换，不产生嵌套包裹
    expect((html.match(/table-block/g) || []).length).toBe(1)
  })

  it('代码块与表格可共存于同一输出', () => {
    const html = renderMarkdown('```js\nx\n```\n\n| a |\n| - |\n| 1 |')
    expect(html).toContain('code-block')
    expect(html).toContain('table-block')
  })
})

describe('内联引用徽标 [n]', () => {
  it('[1] 渲染为可点击 sup.cite', () => {
    const html = renderMarkdown('答案[1]续')
    expect(html).toContain('<sup class="cite" data-cite="1">[1]</sup>')
  })

  it('两位数 [12] 同样支持', () => {
    const html = renderMarkdown('[12]')
    expect(html).toContain('data-cite="12"')
  })

  it('三位数 [123] 不是引用（防误伤数组写法）', () => {
    const html = renderMarkdown('[123]')
    expect(html).not.toContain('class="cite"')
  })

  it('普通链接语法 [x](y) 不受引用规则影响', () => {
    const html = renderMarkdown('[x](http://y)')
    expect(html).toContain('<a href="http://y"')
    expect(html).not.toContain('class="cite"')
  })
})

describe('stripMarkdown 会话摘要', () => {
  it('剥离代码块、行内标记与链接', () => {
    expect(stripMarkdown('```py\nprint(1)\n```段落 **粗** [链接](http://x)')).toBe('[代码块]段落 粗 链接')
  })

  it('空值返回空串', () => {
    expect(stripMarkdown('')).toBe('')
  })
})
