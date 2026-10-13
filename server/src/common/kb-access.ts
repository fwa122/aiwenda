/**
 * 知识库访问权限判断（kb.service / document.service / member.service 共用）。
 * 归属字段为 kb.userId（可空）：NULL 视为遗留公共资源，仅 admin 可写。
 * 成员协作：kb_members 表授权 editor（可写）/ viewer（可读），
 * memberRole 为当前用户在该库的成员角色（非成员传 null），实时查库判定，移除即失效。
 */
export interface SessionUser {
  id: string;
  username: string;
  role: string;
}

interface KbAccessFields {
  userId: string | null;
  visibility: string; // internal | private | public
}

/** 读权限：internal/public 对所有登录用户可见；private 仅 owner、admin 与库成员 */
export function canReadKb(
  kb: KbAccessFields,
  user: SessionUser,
  memberRole?: string | null
): boolean {
  return (
    user.role === 'admin' ||
    kb.userId === user.id ||
    kb.visibility !== 'private' ||
    memberRole != null
  );
}

/** 写权限：admin 恒可写；owner；或库内 editor 成员（无主库不可由成员写） */
export function canWriteKb(
  kb: KbAccessFields,
  user: SessionUser,
  memberRole?: string | null
): boolean {
  if (user.role === 'admin') return true;
  if (kb.userId !== null && kb.userId === user.id) return true;
  return memberRole === 'editor';
}
