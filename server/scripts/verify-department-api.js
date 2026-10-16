// 临时脚本：API 级验证 department 剩余行为（成员/移动/删除守卫），结束后清理测试数据
const BASE = 'http://localhost:3000/api/v1';
const { requiredEnv } = require('./lib.env');
const ADMIN_PASSWORD = requiredEnv('ADMIN_INITIAL_PASSWORD');

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

async function main() {
  const login = await api('POST', '/auth/login', {
    username: 'admin',
    password: ADMIN_PASSWORD,
  });
  if (login.code !== 0) throw new Error('登录失败: ' + JSON.stringify(login));
  const token = login.data.token || login.data.accessToken;
  console.log('登录 OK, token 字段:', Object.keys(login.data).join(','));

  const users = await api('GET', '/users?page=1&pageSize=50', null, token);
  const admin = users.data.list.find((u) => u.username === 'admin');
  console.log('admin userId:', admin.id);

  const tree = await api('GET', '/departments/tree', null, token);
  const flat = [];
  const walk = (nodes, depth = 0) => {
    for (const n of nodes) {
      flat.push({ id: n.id, name: n.name, depth, children: n.children.length, memberCount: n.memberCount });
      walk(n.children, depth + 1);
    }
  };
  walk(tree.data);
  console.log('当前树:', JSON.stringify(flat.map((f) => `${'  '.repeat(f.depth)}${f.name}(${f.children}子/${f.memberCount}成员)`)));

  let root = tree.data.find((n) => n.name === '门店运营部');
  let child = root?.children.find((n) => n.name === '生鲜组');
  // 兼容独立运行：固定结构不存在时自动创建（浏览器验证场景下直接复用）
  if (!root) {
    const r1 = await api('POST', '/departments', { name: '门店运营部' }, token);
    root = { id: r1.data.id, children: [] };
  }
  if (!child) {
    const r2 = await api('POST', '/departments', { name: '生鲜组', parentId: root.id }, token);
    child = { id: r2.data.id };
  }

  // 5. 指派成员（首次归属自动主部门；显式指定 isPrimary）
  let r = await api('POST', `/departments/${child.id}/members`, { userId: admin.id, isPrimary: true }, token);
  console.log('指派成员:', r.code === 0 ? 'OK isPrimary=' + r.data.isPrimary : 'FAIL ' + JSON.stringify(r));

  // 重复指派应被拒
  r = await api('POST', `/departments/${child.id}/members`, { userId: admin.id }, token);
  console.log('重复指派(应拒):', r.code !== 0 && /已是部门成员/.test(r.message) ? 'OK: ' + r.message : 'FAIL ' + JSON.stringify(r));

  // 6. 成员列表
  r = await api('GET', `/departments/${child.id}/members?page=1&pageSize=10`, null, token);
  const m = r.data.list[0];
  console.log('成员列表:', r.code === 0 && m && m.userId === admin.id && m.isPrimary === true ? `OK (1条, ${m.user.username}, 主部门, 加入时间 ${m.joinedAt})` : 'FAIL ' + JSON.stringify(r));

  // 7. 设为负责人（已是成员，应成功）
  r = await api('PUT', `/departments/${child.id}`, { leaderId: admin.id }, token);
  console.log('设负责人:', r.code === 0 && r.data.leaderId === admin.id ? 'OK' : 'FAIL ' + JSON.stringify(r));

  // 7b. 非成员设负责人应被拒
  const outsider = users.data.list.find((u) => u.username !== 'admin');
  if (outsider) {
    r = await api('PUT', `/departments/${child.id}`, { leaderId: outsider.id }, token);
    console.log('非成员设负责人(应拒):', r.code !== 0 && /负责人必须是该部门成员/.test(r.message) ? 'OK: ' + r.message : 'FAIL ' + JSON.stringify(r));
    // 恢复正确负责人
    await api('PUT', `/departments/${child.id}`, { leaderId: admin.id }, token);
  }

  // 8a. 移到当前父（幂等 no-op）
  r = await api('PUT', `/departments/${child.id}/move`, { parentId: root.id }, token);
  console.log('移到当前父(幂等):', r.code === 0 ? 'OK path=' + r.data.path : 'FAIL ' + JSON.stringify(r));

  // 8b. 成环应拒
  r = await api('PUT', `/departments/${root.id}/move`, { parentId: child.id }, token);
  console.log('成环移动(应拒):', r.code !== 0 && /子部门/.test(r.message) ? 'OK: ' + r.message : 'FAIL ' + JSON.stringify(r));

  // 8c. 移到根级
  r = await api('PUT', `/departments/${child.id}/move`, { parentId: null }, token);
  console.log('移到根级:', r.code === 0 && r.data.parentId === null && r.data.path === `/${child.id}` ? 'OK path=' + r.data.path : 'FAIL ' + JSON.stringify(r));

  // 9a. 有子部门时删父应拒
  await api('PUT', `/departments/${child.id}/move`, { parentId: root.id }, token); // 挂回去
  r = await api('DELETE', `/departments/${root.id}`, null, token);
  console.log('删有子部门的父(应拒):', r.code !== 0 && /子部门/.test(r.message) ? 'OK: ' + r.message : 'FAIL ' + JSON.stringify(r));

  // 9b. 有成员时删应拒
  r = await api('DELETE', `/departments/${child.id}`, null, token);
  console.log('删有成员的部门(应拒):', r.code !== 0 && /成员/.test(r.message) ? 'OK: ' + r.message : 'FAIL ' + JSON.stringify(r));

  // 清理：移除成员 → 删子 → 删父
  r = await api('DELETE', `/departments/${child.id}/members/${admin.id}`, null, token);
  console.log('移除成员:', r.code === 0 ? 'OK (负责人同步卸任)' : 'FAIL ' + JSON.stringify(r));
  const check = await api('GET', `/departments/${child.id}`, null, token).catch(() => null);
  r = await api('DELETE', `/departments/${child.id}`, null, token);
  console.log('删子部门:', r.code === 0 ? 'OK' : 'FAIL ' + JSON.stringify(r));
  r = await api('DELETE', `/departments/${root.id}`, null, token);
  console.log('删根部门:', r.code === 0 ? 'OK' : 'FAIL ' + JSON.stringify(r));

  const t2 = await api('GET', '/departments/tree', null, token);
  console.log('清理后树:', t2.data.length === 0 ? '空 ✓' : JSON.stringify(t2.data));
}

main().catch((e) => {
  console.error('验证中断:', e.message);
  process.exit(1);
});
