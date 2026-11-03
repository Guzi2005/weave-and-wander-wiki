// 服务器测试：写守卫、路径穿越防护、媒体魔数校验、API 往返。端口 0 随机分配，不占用 4318。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { createStore } from '../lib/store.mjs';
import { buildServer } from '../server.mjs';

const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'records.json');
// 条数断言从种子实时推导，不硬编码；核心服装部件 C01–C03 固定为 3 件。
const SEED_RECORDS = JSON.parse(readFileSync(SEED_FILE, 'utf8')).records;
const SEED_COUNT = SEED_RECORDS.length;
const CORE_GARMENT_IDS = ['WW-MOS-001-C01', 'WW-MOS-001-C02', 'WW-MOS-001-C03'];

// 1x1 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let base;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ww-wiki-srv-'));
  const store = createStore({ dataFile: path.join(dir, 'records.json'), seedFile: SEED_FILE });
  store.load();
  server = buildServer(store, { mediaDir: path.join(dir, 'media') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test('GET /api/records 返回真实记录数', async () => {
  const res = await fetch(`${base}/api/records`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, SEED_COUNT);
  assert.equal(body.total, SEED_COUNT);
});

test('GET /api/records/:id 返回母条目与子条目', async () => {
  const res = await fetch(`${base}/api/records/WW-MOS-001`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.children.length, SEED_RECORDS.filter((r) => r.parent_id === 'WW-MOS-001').length);
  const childIds = body.children.map((c) => c.id);
  assert.deepEqual(childIds.filter((id) => CORE_GARMENT_IDS.includes(id)).sort(), CORE_GARMENT_IDS, '核心服装部件保持 3 件');
  const missing = await fetch(`${base}/api/records/WW-NOPE`);
  assert.equal(missing.status, 404);
});

test('写守卫：伪造 Host 或跨源 Origin 被拒绝', async () => {
  // fetch 不允许覆盖 Host 头，用原始 http.request 发送伪造 Host。
  const rawPost = (headers) => new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ title: 'x' }));
  });
  assert.equal(await rawPost({ Host: 'evil.example.com' }), 403);

  const badOrigin = await fetch(`${base}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example.com' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(badOrigin.status, 403);
});

test('POST 创建 → PATCH 修改 → GET 读回', async () => {
  const create = await fetch(`${base}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '接口往返', category: '工具', notes: '测试' }),
  });
  assert.equal(create.status, 201);
  const { record } = await create.json();

  const patch = await fetch(`${base}/api/records/${record.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '考证中', place: '待补勿改' }),
  });
  assert.equal(patch.status, 200);

  const read = await fetch(`${base}/api/records/${record.id}`);
  const body = await read.json();
  assert.equal(body.record.status, '考证中');
  assert.equal(body.record.place, '待补勿改');
});

test('校验失败返回 422，不改变记录数', async () => {
  const res = await fetch(`${base}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: '不存在类别' }),
  });
  assert.equal(res.status, 422);
  const list = await (await fetch(`${base}/api/records`)).json();
  assert.equal(list.total, SEED_COUNT + 1); // 上一条测试新增了 1 条
});

test('POST /api/media：魔数校验与生成文件名', async () => {
  const ok = await fetch(`${base}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_base64: PNG_1PX.toString('base64'), mime: 'image/png' }),
  });
  assert.equal(ok.status, 201);
  const saved = await ok.json();
  assert.match(saved.path, /^\/media\/m[a-z0-9]+\.png$/);

  const fake = await fetch(`${base}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_base64: Buffer.from('<script>alert(1)</script>').toString('base64'), mime: 'image/png' }),
  });
  assert.equal(fake.status, 422);
});

test('路径穿越被拦截', async () => {
  const traversal = await fetch(`${base}/../server.mjs`);
  assert.ok([403, 404].includes(traversal.status));
  const encoded = await fetch(`${base}/%2e%2e/%2e%2e/server.mjs`);
  assert.ok([403, 404].includes(encoded.status));
});

test('GET /api/export 返回完整 JSON 备份', async () => {
  const res = await fetch(`${base}/api/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /attachment/);
  const dump = await res.json();
  assert.equal(dump.records.length, SEED_COUNT + 1); // 含此前测试新增的 1 条
});

test('静态页与脚本可访问，附带安全头', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const viewer = await fetch(`${base}/viewer.js`);
  assert.equal(viewer.status, 200);
});
