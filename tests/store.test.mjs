// 数据层测试：种子加载、持久化往返、原子写、字段校验。使用临时目录，不触碰真实数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, ValidationError } from '../lib/store.mjs';

const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'records.json');
// 计数断言一律从种子实时推导，不硬编码条数；核心服装部件 C01–C03 固定为 3 件，
// 手工对象（如 WW-MOS-001-P01 鞋垫）若被种子收录则单独断言，不计入服装部件数。
const SEED_RECORDS = JSON.parse(readFileSync(SEED_FILE, 'utf8')).records;
const SEED_COUNT = SEED_RECORDS.length;
const CORE_GARMENT_IDS = ['WW-MOS-001-C01', 'WW-MOS-001-C02', 'WW-MOS-001-C03'];

function expectQueryCount(q) {
  const needle = q.toLowerCase();
  return SEED_RECORDS.filter((r) => [r.id, r.title, r.notes, r.culture?.text, r.place, r.collection_id]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle))).length;
}

function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ww-wiki-test-'));
  const dataFile = path.join(dir, 'records.json');
  const store = createStore({ dataFile, seedFile: SEED_FILE });
  store.load();
  return { store, dir, dataFile };
}

test('种子加载：记录数取自种子，母条目带核心服装部件', () => {
  const { store, dir } = makeStore();
  try {
    assert.equal(store.count(), SEED_COUNT);
    const found = store.get('WW-MOS-001');
    assert.ok(found);
    const childIds = found.children.map((c) => c.id);
    assert.deepEqual(
      childIds.filter((id) => CORE_GARMENT_IDS.includes(id)).sort(),
      CORE_GARMENT_IDS,
      '核心服装部件 C01–C03 保持 3 件',
    );
    assert.equal(
      found.children.length,
      SEED_RECORDS.filter((r) => r.parent_id === 'WW-MOS-001').length,
      '子条目数与种子中的 parent_id 关系统一致',
    );
    // 手工对象（如鞋垫 P01）若已被种子收录：是独立部件，不计入核心服装部件，也不是通用鞋履。
    if (childIds.includes('WW-MOS-001-P01')) {
      const insole = store.get('WW-MOS-001-P01').record;
      assert.equal(insole.parent_id, 'WW-MOS-001');
      assert.ok(!CORE_GARMENT_IDS.includes(insole.id));
      assert.notEqual(insole.id, 'WW-GEN-001');
    }
    assert.equal(found.record.collection_id, 'mosuo_photo_001');
    // 头饰与紫色种子珠串为同一部件（用户更正），无独立垂饰条目。
    assert.ok(!store.list().some((r) => r.id === 'WW-MOS-001-C04'));
    const headwear = store.get('WW-MOS-001-C01').record;
    assert.match(headwear.notes, /同一部件/);
    // 通用鞋履独立记录，无文化归属、无母条目。
    const shoes = store.get('WW-GEN-001').record;
    assert.equal(shoes.culture, null);
    assert.equal(shoes.parent_id, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('创建记录并持久化：新实例从文件读回', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const created = store.create({ title: '测试线索', category: '布艺', notes: '一块可能的织样' });
    assert.match(created.id, /^WW-L-/);
    const onDisk = JSON.parse(readFileSync(dataFile, 'utf8'));
    assert.equal(onDisk.records.length, SEED_COUNT + 1);
    const reloaded = createStore({ dataFile, seedFile: SEED_FILE });
    reloaded.load();
    const found = reloaded.get(created.id);
    assert.equal(found.record.title, '测试线索');
    assert.equal(found.record.status, '待整理');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('原子写：写入后不存在残留临时文件', () => {
  const { store, dir } = makeStore();
  try {
    store.create({ title: '临时文件检查' });
    assert.equal(existsSync(path.join(dir, 'records.json.tmp')), false);
    assert.equal(existsSync(path.join(dir, 'records.json')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('校验：拒绝非法类别、伪造网址、超长标题', () => {
  const { store, dir } = makeStore();
  try {
    assert.throws(() => store.create({ category: '武器' }), ValidationError);
    assert.throws(() => store.create({ source_url: 'javascript:alert(1)' }), ValidationError);
    assert.throws(() => store.create({ title: '长'.repeat(200) }), ValidationError);
    assert.throws(() => store.create({ parent_id: 'WW-NOPE-404' }), ValidationError);
    assert.equal(store.count(), SEED_COUNT, '被拒绝的写入不得改变记录数');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PATCH：可编辑字段更新并刷新 updated_at，未知字段被忽略', () => {
  const { store, dir } = makeStore();
  try {
    const before = store.get('WW-MOS-001').record;
    const patched = store.patch('WW-MOS-001', {
      title: '摩梭服饰套装（修订）',
      status: '考证中',
      culture_text: '摩梭（用户提供，文献核验中）',
      hacker: '<script>alert(1)</script>',
    });
    assert.equal(patched.title, '摩梭服饰套装（修订）');
    assert.equal(patched.status, '考证中');
    assert.equal(patched.culture.text, '摩梭（用户提供，文献核验中）');
    assert.equal(patched.hacker, undefined);
    assert.ok(patched.updated_at >= before.updated_at);
    assert.throws(() => store.patch('WW-MOS-001', { status: '已发布' }), ValidationError);
    assert.equal(store.patch('WW-NOPE', { title: 'x' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('检索：关键词、类别、状态独立过滤', () => {
  const { store, dir } = makeStore();
  try {
    assert.ok(store.list({ q: '褶裙' }).length >= 1);
    assert.equal(store.list({ q: '褶裙' }).length, expectQueryCount('褶裙'));
    assert.equal(store.list({ category: '饰品' }).length, SEED_RECORDS.filter((r) => r.category === '饰品').length);
    assert.equal(store.list({ status: '待考证' }).length, SEED_RECORDS.filter((r) => r.status === '待考证').length);
    assert.equal(store.list({ q: 'mosuo_photo_001' }).length, expectQueryCount('mosuo_photo_001'));
    assert.equal(store.list({ q: '不存在的词' }).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 ID 创建：稳定 ID 持久化，新实例从文件读回', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const created = store.create({
      id: 'WW-TEST-900-A01',
      title: '手工对象线索',
      category: '布艺',
      parent_id: 'WW-MOS-001',
    });
    assert.equal(created.id, 'WW-TEST-900-A01');
    assert.equal(created.revision, 1);
    assert.equal(created.status, '待整理');
    const onDisk = JSON.parse(readFileSync(dataFile, 'utf8'));
    assert.equal(onDisk.records.length, SEED_COUNT + 1);
    assert.ok(onDisk.records.some((r) => r.id === 'WW-TEST-900-A01'));
    const reloaded = createStore({ dataFile, seedFile: SEED_FILE });
    reloaded.load();
    const found = reloaded.get('WW-TEST-900-A01');
    assert.equal(found.record.title, '手工对象线索');
    assert.equal(found.record.parent_id, 'WW-MOS-001');
    assert.ok(reloaded.get('WW-MOS-001').children.some((c) => c.id === 'WW-TEST-900-A01'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 ID 冲突：ValidationError，不覆盖既有记录、不落盘', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const before = store.get('WW-MOS-001').record;
    const beforeFile = readFileSync(dataFile, 'utf8');
    // 与种子既有 ID 冲突
    assert.throws(() => store.create({ id: 'WW-MOS-001', title: '冒充套装' }), ValidationError);
    assert.equal(store.count(), SEED_COUNT);
    assert.equal(store.get('WW-MOS-001').record.title, before.title);
    assert.equal(store.get('WW-MOS-001').record.revision, before.revision);
    assert.equal(readFileSync(dataFile, 'utf8'), beforeFile, '冲突拒绝不得改写文件');
    // 同会话内自定义 ID 之间同样不可重复
    store.create({ id: 'WW-TEST-900-B01', title: '第一条' });
    assert.throws(() => store.create({ id: 'WW-TEST-900-B01', title: '第二条' }), ValidationError);
    assert.equal(store.get('WW-TEST-900-B01').record.title, '第一条');
    assert.equal(store.count(), SEED_COUNT + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 ID 格式校验：malformed 一律拒绝，不落盘', () => {
  const { store, dir, dataFile } = makeStore();
  try {
    const beforeFile = readFileSync(dataFile, 'utf8');
    const malformed = [
      123,                 // 非字符串
      '',                  // 空串
      '   ',               // 纯空白
      'mos-001',           // 缺 WW- 前缀且小写
      'ww-mos-001',        // 小写
      'WW-',               // 空分段
      'WW--MOS',           // 空中间段
      'WW-MOS-',           // 尾部分隔符
      'WW-MOS 001',        // 空格
      'WW-MOS_001',        // 下划线
      'WW-中文',            // 非 ASCII
      `WW-${'A'.repeat(58)}`, // 超过 60 字符上限
    ];
    for (const bad of malformed) {
      assert.throws(() => store.create({ id: bad, title: 'x' }), ValidationError, `应拒绝：${String(bad)}`);
    }
    assert.equal(store.count(), SEED_COUNT);
    assert.equal(readFileSync(dataFile, 'utf8'), beforeFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('无 ID 创建保持随机 WW-L 行为；PATCH 不可改 ID', () => {
  const { store, dir } = makeStore();
  try {
    const a = store.create({ title: '随机一' });
    const b = store.create({ title: '随机二', id: undefined });
    const c = store.create({ title: '随机三', id: null });
    for (const r of [a, b, c]) assert.match(r.id, /^WW-L-/);
    assert.notEqual(a.id, b.id);
    // patch 中的 id 字段被忽略，ID 不可变
    const patched = store.patch('WW-MOS-001', { id: 'WW-HACK-1' });
    assert.equal(patched.id, 'WW-MOS-001');
    assert.equal(store.get('WW-HACK-1'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
