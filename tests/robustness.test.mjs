// 数据层健壮性测试：失败写入回滚（内存与文件）、母条目循环、媒体校验、题目审定生命周期。
// 使用临时目录，不触碰真实数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, ValidationError } from '../lib/store.mjs';

const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'records.json');

function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ww-wiki-robust-'));
  const dataFile = path.join(dir, 'records.json');
  const store = createStore({ dataFile, seedFile: SEED_FILE });
  store.load();
  return { store, dir, dataFile };
}

function questionInput(overrides = {}) {
  return {
    record_id: 'WW-MOS-001',
    prompt: '图中上衣领口可见什么结构？',
    options: ['立领', '翻领'],
    correct_index: 0,
    explanation: '原图可见立领。',
    evidence_note: '依据原始照片局部观察。',
    evidence_kind: 'image_observation',
    ...overrides,
  };
}

test('PATCH 部分字段非法：内存与文件都回滚，之前合法的字段也不生效', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const before = store.get('WW-MOS-001').record;
    const beforeFile = readFileSync(dataFile, 'utf8');
    assert.throws(
      () => store.patch('WW-MOS-001', { title: '有效但应回滚的标题', status: '不存在的Status' }),
      ValidationError,
    );
    const after = store.get('WW-MOS-001').record;
    assert.equal(after.title, before.title, '内存中的 title 不得被部分应用');
    assert.equal(after.revision, before.revision, '失败 PATCH 不得增加 revision');
    assert.equal(readFileSync(dataFile, 'utf8'), beforeFile, '文件内容不得改变');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('母条目关系：循环（含自引用）被拒绝且不改变数据', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const beforeFile = readFileSync(dataFile, 'utf8');
    // 套装 WW-MOS-001 的母条目指向自己的部件 → 循环
    assert.throws(() => store.patch('WW-MOS-001', { parent_id: 'WW-MOS-001-C01' }), /循环/);
    // 自引用
    assert.throws(() => store.patch('WW-MOS-001-C01', { parent_id: 'WW-MOS-001-C01' }), /循环/);
    // 不存在的母条目
    assert.throws(() => store.patch('WW-GEN-001', { parent_id: 'WW-NOPE' }), ValidationError);
    assert.equal(store.get('WW-MOS-001').record.parent_id, null);
    assert.equal(readFileSync(dataFile, 'utf8'), beforeFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('附加非法媒体被拒绝，记录不发生任何变化', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const before = store.get('WW-MOS-001').record;
    const beforeFile = readFileSync(dataFile, 'utf8');
    assert.throws(() => store.attachMedia('WW-MOS-001', { path: '/etc/passwd' }), ValidationError);
    assert.throws(() => store.attachMedia('WW-MOS-001', { path: '/media/../../server.mjs' }), ValidationError);
    assert.throws(() => store.attachMedia('WW-MOS-001', { path: 'not-a-path' }), ValidationError);
    const after = store.get('WW-MOS-001').record;
    assert.deepEqual(after.media, before.media);
    assert.equal(after.revision, before.revision);
    assert.equal(readFileSync(dataFile, 'utf8'), beforeFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('草稿题目不进游戏导出；批准必须填写 reviewer', () => {
  const { store, dir } = makeStore();
  try {
    const draft = store.createQuestion(questionInput());
    assert.equal(draft.status, 'draft');
    const exported = store.gameExport();
    assert.ok(!exported.questions.some((q) => q.id === draft.id), '草稿不得出现在导出中');
    assert.throws(
      () => store.createQuestion(questionInput({ status: 'approved' })),
      /reviewed_by/,
      '批准题目必须填写 reviewer',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('已审定题目证据修订为当前值时可导出；记录变更后过期并被排除', () => {
  const { store, dir } = makeStore();
  try {
    const record = store.get('WW-MOS-001').record;
    const approved = store.createQuestion(questionInput({ status: 'approved', reviewed_by: '测试审校' }));
    assert.equal(approved.record_revision, record.revision);

    let exported = store.gameExport();
    assert.ok(exported.questions.some((q) => q.id === approved.id), '证据修订一致的已审定题目应被导出');

    // 记录修订号前进后题目过期
    store.patch('WW-MOS-001', { notes: '补充笔记以推进修订号' });
    const bumped = store.get('WW-MOS-001').record.revision;
    exported = store.gameExport();
    assert.ok(!exported.questions.some((q) => q.id === approved.id), '记录变更后题目应被排除');
    assert.ok(exported.excluded.stale >= 1);
    assert.equal(store.getQuestion(approved.id).needs_review, true);

    // 重新审定使用当前记录修订号，恢复可导出
    const reapproved = store.patchQuestion(approved.id, { status: 'approved', reviewed_by: '测试审校' });
    assert.equal(reapproved.record_revision, bumped);
    exported = store.gameExport();
    const again = exported.questions.find((q) => q.id === approved.id);
    assert.ok(again, '重新审定后应恢复导出');
    assert.equal(again.record_revision, bumped);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('编辑已审定题目但未重申状态 → 退回草稿', () => {
  const { store, dir } = makeStore();
  try {
    const approved = store.createQuestion(questionInput({ status: 'approved', reviewed_by: '测试审校' }));
    const edited = store.patchQuestion(approved.id, { prompt: '修订后的题干' });
    assert.equal(edited.status, 'draft');
    assert.equal(edited.reviewed_by, null);
    assert.equal(edited.reviewed_at, null);
    assert.ok(!store.gameExport().questions.some((q) => q.id === approved.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('非法题目编辑回滚：内存与文件均不变', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const approved = store.createQuestion(questionInput({ status: 'approved', reviewed_by: '测试审校' }));
    const before = store.getQuestion(approved.id);
    const beforeFile = readFileSync(dataFile, 'utf8');
    // 重复选项
    assert.throws(() => store.patchQuestion(approved.id, { options: ['相同', '相同'] }), ValidationError);
    // correct_index 越界
    assert.throws(() => store.patchQuestion(approved.id, { correct_index: 9 }), ValidationError);
    // 关联不存在的记录
    assert.throws(() => store.patchQuestion(approved.id, { record_id: 'WW-NOPE' }), ValidationError);
    const after = store.getQuestion(approved.id);
    assert.equal(after.prompt, before.prompt);
    assert.equal(after.status, 'approved');
    assert.equal(after.revision, before.revision);
    assert.equal(readFileSync(dataFile, 'utf8'), beforeFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
