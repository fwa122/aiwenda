import { defineStore } from 'pinia'
import * as kbApi from '@/api/knowledge'

export const useKnowledgeStore = defineStore('knowledge', {
  state: () => ({
    list: [],
    total: 0,
    options: [],
    current: null,
    documents: [],
    docTotal: 0,
    loading: false,
    docLoading: false
  }),

  getters: {
    readyOptions: (state) => state.options.filter((item) => item.status !== 'draft')
  },

  actions: {
    async fetchList(params = {}) {
      this.loading = true
      try {
        const res = await kbApi.getKnowledgeList(params)
        this.list = res.list
        this.total = res.total
        return res
      } finally {
        this.loading = false
      }
    },

    async fetchOptions() {
      this.options = await kbApi.getKnowledgeOptions()
      return this.options
    },

    async fetchDetail(id) {
      this.loading = true
      try {
        this.current = await kbApi.getKnowledgeDetail(id)
        return this.current
      } finally {
        this.loading = false
      }
    },

    async fetchDocuments(kbId, params = {}) {
      this.docLoading = true
      try {
        const res = await kbApi.getDocuments(kbId, params)
        this.documents = res.list
        this.docTotal = res.total
        return res
      } finally {
        this.docLoading = false
      }
    },

    async create(payload) {
      const kb = await kbApi.createKnowledge(payload)
      await this.fetchOptions()
      return kb
    },

    async update(id, payload) {
      const kb = await kbApi.updateKnowledge(id, payload)
      if (this.current?.id === id) this.current = kb
      return kb
    },

    async remove(id) {
      await kbApi.deleteKnowledge(id)
      this.list = this.list.filter((item) => item.id !== id)
      await this.fetchOptions()
    },

    async rebuildIndex(id) {
      await kbApi.rebuildIndex(id)
      if (this.current?.id === id) this.current.status = 'indexing'
    },

    async upload(kbId, files, onProgress) {
      const docs = await kbApi.uploadDocuments(kbId, files, onProgress)
      await this.fetchDocuments(kbId)
      return docs
    },

    async removeDocument(kbId, docId) {
      await kbApi.deleteDocument(kbId, docId)
      this.documents = this.documents.filter((doc) => doc.id !== docId)
    },

    async reparseDocument(kbId, docId) {
      await kbApi.reparseDocument(kbId, docId)
      await this.fetchDocuments(kbId)
    }
  }
})
