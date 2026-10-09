import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* 强制走真实 SSE 分支（USE_MOCK=false），并隔离 mock 数据库等无关依赖 */
vi.mock('@/api/request', () => ({
  USE_MOCK: false,
  request: vi.fn(),
  mockOk: vi.fn(),
  paginate: vi.fn(),
  mockStreamText: vi.fn()
}))
vi.mock('@/mock', () => ({
  mockDb: { conversations: [], knowledgeBases: [] },
  generateAnswer: vi.fn(),
  buildSources: vi.fn(() => [])
}))
vi.mock('@/mock/answers', () => ({ mockSuggestedQuestions: [], mockQuickPrompts: [] }))

import { streamAnswer } from '@/api/chat'

const enc = (s) => new TextEncoder().encode(s)

/** duck-typed SSE Response：按给定文本块顺序吐出 */
function sseResponse(chunks) {
  const queue = chunks.map(enc)
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (queue.length ? { done: false, value: queue.shift() } : { done: true })
      })
    }
  }
}

const jsonErrorResponse = (status, body, isJson = true) => ({
  ok: false,
  status,
  json: async () => {
    if (!isJson) throw new Error('not json')
    return body
  }
})

const handlers = () => ({
  onChunk: vi.fn(),
  onStage: vi.fn(),
  onDone: vi.fn(),
  onTitle: vi.fn(),
  onError: vi.fn()
})

beforeEach(() => {
  localStorage.setItem('kb_token', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('streamAnswer 真实 SSE 分支', () => {
  it('delta 增量按序回调，跨 chunk 断行正确拼接，done 携带 meta', async () => {
    // 第二块故意从 "del|ta" 处断开，覆盖 buffer 残行拼接逻辑
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"type":"delta","data":{"content":"你"}}\n\ndata: {"type":"del',
          'ta","data":{"content":"好"}}\n\ndata: [DONE]\n\ndata: 心跳\n\ndata: {"type":"done","data":{"meta":{"elapsedMs":10}}}\n\n'
        ])
      )
    )
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onDone).toHaveBeenCalled())

    expect(h.onChunk.mock.calls.map((c) => c[0])).toEqual(['你', '好'])
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ meta: { elapsedMs: 10 } })
    // 心跳行与非 JSON 行被忽略，不产生错误
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('references 事件触发 onStage 并在 done 时随结果返回', async () => {
    const refs = [{ kbId: 'k1', docId: 'd1', chunkIndex: 3 }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ type: 'references', data: refs })}\n\n`,
          'data: {"type":"done","data":{"meta":{}}}\n\n'
        ])
      )
    )
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onDone).toHaveBeenCalled())

    expect(h.onStage).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'generating', sources: refs, text: expect.stringContaining('1 个') })
    )
    expect(h.onDone.mock.calls[0][0].sources).toEqual(refs)
  })

  it('title 事件转发 onTitle（会话自动命名）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"type":"done","data":{"meta":{}}}\n\n',
          'data: {"type":"title","data":{"conversationId":"c1","title":"标题"}}\n\n'
        ])
      )
    )
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onTitle).toHaveBeenCalled())

    expect(h.onTitle).toHaveBeenCalledWith({ conversationId: 'c1', title: '标题' })
  })

  it('error 事件转发 onError（含服务端文案）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: {"type":"error","data":{"message":"模型超时"}}\n\n']))
    )
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled())

    expect(h.onError.mock.calls[0][0].message).toBe('模型超时')
  })

  it('429 JSON 响应：取服务端 message 报错，不读流', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonErrorResponse(429, { message: '请求过于频繁' })))
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled())

    expect(h.onError.mock.calls[0][0].message).toBe('请求过于频繁')
    expect(h.onChunk).not.toHaveBeenCalled()
  })

  it('429 非 JSON 响应：回退默认文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonErrorResponse(429, null, false)))
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled())

    expect(h.onError.mock.calls[0][0].message).toBe('请求失败（HTTP 429）')
  })

  it('abort 触发 onDone({aborted:true}) 而非 onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url, opts) =>
          new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })
      )
    )
    const h = handlers()
    const ctrl = streamAnswer({ question: 'q', kbIds: [], model: 'm' }, h)
    ctrl.abort()
    await vi.waitFor(() => expect(h.onDone).toHaveBeenCalled())

    expect(h.onDone).toHaveBeenCalledWith({ aborted: true })
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('请求头携带 Bearer token 与 stream:true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"type":"done","data":{"meta":{}}}\n\n'])))
    const h = handlers()
    streamAnswer({ question: 'q', kbIds: ['k1'], model: 'm' }, h)
    await vi.waitFor(() => expect(h.onDone).toHaveBeenCalled())

    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/v1/chat/completions')
    expect(opts.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(opts.body)).toMatchObject({ question: 'q', kbIds: ['k1'], stream: true })
  })
})
