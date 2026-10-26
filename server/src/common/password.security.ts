import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/**
 * 密码与用户名安全策略
 *
 * - 密码规则保持 DTO 基线：8~32 位、必须同时包含字母和数字（v0.9.59 按用户要求
 *   移除 v0.9.58 引入的弱口令黑名单/序列等语义校验，避免规则过多影响易用性）
 * - bcrypt cost 12（~250ms）：GPU 暴力破解成本显著抬升；旧哈希由登录成功的
 *   渐进重哈希自动升级，无需迁移脚本
 * - 保留用户名前缀（防 admin_/root_ 仿冒社工）
 */
export const BCRYPT_COST = 12;

/** 注册/改密/重置共用的 bcrypt 哈希（cost 12） */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * 渐进重哈希：登录成功时若存量哈希 cost 低于当前标准（如旧 cost 10），
 * 用明文重哈希升级落库——用户无感，存量口令强度随登录逐步收敛
 */
export function needsRehash(passwordHash: string): boolean {
  try {
    return bcrypt.getRounds(passwordHash) < BCRYPT_COST;
  } catch {
    return false; // 非 bcrypt 格式（异常数据）不碰，交给验证失败路径
  }
}

export function rehashIfNeeded(
  passwordHash: string,
  plain: string
): Promise<string> | null {
  return needsRehash(passwordHash) ? hashPassword(plain) : null;
}

/** 保留用户名前缀（不区分大小写）：防 admin_/root_/official_ 仿冒社工与钓鱼 */
const RESERVED_PREFIXES = [
  'admin', 'administrator', 'root', 'sys', 'system', 'official', 'staff',
  'moderator', 'support', 'help', 'notice', 'noreply', 'no_reply', 'security',
  'owner', 'master', 'service', 'superuser', 'operator', 'audit', 'webmaster',
];

export function assertUsernameAllowed(username: string): void {
  const name = (username || '').toLowerCase();
  if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) {
    // ForbiddenException 与 403 语义对齐：账号名不合规，非参数格式问题
    throw new ForbiddenException('该用户名为系统保留名称，请更换');
  }
}
