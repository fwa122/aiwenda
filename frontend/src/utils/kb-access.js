/**
 * 知识库写权限前端判定，与后端 kb-access.ts 口径一致：
 * 站长/超管（rank≥3）恒可写；kb 创建者；或库内 editor 成员（myRole 由后端标注，
 * 超管级用户被后端标注为 myRole='admin'）。用于隐藏无写权限用户的编辑/删除入口。
 */
import { rankOf } from './rbac'

export function canWriteKb(kb, profile) {
  if (!kb) return false
  if (rankOf(profile?.role) >= 3) return true
  if (kb.myRole) return ['owner', 'admin', 'editor'].includes(kb.myRole)
  return !!kb.userId && kb.userId === profile?.id
}

/**
 * 成员管理权限（与后端 KbMemberService.assertManageable 口径一致）：
 * 站长/超管，或库创建者。管理员（rank2）不参与知识库模块。
 */
export function canManageMembers(kb, profile) {
  if (!kb) return false
  if (rankOf(profile?.role) >= 3) return true
  if (kb.myRole) return kb.myRole === 'owner'
  return !!kb.userId && kb.userId === profile?.id
}

/** 建库：站长/超管（v0.9.61 四级） */
export function canCreateKb(profile) {
  return rankOf(profile?.role) >= 3
}
