// 验证脚本共享：加载 server/.env 并读取必需环境变量（缺失即报错退出，避免凭据硬编码进代码库）
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ 缺少环境变量 ${name}：请在 server/.env 中配置后重试`);
    process.exit(1);
  }
  return v;
}

module.exports = { requiredEnv };
