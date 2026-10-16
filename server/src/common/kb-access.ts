/**
 * 知识库访问权限判断（kb.service / document.service / member.service / chat / search 共用）。
 * 归属字段为 kb.userId（可空）：NULL 视为遗留公共资源，仅 admin 可写。
 * 可见性三态（KbVisibility）：
 * - PRIVATE：仅 owner、admin 与库成员
 * - DEPT：归属部门（orgId，含子树）成员自动只读可见，编辑权仍走 KbMember
 * - PUBLIC：全员只读可见
 * deptVisible 由调用方判定（kb.orgId 是否落在用户可见部门范围内，见 common/dept-scope），
 * 不涉及部门过滤的路径可缺省。写权限不受可见性影响：部门/公开可见只授读。
 * 成员协作：kb_members 表授权 editor（可写）/ viewer（可读），
 * memberRole 为当前用户在该库的成员角色（非成员传 null），实时查库判定，移除即失效。
 */
import { ScopedUser, hasAllScope } from './rbac';

export interface SessionUser extends ScopedUser {
  id: string;
  username: string;
}

export interface KbAccessFields {
  userId: string | null;
  visibility: string; // PRIVATE | DEPT | PUBLIC
  orgId?: string | null;
}

/** 读权限：超管(dataScope=ALL)/owner 恒可读；PUBLIC 全员；DEPT 落在可见部门或库成员；PRIVATE 仅库成员 */
export function canReadKb(
  kb: KbAccessFields,
  user: SessionUser,
  memberRole?: string | null,
  deptVisible = false
): boolean {
  if (hasAllScope(user) || kb.userId === user.id || kb.visibility === 'PUBLIC') {
    return true;
  }
  // DEPT 且 orgId 为空属异常配置：部门通道不生效（纵深防御，不信任调用方传参）
  if (kb.visibility === 'DEPT') return (!!kb.orgId && deptVisible) || memberRole != null;
  return memberRole != null;
}

/** 写权限：超管(dataScope=ALL)恒可写；owner；或库内 editor 成员（部门/公开可见均不改写权限） */
export function canWriteKb(
  kb: KbAccessFields,
  user: SessionUser,
  memberRole?: string | null
): boolean {
  if (hasAllScope(user)) return true;
  if (kb.userId !== null && kb.userId === user.id) return true;
  return memberRole === 'editor';
}
