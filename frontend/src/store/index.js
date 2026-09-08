import { createPinia } from 'pinia'

const pinia = createPinia()

export default pinia
export { useUserStore } from './user'
export { useChatStore } from './chat'
export { useKnowledgeStore } from './knowledge'
