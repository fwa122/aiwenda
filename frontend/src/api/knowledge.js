import { request, mockOk, paginate, USE_MOCK } from './request'
import { mockDb, retrieveChunks } from '@/mock'
import { clone, uid } from '@/utils/format'

/* ==========================================================================
   知识库
   ========================================================================== */

/** 知识库列表（支持关键词、状态筛选与分页） */
export function getKnowledgeList(params = {}) {
  const { keyword = '', status = '', page = 1, pageSize = 20 } = params
  if (USE_MOCK) {
    let list = clone(mockDb.knowledgeBases)
    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter(
        (kb) => kb.name.toLowerCase().includes(kw) || kb.description.toLowerCase().includes(kw)
      )
    }
    if (status) list = list.filter((kb) => kb.status === status)
    list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return mockOk(paginate(list, page, pageSize))
  }
  return request({ url: '/v1/knowledge', method: 'get', params })
}

/** 已就绪的知识库（供问答页选择） */
export function getKnowledgeOptions() {
  if (USE_MOCK) {
    return mockOk(
      mockDb.knowledgeBases.map((kb) => ({
        id: kb.id,
        name: kb.name,
        status: kb.status,
        docCount: kb.docCount,
        chunkCount: kb.chunkCount
      })),
      120
    )
  }
  return request({ url: '/v1/knowledge/options', method: 'get' })
}

/** 知识库详情 */
export function getKnowledgeDetail(id) {
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === id)
    return kb ? mockOk(clone(kb)) : Promise.reject(new Error('知识库不存在'))
  }
  return request({ url: `/v1/knowledge/${id}`, method: 'get' })
}

/** 新建知识库 */
export function createKnowledge(payload) {
  if (USE_MOCK) {
    const kb = {
      id: uid('kb'),
      name: payload.name,
      description: payload.description || '',
      icon: 'Collection',
      color: '#3f6ae1',
      status: 'draft',
      docCount: 0,
      chunkCount: 0,
      totalSize: 0,
      embeddingModel: payload.embeddingModel || 'bge-large-zh-v1.5',
      vectorDim: 1024,
      vectorStore: payload.vectorStore || 'milvus',
      chunkSize: payload.chunkSize ?? 512,
      chunkOverlap: payload.chunkOverlap ?? 64,
      parser: payload.parser || 'smart',
      retriever: {
        topK: payload.topK ?? 5,
        threshold: payload.threshold ?? 0.28,
        rerank: payload.rerank ?? true,
        rerankModel: payload.rerank ? 'bge-reranker-large' : '',
        hybrid: payload.hybrid ?? true
      },
      llm: payload.llm || { provider: 'qwen', model: 'qwen2.5-72b-instruct', temperature: 0.3 },
      visibility: payload.visibility || 'internal',
      owner: '当前用户',
      memberCount: 1,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      stats: { weekQuestions: 0, hitRate: 0, avgLatency: 0 },
      docs: []
    }
    mockDb.knowledgeBases.unshift(kb)
    return mockOk(clone(kb), 400)
  }
  return request({ url: '/v1/knowledge', method: 'post', data: payload })
}

/** 更新知识库配置 */
export function updateKnowledge(id, payload) {
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === id)
    if (!kb) return Promise.reject(new Error('知识库不存在'))
    Object.assign(kb, payload, {
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    return mockOk(clone(kb), 320)
  }
  return request({ url: `/v1/knowledge/${id}`, method: 'put', data: payload })
}

/** 删除知识库 */
export function deleteKnowledge(id) {
  if (USE_MOCK) {
    const idx = mockDb.knowledgeBases.findIndex((item) => item.id === id)
    if (idx > -1) mockDb.knowledgeBases.splice(idx, 1)
    return mockOk({ id }, 320)
  }
  return request({ url: `/v1/knowledge/${id}`, method: 'delete' })
}

/** 重建向量索引 */
export function rebuildIndex(id) {
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === id)
    if (kb) kb.status = 'indexing'
    return mockOk({ id, status: 'indexing' }, 300)
  }
  return request({ url: `/v1/knowledge/${id}/reindex`, method: 'post' })
}

/* ==========================================================================
   文档
   ========================================================================== */

/** 文档列表 */
export function getDocuments(kbId, params = {}) {
  const { keyword = '', status = '', page = 1, pageSize = 10 } = params
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === kbId)
    let list = clone(kb?.docs || [])
    if (keyword) list = list.filter((doc) => doc.name.toLowerCase().includes(keyword.toLowerCase()))
    if (status) list = list.filter((doc) => doc.status === status)
    list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return mockOk(paginate(list, page, pageSize), 240)
  }
  return request({ url: `/v1/knowledge/${kbId}/documents`, method: 'get', params })
}

/**
 * 上传文档（模拟解析与向量化进度）
 * @param {string} kbId
 * @param {Array<{name:string, size:number}>} files
 * @param {(percent:number)=>void} onProgress
 */
export function uploadDocuments(kbId, files = [], onProgress) {
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === kbId)
    return new Promise((resolve) => {
      let percent = 0
      const timer = setInterval(() => {
        percent += 8 + Math.random() * 14
        if (percent >= 100) {
          clearInterval(timer)
          percent = 100
          onProgress?.(100)
          const docs = files.map((file) => ({
            id: uid('doc'),
            name: file.name,
            type: (file.name.split('.').pop() || 'txt').toLowerCase(),
            size: file.size || Math.floor(Math.random() * 3 * 1024 * 1024),
            pages: 4 + Math.floor(Math.random() * 30),
            chunkCount: 6 + Math.floor(Math.random() * 60),
            status: 'parsing',
            progress: 0,
            version: 'v1.0',
            uploader: '当前用户',
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            chunks: []
          }))
          if (kb) {
            kb.docs.unshift(...clone(docs))
            kb.docCount = kb.docs.length
          }
          // 模拟后台异步解析完成
          setTimeout(() => {
            if (!kb) return
            docs.forEach((doc) => {
              const target = kb.docs.find((d) => d.id === doc.id)
              if (target) {
                target.status = 'parsed'
                target.progress = 100
              }
            })
          }, 2600)
          resolve(docs)
        } else {
          onProgress?.(Math.floor(percent))
        }
      }, 240)
    })
  }
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  return request({
    url: `/v1/knowledge/${kbId}/documents`,
    method: 'post',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 0
      onProgress?.(percent)
    }
  })
}

/** 删除文档 */
export function deleteDocument(kbId, docId) {
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === kbId)
    if (kb) {
      const idx = kb.docs.findIndex((d) => d.id === docId)
      if (idx > -1) kb.docs.splice(idx, 1)
      kb.docCount = kb.docs.length
    }
    return mockOk({ id: docId }, 260)
  }
  return request({ url: `/v1/knowledge/${kbId}/documents/${docId}`, method: 'delete' })
}

/** 重新解析文档 */
export function reparseDocument(kbId, docId) {
  if (USE_MOCK) {
    const kb = mockDb.knowledgeBases.find((item) => item.id === kbId)
    const doc = kb?.docs.find((d) => d.id === docId)
    if (doc) {
      doc.status = 'parsing'
      doc.progress = 0
      setTimeout(() => {
        doc.status = 'parsed'
        doc.progress = 100
      }, 2400)
    }
    return mockOk({ id: docId }, 240)
  }
  return request({ url: `/v1/knowledge/${kbId}/documents/${docId}/reparse`, method: 'post' })
}

/** 文档切片列表 */
export function getDocumentChunks(docId) {
  if (USE_MOCK) {
    let chunks = []
    mockDb.knowledgeBases.forEach((kb) => {
      const doc = kb.docs.find((d) => d.id === docId)
      if (doc) chunks = clone(doc.chunks || [])
    })
    return mockOk(chunks, 200)
  }
  return request({ url: `/v1/documents/${docId}/chunks`, method: 'get' })
}

/* ==========================================================================
   检索测试
   ========================================================================== */

/**
 * 检索测试
 * @param {{kbId:string, query:string, topK:number, threshold:number, rerank:boolean}} payload
 */
export function retrievalTest(payload) {
  if (USE_MOCK) {
    const results = retrieveChunks(
      payload.query,
      payload.kbId ? [payload.kbId] : [],
      payload.topK ?? 5,
      payload.threshold ?? 0.28
    )
    return mockOk(
      {
        query: payload.query,
        topK: payload.topK ?? 5,
        threshold: payload.threshold ?? 0.28,
        rerank: payload.rerank ?? false,
        elapsedMs: 68 + Math.floor(Math.random() * 120),
        total: results.length,
        results
      },
      420
    )
  }
  return request({ url: '/v1/knowledge/retrieval-test', method: 'post', data: payload })
}
