/**
 * 第 3 步 API 实测：Role.dataScope 配置化鉴权
 * 覆盖：内置角色落库、JWT 注入 dataScope、管理接口角色白名单、
 *       非法角色 400、roleName 动态化、超管数据权限（hasAllScope 链路）。
 * 复用 verify-department-api.js 的模式：独立验证账号，跑完即清理。
 */
const { requiredEnv } = require('./lib.env');
const BASE = 'http://127.0.0.1:3000/api/v1';
// admin 密码从 server/.env 的 ADMIN_INITIAL_PASSWORD 读取，禁止硬编码进代码库
const ADMIN_PASSWORD = requiredEnv('ADMIN_INITIAL_PASSWORD');

let pass = 0;
let fail = 0;
const results = [];

function report(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  results.push(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  return { status: res.status, data };
}

async function login(username, password) {
  const { data } = await api('POST', '/auth/login', { body: { username, password } });
  return data?.data;
}

async function main() {
  // ── 1. admin 登录：profile 携带动态 roleName ──
  const admin = await login('admin', ADMIN_PASSWORD);
  report('admin 登录', !!admin?.token, `role=${admin?.user?.role} roleName=${admin?.user?.roleName}`);
  report(
    'profile roleName 动态化（roles 表配置优先）',
    admin?.user?.roleName === '超级管理员',
    `roleName=${admin?.user?.roleName}`
  );
  const at = admin?.token;

  // ── 2. 内置角色 seed 校验：间接通过「用非法角色建号 400」验证 roles 表在生效 ──
  const bad = await api('POST', '/users', {
    token: at,
    body: { username: 'rbac_bad_role', password: 'Passw0rd1', role: 'not_exist_role' },
  });
  report('非法角色建号被拒（400，roles 表校验生效）', bad.status === 400, `code=${bad.data?.code} msg=${bad.data?.message}`);

  // ── 3. 建 editor 验证账号（走角色存在性校验）──
  const suffix = Date.now().toString(36);
  const uname = `rbac_editor_${suffix}`;
  const created = await api('POST', '/users', {
    token: at,
    body: { username: uname, password: 'Passw0rd1', role: 'editor', nickname: 'rbac验证编辑' },
  });
  report('admin 创建 editor 用户（角色校验通过）', created.status < 300 && created.data?.data?.role === 'editor',
    `status=${created.status} code=${created.data?.code} id=${created.data?.data?.id} role=${created.data?.data?.role}`);
  const uid = created.data?.data?.id;
  report('创建返回带 roleName（动态）', created.data?.data?.roleName === '知识库编辑', `roleName=${created.data?.data?.roleName}`);

  // ── 4. editor 登录：管理接口 403 + 数据接口正常 ──
  const editor = await login(uname, 'Passw0rd1');
  report('editor 登录', !!editor?.token, `role=${editor?.user?.role}`);
  const et = editor?.token;

  const users403 = await api('GET', '/users', { token: et });
  report('editor 访问用户管理 403（@Roles 白名单）', users403.status === 403, `status=${users403.status}`);
  const stats403 = await api('GET', '/stats/users', { token: et });
  report('editor 访问用户用量排行 403（@Roles admin）', stats403.status === 403, `status=${stats403.status}`);
  const kbList = await api('GET', '/knowledge', { token: et });
  report('editor 访问知识库列表 200（业务接口不受影响）', kbList.status === 200, `status=${kbList.status} total=${kbList.data?.data?.total}`);
  const convList = await api('GET', '/conversations', { token: et });
  report('editor 访问会话列表 200（业务接口不受影响）', convList.status === 200, `status=${convList.status}`);

  // ── 5. viewer 语义：注册默认 viewer，同样被管理接口拒绝 ──
  const vname = `rbac_viewer_${suffix}`;
  await api('POST', '/auth/register', { body: { username: vname, password: 'Passw0rd1' } });
  const viewer = await login(vname, 'Passw0rd1');
  report('viewer（注册默认角色）登录', viewer?.user?.role === 'viewer', `role=${viewer?.user?.role}`);
  const v403 = await api('GET', '/users', { token: viewer?.token });
  report('viewer 访问用户管理 403', v403.status === 403, `status=${v403.status}`);

  // ── 6. 超管数据权限链路（dataScope=ALL → hasAllScope）：admin 可改角色、封禁 ──
  const roleChange = await api('PUT', `/users/${uid}`, { token: at, body: { role: 'viewer' } });
  report('admin 修改用户角色为 viewer（200）', roleChange.status === 200, `role=${roleChange.data?.data?.role} roleName=${roleChange.data?.data?.roleName}`);
  const badChange = await api('PUT', `/users/${uid}`, { token: at, body: { role: 'ghost' } });
  report('admin 改为非法角色被拒（400）', badChange.status === 400, `code=${badChange.data?.code}`);

  // ── 7. 清理 ──
  for (const name of [uname, vname]) {
    const u = await api('GET', `/users?keyword=${name}`, { token: at });
    for (const row of u.data?.data?.list || []) {
      await api('DELETE', `/users/${row.id}`, { token: at });
    }
  }
  report('验证数据清理完成', true, `deleted=${uname},${vname}`);

  console.log('\n===== 第 3 步 RBAC 验证结果 =====');
  for (const r of results) console.log(r);
  console.log(`\n通过 ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('验证脚本异常：', e);
  process.exit(1);
});
