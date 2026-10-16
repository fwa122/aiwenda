// 临时脚本：API 级验证 KB 数据范围可见性（PRIVATE/DEPT/PUBLIC × admin/owner/成员/同部门/异部门），
// 结束后清理全部测试数据（库/成员/部门/用户）
const BASE = 'http://localhost:3000/api/v1';
const { requiredEnv } = require('./lib.env');
// admin 密码从 server/.env 读取，禁止硬编码进代码库
const ADMIN_PASSWORD = requiredEnv('ADMIN_INITIAL_PASSWORD');
const SUF = Date.now().toString().slice(-6);

const created = { kbIds: [], deptIds: [], userIds: [] };
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail ? '→ ' + JSON.stringify(detail) : ''}`);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json.code, data: json.data, message: json.message };
}

async function main() {
  const login = await api('POST', '/auth/login', {
    username: 'admin',
    password: ADMIN_PASSWORD,
  });
  if (login.code !== 0) throw new Error('admin 登录失败');
  const adminToken = login.data.token || login.data.accessToken;

  // 1. 建部门：A（总部QA）→ A2（子组）；B（其他部门）
  const A = await api('POST', '/departments', { name: 'QA-总部' + SUF }, adminToken);
  const A2 = await api('POST', '/departments', { name: 'QA-子组' + SUF, parentId: A.data.id }, adminToken);
  const B = await api('POST', '/departments', { name: 'QA-其他' + SUF }, adminToken);
  created.deptIds = [A.data.id, A2.data.id, B.data.id];
  check('建部门 A/A2/B', A.code === 0 && A2.code === 0 && B.code === 0);

  // 2. 建用户 + 入部门（首次归属自动主部门）
  const mk = async (name, role, deptId) => {
    const u = await api('POST', '/users', {
      username: name + SUF, password: 'Qa12345678', role, nickname: name,
    }, adminToken);
    created.userIds.push(u.data.id);
    await api('POST', `/departments/${deptId}/members`, { userId: u.data.id }, adminToken);
    return u.data;
  };
  const ua = await mk('qa_a_', 'editor', A.data.id); // 部门 A
  const uc = await mk('qa_c_', 'viewer', A2.data.id); // A 的子组
  const ub = await mk('qa_b_', 'viewer', B.data.id); // 无关部门
  check('建 3 用户并入部门', created.userIds.length === 3);

  const uaLogin = await api('POST', '/auth/login', { username: ua.username, password: 'Qa12345678' });
  const ubLogin = await api('POST', '/auth/login', { username: ub.username, password: 'Qa12345678' });
  const uaToken = uaLogin.data.token || uaLogin.data.accessToken;
  const ubToken = ubLogin.data.token || ubLogin.data.accessToken;

  // 3. ua 建库 visibility=DEPT → orgId 默认主部门 A
  const kb = await api('POST', '/knowledge', { name: 'QA可见性库' + SUF, visibility: 'DEPT' }, uaToken);
  created.kbIds.push(kb.data.id);
  check('ua 建库默认 orgId=主部门', kb.code === 0 && kb.data.orgId === A.data.id && kb.data.visibility === 'DEPT', kb);

  // 4. 异部门 ub：列表不可见、详情 403
  let r = await api('GET', '/knowledge?page=1&pageSize=50', null, ubToken);
  check('ub 列表不含 DEPT 库', !(r.data.list || []).some((k) => k.id === kb.data.id));
  r = await api('GET', `/knowledge/${kb.data.id}`, null, ubToken);
  check('ub 详情 403', r.status === 403, r);

  // 5. 子组 uc（A 的下级部门）：自动只读可见
  r = await api('GET', `/knowledge/${kb.data.id}`, null, (await api('POST', '/auth/login', { username: uc.username, password: 'Qa12345678' })).data.token);
  check('子树成员 uc 详情可见且 myRole=null', r.code === 0 && r.data.myRole === null, r);

  // 6. ready 后进问答下拉（options）：uc 可见、ub 不可见
  await api('PUT', `/knowledge/${kb.data.id}`, { status: 'ready' }, uaToken);
  const ubOpts = await api('GET', '/knowledge/options', null, ubToken);
  const ucOpts = await api('GET', '/knowledge/options', null, (await api('POST', '/auth/login', { username: uc.username, password: 'Qa12345678' })).data.token);
  check('options：ub 不含 / uc 含', !ubOpts.data.some((k) => k.id === kb.data.id) && ucOpts.data.some((k) => k.id === kb.data.id));

  // 7. 成员通道：邀请 ub 为 viewer → 可读不可写
  r = await api('POST', `/knowledge/${kb.data.id}/members`, { username: ub.username, role: 'viewer' }, uaToken);
  check('邀请 ub 为 viewer', r.code === 0, r);
  r = await api('GET', `/knowledge/${kb.data.id}`, null, ubToken);
  check('ub 成员可读', r.code === 0 && r.data.myRole === 'viewer');
  r = await api('PUT', `/knowledge/${kb.data.id}`, { description: '越权改' }, ubToken);
  check('ub 成员 viewer 写 403', r.status === 403, r);

  // 8. 收紧为 PRIVATE：成员仍可读；移除成员后立即失效
  await api('PUT', `/knowledge/${kb.data.id}`, { visibility: 'PRIVATE' }, uaToken);
  r = await api('GET', `/knowledge/${kb.data.id}`, null, ubToken);
  check('PRIVATE + 成员可读', r.code === 0);
  const members = await api('GET', `/knowledge/${kb.data.id}/members`, null, uaToken);
  const ubMember = members.data.list.find((m) => m.user && m.user.username === ub.username);
  await api('DELETE', `/knowledge/${kb.data.id}/members/${ubMember.id}`, null, uaToken);
  r = await api('GET', `/knowledge/${kb.data.id}`, null, ubToken);
  check('PRIVATE 移除成员后 403', r.status === 403, r);

  // 9. PUBLIC：全员只读（ub 可读、写 403）
  await api('PUT', `/knowledge/${kb.data.id}`, { visibility: 'PUBLIC' }, uaToken);
  r = await api('GET', `/knowledge/${kb.data.id}`, null, ubToken);
  check('PUBLIC 陌生用户可读', r.code === 0 && r.data.myRole === null);
  r = await api('PUT', `/knowledge/${kb.data.id}`, { name: '越权改名' }, ubToken);
  check('PUBLIC 写 403', r.status === 403, r);

  // 10. orgId 校验：不存在的部门 → 400；admin 恒可见
  r = await api('PUT', `/knowledge/${kb.data.id}`, { orgId: 'dept_none' }, uaToken);
  check('orgId 不存在 400', r.status === 400, r);
  r = await api('GET', `/knowledge/${kb.data.id}`, null, adminToken);
  check('admin 恒可见', r.code === 0);
}

main()
  .then(() => console.log(`\n通过 ${pass} / 失败 ${fail}`))
  .finally(async () => {
    // 清理：删库 → 移除部门成员 → 删部门 → 删用户
    const login = await api('POST', '/auth/login', {
      username: 'admin',
      password: ADMIN_PASSWORD,
    });
    const token = login.data?.token || login.data?.accessToken;
    if (!token) return;
    for (const id of created.kbIds) await api('DELETE', `/knowledge/${id}`, null, token);
    for (const deptId of created.deptIds) {
      const members = await api('GET', `/departments/${deptId}/members?page=1&pageSize=50`, null, token);
      for (const m of members.data?.list || []) {
        await api('DELETE', `/departments/${deptId}/members/${m.userId}`, null, token);
      }
      await api('DELETE', `/departments/${deptId}`, null, token);
    }
    for (const id of created.userIds) await api('DELETE', `/users/${id}`, null, token);
    console.log('清理完成：库/部门/用户已删除');
    if (fail > 0) process.exit(1);
  })
  .catch((e) => {
    console.error('验证中断:', e.message);
    process.exit(1);
  });
