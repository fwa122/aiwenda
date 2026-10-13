/**
 * 知识库写权限前端判定，与后端 kb-access.ts 口径一致：
 * admin 恒可写；owner；或库内 editor 成员（myRole 由后端列表/详情接口标注）。
 * 用于隐藏无写权限用户的编辑/删除入口，避免点击后才收到 403。
 */
export function canWriteKb(kb, profile) {
  if (!kb) return false
  if (profile?.role === 'admin') return true
  if (kb.myRole) return kb.myRole === 'owner' || kb.myRole === 'editor'
  return !!kb.userId && kb.userId === profile?.id
}

/**
 * 成员管理权限（与后端 KbMemberService.assertManageable 口径一致）：
 * 仅 owner / admin 可增删改成员，editor 只能写内容。
 */
export function canManageMembers(kb, profile) {
  if (!kb) return false
  if (profile?.role === 'admin') return true
  if (kb.myRole) return kb.myRole === 'owner'
  return !!kb.userId && kb.userId === profile?.id
}
