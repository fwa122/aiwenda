/**
 * 知识库写权限前端判定，与后端 kb-access.ts 口径一致：
 * admin 恒可写；普通用户仅 owner（kb.userId 与当前用户一致）。
 * 用于隐藏非 owner 的编辑/删除入口，避免点击后才收到 403。
 */
export function canWriteKb(kb, profile) {
  if (!kb) return false
  if (profile?.role === 'admin') return true
  return !!kb.userId && kb.userId === profile?.id
}
