/**
 * 知识库访问权限判断（kb.service / document.service 共用）。
 * 归属字段为 kb.userId（可空）：NULL 视为遗留公共资源，仅 admin 可写。
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

/** 读权限：internal/public 对所有登录用户可见；private 仅 owner 与 admin */
export function canReadKb(kb: KbAccessFields, user: SessionUser): boolean {
  return user.role === 'admin' || kb.userId === user.id || kb.visibility !== 'private';
}

/** 写权限：admin 恒可写；普通用户仅 owner（无主库不可写） */
export function canWriteKb(kb: KbAccessFields, user: SessionUser): boolean {
  return user.role === 'admin' || (kb.userId !== null && kb.userId === user.id);
}
