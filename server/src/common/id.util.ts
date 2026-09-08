import { randomBytes } from 'crypto';

const PREFIX: Record<string, string> = {
  user: 'u',
  kb: 'kb',
  doc: 'doc',
  conv: 'conv',
  msg: 'msg',
  chunk: 'ck',
  key: 'key',
  att: 'att',
};

/**
 * 生成带前缀的业务 ID，与前端 Mock 数据格式保持一致，便于联调对照
 * 例：genId('user') => 'u_a1b2c3d4e5f6'
 */
export function genId(type: keyof typeof PREFIX): string {
  return `${PREFIX[type]}_${randomBytes(6).toString('hex')}`;
}
