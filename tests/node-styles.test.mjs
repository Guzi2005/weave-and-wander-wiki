import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateNodeStylesManifest, safeNodeStyleAsset, classifyNodeStyle, formatParameter,
  EXPECTED_NODE_STYLE_IDS, NODE_STYLES_SCHEMA, BRAID_REFERENCE_P1,
} from '../public/node-styles.js';
import { applyStyleUpdate, normalizeMosuoLabel, stylePatch, PHOTO_ID, HEADWEAR_ID } from '../import-mosuo-style-update.mjs';

const seed = JSON.parse(readFileSync(new URL('../seed/records.json', import.meta.url), 'utf8'));

function validManifest() {
  return {
    schema: NODE_STYLES_SCHEMA,
    title: '发型节点样式对比',
    description: '程序化发型节点的并排比较。',
    entries: EXPECTED_NODE_STYLE_IDS.map((id) => ({
      id,
      label: `样式 ${id}`,
      image: `/assets/node-styles/${id}.png`,
      recipe: `/assets/node-styles/${id}.tres`,
      parameters: { loop_count: 2, braid_radius: 0.03, tightness: '中' },
      evidence_status: '通用',
      note: '备注。',
    })),
  };
}

test('manifest validation accepts ww-node-styles-v1 and rejects schema/field deviations', () => {
  assert.equal(validateNodeStylesManifest(validManifest()).entries.length, 6);
  assert.throws(() => validateNodeStylesManifest(null), /JSON 对象/);
  assert.throws(() => validateNodeStylesManifest({ ...validManifest(), schema: 'other' }), /schema/);
  assert.throws(() => validateNodeStylesManifest({ ...validManifest(), entries: [] }), /entries/);
  const missing = validManifest();
  missing.entries = missing.entries.filter((e) => e.id !== 'legacy-single');
  assert.throws(() => validateNodeStylesManifest(missing), /legacy-single/);
  const dup = validManifest();
  dup.entries[1] = { ...dup.entries[1], id: 'legacy-single' };
  assert.throws(() => validateNodeStylesManifest(dup), /重复/);
  const badParams = validManifest();
  badParams.entries[0].parameters = [1, 2];
  assert.throws(() => validateNodeStylesManifest(badParams), /parameters/);
});

test('asset paths are confined to /assets/node-styles with the matching extension', () => {
  assert.equal(safeNodeStyleAsset('/assets/node-styles/double-yak.png', 'image'), '/assets/node-styles/double-yak.png');
  assert.equal(safeNodeStyleAsset('/assets/node-styles/double-yak.tres', 'recipe'), '/assets/node-styles/double-yak.tres');
  assert.equal(safeNodeStyleAsset('/assets/node-styles/double-yak.tres', 'image'), null);
  assert.equal(safeNodeStyleAsset('/assets/node-styles/double-yak.png', 'recipe'), null);
  assert.equal(safeNodeStyleAsset('/assets/models/double-yak.png', 'image'), null);
  assert.equal(safeNodeStyleAsset('/assets/node-styles/../secret.png', 'image'), null);
  assert.equal(safeNodeStyleAsset('https://example.com/x.png', 'image'), null);
  const badImage = validManifest();
  badImage.entries[0].image = '/assets/source.png';
  assert.throws(() => validateNodeStylesManifest(badImage), /image/);
  const badRecipe = validManifest();
  badRecipe.entries[0].recipe = '/media/x.tres';
  assert.throws(() => validateNodeStylesManifest(badRecipe), /recipe/);
});

test('legacy-single is the preserved old style, double-yak the only photo-informed adaptation, the rest generic', () => {
  assert.equal(classifyNodeStyle('legacy-single').kind, 'legacy');
  assert.equal(classifyNodeStyle('double-yak').kind, 'photo-informed');
  assert.match(classifyNodeStyle('legacy-single').label, /旧版保留/);
  assert.match(classifyNodeStyle('double-yak').label, /非民族志分类/);
  for (const id of ['double-loose', 'double-dense', 'single-copper', 'double-soft']) {
    assert.equal(classifyNodeStyle(id).kind, 'generic');
    assert.match(classifyNodeStyle(id).label, /通用程序化发型节点/);
  }
});

test('length parameters render with model-metre units and Chinese labels', () => {
  assert.deepEqual(formatParameter('braid_radius', 0.03), ['辫体半径', '0.03 m（模型米）']);
  assert.deepEqual(formatParameter('loop_count', 2), ['盘绕圈数', '2']);
  assert.deepEqual(formatParameter('unknown_key', 1.5), ['unknown_key', '1.5']);
});

test('style update is idempotent and preserves arbitrary user records and source objects', () => {
  const records = structuredClone(seed.records);
  records.push({ id: 'WW-L-UNRELATED', title: '其他项目记录（摩梭服饰字样保留）', notes: '用户笔记', revision: 91 });
  const video = records.find(r => r.collection_id === 'mosuo_video_002');
  video.id = 'WW-L-EXISTING-VIDEO';
  const once = applyStyleUpdate(records, '2026-10-29T06:00:00Z');
  const twice = applyStyleUpdate(once, '2026-11-01T06:00:00Z');
  assert.deepEqual(twice, once);
  const unrelated = twice.find(r => r.id === 'WW-L-UNRELATED');
  assert.equal(unrelated.title, '其他项目记录（摩梭服饰字样保留）');
  assert.equal(unrelated.revision, 91);
  for (const record of records) {
    const after = twice.find(r => r.id === record.id);
    if (record.collection_id === 'mosuo_photo_001' || record.collection_id === 'mosuo_video_002') {
      assert.deepEqual(after.source, record.source);
    } else if (record.id === 'WW-L-UNRELATED') {
      assert.deepEqual(after, record);
    }
  }
  assert.deepEqual(stylePatch(once[0], twice[0]), {});
});

test('author-owned labels normalized while source title and verbatim strings stay intact', () => {
  assert.equal(normalizeMosuoLabel('摩梭服饰套装'), '摩梭人服饰套装');
  assert.equal(normalizeMosuoLabel('摩梭套装整体'), '摩梭人套装整体');
  assert.equal(normalizeMosuoLabel('摩梭族服饰'), '摩梭人服饰');
  assert.equal(normalizeMosuoLabel('摩梭民族'), '摩梭人');
  assert.equal(normalizeMosuoLabel('摩梭人服饰'), '摩梭人服饰');
  assert.equal(normalizeMosuoLabel('什么是真正的摩梭？'), '什么是真正的摩梭？');

  const records = applyStyleUpdate(structuredClone(seed.records), '2026-10-29T06:00:00Z');
  const photo = records.find(r => r.id === PHOTO_ID);
  assert.equal(photo.title, '摩梭人服饰套装');
  assert.match(photo.notes, /摩梭人服饰/);
  const video = records.find(r => r.collection_id === 'mosuo_video_002');
  assert.match(video.title, /^摩梭人服饰补充影像｜什么是真正的摩梭？$/);
  assert.ok(video.observations.some(s => s.includes('字幕称摩梭人将母亲称为“阿咪”')), '字幕转写原文保留');
  assert.equal(video.source.author, '时差岛');
});

test('P1 media registered on C01 with legacy-loop and rendering notes; revisions bump only on change', () => {
  const before = structuredClone(seed.records);
  const records = applyStyleUpdate(before, '2026-10-29T06:00:00Z');
  const head = records.find(r => r.id === HEADWEAR_ID);
  const headBefore = before.find(r => r.id === HEADWEAR_ID);
  const p1 = head.media.filter(m => m.path === BRAID_REFERENCE_P1);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].role, 'source');
  assert.match(p1[0].label, /不同穿戴者/);
  assert.ok(head.observations.some(s => s.includes('单圈盘旋') && s.includes('legacy-single')));
  assert.ok(head.observations.some(s => s.includes('牦牛毛辫') && s.includes('盘绕两圈')));
  assert.match(head.notes, /P1 与照片001为不同穿戴者/);
  const photo = records.find(r => r.id === PHOTO_ID);
  const photoBefore = before.find(r => r.id === PHOTO_ID);
  assert.ok(photo.observations.some(s => s.includes('平面赛璐璐着色') && s.includes('织物材质研究')));
  assert.equal(head.revision, (headBefore.revision || 1) + Number(Object.keys(stylePatch(headBefore,head)).length > 0));
  assert.equal(photo.revision, (photoBefore.revision || 1) + Number(Object.keys(stylePatch(photoBefore,photo)).length > 0));
  assert.equal(head.created_at, headBefore.created_at);
  const gen = records.find(r => r.id === 'WW-GEN-001');
  assert.deepEqual(gen, before.find(r => r.id === 'WW-GEN-001'));
});
