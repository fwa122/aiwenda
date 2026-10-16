/**
 * API 实测：删除部门时拦截名下 KB（防 orgId 悬空 → DEPT 库静默隐身）
 * 链路：建部门 D → 建 DEPT 库挂 D → 删 D 被拒 → 迁移库归属 → 删 D 成功 → 清理
 */
const { requiredEnv } = require('./lib.env');
const BASE = 'http://127.0.0.1:3000/api/v1';
const ADMIN_PASSWORD = requiredEnv('ADMIN_INITIAL_PASSWORD');
const SUF = Date.now().toString(36).slice(-6);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json.code, data: json.data, message: json.message };
}

async function main() {
  const login = await api('POST', '/auth/login', {
    body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  const at = login.data?.token;
  check('admin 登录', !!at);

  // 1. 建部门 D
  const dept = await api('POST', '/departments', { token: at, body: { name: 'QA-KB守卫' + SUF } });
  check('建部门', dept.code === 0, dept.data?.id);
  const deptId = dept.data?.id;

  // 2. 建 DEPT 库挂 D
  const kb = await api('POST', '/knowledge', {
    token: at,
    body: { name: 'QA-部门库' + SUF, visibility: 'DEPT', orgId: deptId },
  });
  check('建 DEPT 库挂部门', kb.code === 0 && kb.data?.orgId === deptId, `kb=${kb.data?.id}`);
  const kbId = kb.data?.id;

  // 3. 删部门 → 400 拦截
  const blocked = await api('DELETE', `/departments/${deptId}`, { token: at });
  check(
    '删名下有库的部门被拒（400）',
    blocked.status === 400 && /知识库/.test(blocked.message || ''),
    `msg=${blocked.message}`
  );

  // 4. 迁移库归属（orgId 置空，改回私有）
  const migrate = await api('PUT', `/knowledge/${kbId}`, {
    token: at,
    body: { visibility: 'PRIVATE', orgId: null },
  });
  check('迁移库归属（orgId 置空）', migrate.code === 0, `orgId=${migrate.data?.orgId}`);

  // 5. 删部门 → 成功
  const removed = await api('DELETE', `/departments/${deptId}`, { token: at });
  check('迁移后删部门成功', removed.status < 300, `status=${removed.status}`);

  // 6. 清理 KB
  await api('DELETE', `/knowledge/${kbId}`, { token: at });
  check('清理完成', true, kbId);

  console.log(`\n通过 ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('验证脚本异常：', e); process.exit(1); });
