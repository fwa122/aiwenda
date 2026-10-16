import { describe, expect, it } from 'vitest';
import { canReadKb, canWriteKb } from './kb-access';

// 超管判定基于 dataScope=ALL（配置化鉴权），不再看 role 字符串
const admin = { id: 'u_ad', username: 'ad', role: 'admin', dataScope: 'ALL' };
const owner = { id: 'u_o', username: 'o', role: 'editor', dataScope: 'SELF' };
const stranger = { id: 'u_s', username: 's', role: 'viewer', dataScope: 'SELF' };

const kb = {
  userId: 'u_o',
  visibility: 'PRIVATE',
  orgId: null,
};

describe('canReadKb 可见性矩阵', () => {
  it('admin 恒可读；owner 恒可读', () => {
    expect(canReadKb({ ...kb, visibility: 'PRIVATE' }, admin, null)).toBe(true);
    expect(canReadKb({ ...kb, visibility: 'PRIVATE' }, owner, null)).toBe(true);
  });

  it('PUBLIC 全员可读（无归属、非成员）', () => {
    expect(canReadKb({ userId: null, visibility: 'PUBLIC', orgId: null }, stranger, null)).toBe(true);
  });

  it('DEPT：落在可见部门 → 可读；库成员 → 可读；两者皆非 → 拒绝', () => {
    const deptKb = { userId: 'u_o', visibility: 'DEPT', orgId: 'dept_a' };
    expect(canReadKb(deptKb, stranger, null, true)).toBe(true);
    expect(canReadKb(deptKb, stranger, 'viewer', false)).toBe(true);
    expect(canReadKb(deptKb, stranger, null, false)).toBe(false);
  });

  it('DEPT 且 orgId 为空（异常配置）：部门通道不生效', () => {
    const deptKb = { userId: 'u_o', visibility: 'DEPT', orgId: null };
    expect(canReadKb(deptKb, stranger, null, true)).toBe(false);
  });

  it('PRIVATE：仅库成员可读，同部门也拒绝', () => {
    expect(canReadKb(kb, stranger, 'viewer', true)).toBe(true);
    expect(canReadKb(kb, stranger, null, true)).toBe(false);
  });

  it('遗留无主库（userId=null）：非 PUBLIC 仍需成员或部门通道', () => {
    expect(canReadKb({ userId: null, visibility: 'DEPT', orgId: 'dept_a' }, stranger, null, true)).toBe(true);
    expect(canReadKb({ userId: null, visibility: 'DEPT', orgId: 'dept_a' }, stranger, null, false)).toBe(false);
  });
});

describe('canWriteKb（可见性不改写权限）', () => {
  it('部门可见 / 全员可见都只授读：非成员不可写', () => {
    expect(canWriteKb({ userId: 'u_o', visibility: 'DEPT', orgId: 'dept_a' }, stranger, null)).toBe(false);
    expect(canWriteKb({ userId: 'u_o', visibility: 'PUBLIC', orgId: null }, stranger, 'viewer')).toBe(false);
  });

  it('owner / admin / editor 成员可写；viewer 成员不可写', () => {
    expect(canWriteKb(kb, owner, null)).toBe(true);
    expect(canWriteKb(kb, admin, null)).toBe(true);
    expect(canWriteKb(kb, stranger, 'editor')).toBe(true);
    expect(canWriteKb(kb, stranger, 'viewer')).toBe(false);
  });
});

describe('dataScope 语义（配置化鉴权回归）', () => {
  const privateKb = { ...kb, visibility: 'PRIVATE' };

  it('role=admin 但 dataScope 缺失/非 ALL：不再享有超管权限（按最小权限兜底）', () => {
    const legacy = { id: 'u_l', username: 'l', role: 'admin', dataScope: 'SELF' };
    const noScope = { id: 'u_n', username: 'n', role: 'admin' };
    expect(canReadKb(privateKb, legacy, null)).toBe(false);
    expect(canWriteKb(privateKb, legacy, null)).toBe(false);
    expect(canReadKb(privateKb, noScope, null)).toBe(false);
    expect(canWriteKb(privateKb, noScope, null)).toBe(false);
  });

  it('role 非 admin 但 dataScope=ALL（自定义超管角色）：享有全部数据权限', () => {
    const custom = { id: 'u_c', username: 'c', role: 'boss', dataScope: 'ALL' };
    expect(canReadKb(privateKb, custom, null)).toBe(true);
    expect(canWriteKb(privateKb, custom, null)).toBe(true);
  });
});
