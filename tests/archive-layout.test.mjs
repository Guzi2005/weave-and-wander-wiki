import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchiveEntries, pickThumbMedia } from '../public/archive-layout.js';

const SOURCE_IMG = { path: '/media/source.png', role: 'source', label: '原始照片', focus: { x: 50, y: 50 } };
const GENERATED_IMG = { path: '/media/concept.png', role: 'generated_concept', label: '生成概念', focus: { x: 50, y: 50 } };

function rec(id, overrides = {}) {
  return {
    id,
    title: `记录 ${id}`,
    record_type: 'object',
    category: '服装',
    status: '待考证',
    parent_id: null,
    media: [SOURCE_IMG],
    ...overrides,
  };
}

const ensemble = rec('WW-MOS-001', { title: '摩梭人套装', record_type: 'ensemble' });
const headwear = rec('WW-MOS-001-C01', { title: '头饰', record_type: 'component', parent_id: 'WW-MOS-001' });
const top = rec('WW-MOS-001-C02', { title: '上衣', record_type: 'component', parent_id: 'WW-MOS-001' });
const skirt = rec('WW-MOS-001-C03', { title: '长褶裙', record_type: 'component', parent_id: 'WW-MOS-001' });
const insole = rec('WW-MOS-001-P01', { title: '手工鞋垫', record_type: 'object', parent_id: 'WW-MOS-001' });

const allChildren = [headwear, top, skirt, insole];

function entryIds(entries) {
  return entries.flatMap((e) => (e.kind === 'ensemble'
    ? [e.record.id, ...e.components.map((c) => c.id)]
    : [e.record.id]));
}

test('完整命中：套装与部件都匹配时折叠为一张套装卡，部件不重复出现', () => {
  const matched = [ensemble, headwear, top];
  const entries = buildArchiveEntries(matched, { childrenOf: (id) => (id === 'WW-MOS-001' ? allChildren : []) });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'ensemble');
  assert.equal(entries[0].record.id, 'WW-MOS-001');
  assert.deepEqual(entries[0].components.map((c) => c.id), ['WW-MOS-001-C01', 'WW-MOS-001-C02', 'WW-MOS-001-C03']);
  const ids = entryIds(entries);
  assert.equal(new Set(ids).size, ids.length, '不得有重复的顶层记录');
});

test('母条目缺失：部件匹配但套装不在结果中时，部件独立成卡且不查询其子记录', () => {
  const calls = [];
  const entries = buildArchiveEntries([headwear], {
    childrenOf: (id) => { calls.push(id); return allChildren; },
  });
  assert.deepEqual(entries, [{ kind: 'record', record: headwear }]);
  assert.deepEqual(calls, [], '结果中没有套装时不应拉取子记录');
});

test('类别筛选激活：即使套装命中也不折叠，匹配部件独立展示', () => {
  const entries = buildArchiveEntries([ensemble, headwear], {
    categoryFilterActive: true,
    childrenOf: () => allChildren,
  });
  assert.deepEqual(entries.map((e) => [e.kind, e.record.id]), [
    ['record', 'WW-MOS-001'],
    ['record', 'WW-MOS-001-C01'],
  ]);
});

test('关联独立单件：record_type 为 object 的手工对象不并入套装部件', () => {
  const entries = buildArchiveEntries([ensemble, insole], {
    childrenOf: () => allChildren,
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, 'ensemble');
  assert.deepEqual(entries[0].components.map((c) => c.id), ['WW-MOS-001-C01', 'WW-MOS-001-C02', 'WW-MOS-001-C03']);
  assert.deepEqual(entries[1], { kind: 'record', record: insole });
  const ids = entryIds(entries);
  assert.equal(ids.filter((id) => id === 'WW-MOS-001-P01').length, 1, '鞋垫恰好出现一次');
});

test('无遗漏无重复：未命中的部件随套装补全，命中的部件只出现一次', () => {
  const matched = [ensemble, headwear, insole];
  const childrenWithDup = [headwear, headwear, top, insole];
  const entries = buildArchiveEntries(matched, { childrenOf: () => childrenWithDup });
  const ids = entryIds(entries);
  assert.deepEqual(ids.sort(), ['WW-MOS-001', 'WW-MOS-001-C01', 'WW-MOS-001-C02', 'WW-MOS-001-P01'].sort());
  assert.equal(new Set(ids).size, ids.length);
  // 计数语义：匹配记录数不变，与分组卡片数无关（由调用方使用 data.count）。
  assert.equal(matched.length, 3);
});

test('无部件套装：拉取不到 component 时退化为普通卡片', () => {
  const entries = buildArchiveEntries([ensemble], { childrenOf: () => [insole] });
  assert.deepEqual(entries, [{ kind: 'record', record: ensemble }]);
});

test('pickThumbMedia 优先原始证据，生成概念不得冒充原图', () => {
  assert.equal(pickThumbMedia([GENERATED_IMG, SOURCE_IMG]), SOURCE_IMG);
  assert.equal(pickThumbMedia([SOURCE_IMG]), SOURCE_IMG);
  assert.equal(pickThumbMedia([GENERATED_IMG]), null, '只有生成概念时不得用作缩略图');
  assert.equal(pickThumbMedia([]), null);
  assert.equal(pickThumbMedia(null), null);
  assert.equal(pickThumbMedia(undefined), null);
});
