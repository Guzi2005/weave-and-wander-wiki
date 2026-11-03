// HTTP 路由测试：记录 PATCH 回滚、题目创建/审定/导出流程。端口 0 随机分配，数据在临时目录。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.mjs';
import { buildServer } from '../server.mjs';

const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'records.json');

let server;
let base;
let dir;
let dataFile;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ww-wiki-http-'));
  dataFile = path.join(dir, 'records.json');
  const store = createStore({ dataFile, seedFile: SEED_FILE });
  store.load();
  server = buildServer(store, { mediaDir: path.join(dir, 'media') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const jsonHeaders = { 'Content-Type': 'application/json' };

function questionBody(overrides = {}) {
  return {
    record_id: 'WW-MOS-001',
    prompt: '图中裙摆褶皱走向如何？',
    options: ['纵向细密褶', '横向宽褶'],
    correct_index: 0,
    explanation: '原图可见纵向细密褶。',
    evidence_note: '依据原始照片观察。',
    evidence_kind: 'image_observation',
    ...overrides,
  };
}

test('PATCH 记录含非法字段：422，内存与文件均回滚', async () => {
  const beforeFile = readFileSync(dataFile, 'utf8');
  const res = await fetch(`${base}/api/records/WW-MOS-001`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ title: '应被回滚的标题', category: '不存在的类别' }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.error);
  const read = await (await fetch(`${base}/api/records/WW-MOS-001`)).json();
  assert.notEqual(read.record.title, '应被回滚的标题');
  assert.equal(readFileSync(dataFile, 'utf8'), beforeFile);
});

test('PATCH 母条目构成循环：422 且不改变数据', async () => {
  const beforeFile = readFileSync(dataFile, 'utf8');
  const res = await fetch(`${base}/api/records/WW-MOS-001`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ parent_id: 'WW-MOS-001-C01' }),
  });
  assert.equal(res.status, 422);
  const read = await (await fetch(`${base}/api/records/WW-MOS-001`)).json();
  assert.equal(read.record.parent_id, null);
  assert.equal(readFileSync(dataFile, 'utf8'), beforeFile);
});

test('PATCH 附加非法媒体路径：422 且 media 不变', async () => {
  const before = await (await fetch(`${base}/api/records/WW-MOS-001`)).json();
  const res = await fetch(`${base}/api/records/WW-MOS-001`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ media: [{ path: 'javascript:alert(1)', role: 'source' }] }),
  });
  assert.equal(res.status, 422);
  const after = await (await fetch(`${base}/api/records/WW-MOS-001`)).json();
  assert.deepEqual(after.record.media, before.record.media);
  assert.equal(after.record.revision, before.record.revision);
});

test('题目生命周期：草稿不导出 → 审定需 reviewer → 记录变更后过期 → 复审恢复', async () => {
  // 创建草稿
  const created = await fetch(`${base}/api/questions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(questionBody()),
  });
  assert.equal(created.status, 201);
  const { question: draft } = await created.json();
  assert.equal(draft.status, 'draft');

  let exported = await (await fetch(`${base}/api/game-export`)).json();
  assert.ok(!exported.questions.some((q) => q.id === draft.id), '草稿不得出现在游戏导出中');

  // 缺少 reviewer 的审定被拒绝
  const noReviewer = await fetch(`${base}/api/questions/${draft.id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(noReviewer.status, 422);

  // 带 reviewer 的审定通过，证据修订为当前记录修订号
  const recordNow = await (await fetch(`${base}/api/records/WW-MOS-001`)).json();
  const approved = await fetch(`${base}/api/questions/${draft.id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ status: 'approved', reviewed_by: '测试审校' }),
  });
  assert.equal(approved.status, 200);
  const { question: approvedQ } = await approved.json();
  assert.equal(approvedQ.record_revision, recordNow.record.revision);

  exported = await (await fetch(`${base}/api/game-export`)).json();
  assert.ok(exported.questions.some((q) => q.id === draft.id), '已审定且证据修订一致的题目应被导出');

  // 记录修订号前进 → 题目过期、被排除
  const bump = await fetch(`${base}/api/records/WW-MOS-001`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ notes: '补充笔记以推进修订号' }),
  });
  assert.equal(bump.status, 200);
  exported = await (await fetch(`${base}/api/game-export`)).json();
  assert.ok(!exported.questions.some((q) => q.id === draft.id), '记录变更后题目应被排除');
  assert.ok(exported.excluded.stale >= 1);
  const staleList = await (await fetch(`${base}/api/questions?status=approved`)).json();
  assert.equal(staleList.questions.find((q) => q.id === draft.id).needs_review, true);

  // 复审使用当前记录修订号，恢复导出
  const reapproved = await fetch(`${base}/api/questions/${draft.id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ status: 'approved', reviewed_by: '测试审校' }),
  });
  assert.equal(reapproved.status, 200);
  const { question: reapprovedQ } = await reapproved.json();
  const recordBumped = await (await fetch(`${base}/api/records/WW-MOS-001`)).json();
  assert.equal(reapprovedQ.record_revision, recordBumped.record.revision);
  exported = await (await fetch(`${base}/api/game-export`)).json();
  assert.ok(exported.questions.some((q) => q.id === draft.id), '复审后应恢复导出');

  // 编辑已审定题目但不重申状态 → 退回草稿并退出导出
  const edited = await fetch(`${base}/api/questions/${draft.id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ prompt: '修订后的题干' }),
  });
  assert.equal(edited.status, 200);
  const { question: editedQ } = await edited.json();
  assert.equal(editedQ.status, 'draft');
  assert.equal(editedQ.reviewed_by, null);
  exported = await (await fetch(`${base}/api/game-export`)).json();
  assert.ok(!exported.questions.some((q) => q.id === draft.id));
});

test('非法题目编辑：422，读回内容不变', async () => {
  const created = await fetch(`${base}/api/questions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(questionBody({ status: 'approved', reviewed_by: '测试审校' })),
  });
  assert.equal(created.status, 201);
  const { question } = await created.json();

  const bad = await fetch(`${base}/api/questions/${question.id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ options: ['重复', '重复'], correct_index: 0 }),
  });
  assert.equal(bad.status, 422);

  const read = await (await fetch(`${base}/api/questions/${question.id}`)).json();
  assert.deepEqual(read.question.options, question.options);
  assert.equal(read.question.status, 'approved');
  assert.equal(read.question.revision, question.revision);
});
