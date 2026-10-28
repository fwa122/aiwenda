import { ref, onMounted, onUnmounted } from 'vue'

/** 移动端断点（与 styles/mobile.css 保持一致） */
export const MOBILE_BREAKPOINT = 768

const isMobile = ref(false)
let mediaQuery = null
let handler = null
let refCount = 0

/**
 * 是否为移动端视口（≤768px）。
 * 全局共享一个 matchMedia 监听，多组件调用不会重复绑定。
 */
export function useIsMobile() {
  onMounted(() => {
    refCount += 1
    if (!mediaQuery) {
      mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
      isMobile.value = mediaQuery.matches
      handler = (e) => {
        isMobile.value = e.matches
      }
      mediaQuery.addEventListener('change', handler)
    }
  })

  onUnmounted(() => {
    refCount -= 1
    if (refCount <= 0 && mediaQuery && handler) {
      mediaQuery.removeEventListener('change', handler)
      mediaQuery = null
      handler = null
    }
  })

  return isMobile
}
