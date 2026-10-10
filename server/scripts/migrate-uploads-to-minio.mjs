// 一次性迁移脚本：把旧版本地磁盘 uploads/ 目录中的文件搬进 MinIO 桶（幂等，已存在对象自动跳过）
// 背景：v0.9.25 起原始文档统一存 MinIO，本地磁盘存储移除；升级后需执行一次。
//
// 用法一（本地开发，在 server 目录执行，MINIO_* 缺省从 server/.env 读取）：
//   node scripts/migrate-uploads-to-minio.mjs
//
// 用法二（Docker 老版本升级，uploads_data 旧卷还在）：
//   docker run --rm --network kb-prod_default \
//     -v kb-prod_uploads_data:/uploads:ro \
//     -e UPLOAD_ROOT=/uploads \
//     -e MINIO_ENDPOINT=minio:9000 \
//     -e MINIO_ACCESS_KEY=<.env 的 MINIO_ROOT_USER> \
//     -e MINIO_SECRET_KEY=<.env 的 MINIO_ROOT_PASSWORD> \
//     gujinyi666/aiwenda-server:latest node scripts/migrate-uploads-to-minio.mjs
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// minio 为 CJS 包，ESM 下经 createRequire 引入（named export 检测对其不稳定）
const require = createRequire(import.meta.url);
const { Client } = require('minio');

// MINIO_* 环境变量缺省时回退读 .env（./.env 即 server/.env，再退 ../.env 根目录）
function loadEnvFallback() {
  for (const p of [resolve('.env'), resolve('../.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  }
}

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function main() {
  loadEnvFallback();
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!accessKey || !secretKey) {
    console.error('MINIO_ACCESS_KEY / MINIO_SECRET_KEY 未配置（检查环境变量或 server/.env）');
    process.exit(1);
  }
  const bucket = process.env.MINIO_BUCKET || 'kb-documents';
  const uploadRoot = resolve(process.env.UPLOAD_ROOT || './uploads');
  const endpoint = process.env.MINIO_ENDPOINT || '127.0.0.1:9000';
  const sep = endpoint.lastIndexOf(':');
  const client = new Client({
    endPoint: sep > 0 ? endpoint.slice(0, sep) : endpoint,
    port: sep > 0 ? Number(endpoint.slice(sep + 1)) : 9000,
    useSSL: (process.env.MINIO_SECURE || 'false') === 'true',
    accessKey,
    secretKey,
  });

  // 桶不存在则创建（与 server StorageService 启动逻辑一致）
  if (!(await client.bucketExists(bucket).catch(() => false))) {
    await client.makeBucket(bucket);
    console.log(`[OK] created bucket: ${bucket}`);
  }

  if (!existsSync(uploadRoot)) {
    console.log(`[SKIP] no legacy uploads dir: ${uploadRoot}`);
    return;
  }

  let migrated = 0;
  let skipped = 0;
  for (const entry of await readdir(uploadRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // 旧结构：uploads/<kbId>/<doc_xxx>.<ext>
    for (const file of await readdir(join(uploadRoot, entry.name), { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const key = `${entry.name}/${file.name}`;
      // 幂等：桶里已有该对象则跳过（重复执行安全）
      if (await client.statObject(bucket, key).then(() => true).catch(() => false)) {
        skipped++;
        continue;
      }
      const abs = join(uploadRoot, entry.name, file.name);
      const info = await stat(abs);
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      await client.putObject(bucket, key, await readFile(abs), info.size, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      });
      migrated++;
      console.log(`[OK] ${key} (${info.size} bytes)`);
    }
  }
  console.log(`[DONE] migrated=${migrated} skipped=${skipped}`);
}

main().catch((err) => {
  console.error('[FAIL]', err?.message ?? err);
  process.exit(1);
});
