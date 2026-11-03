// Node-style update: user label corrections, braid reference P1 registration, and rendering notes.
// Pure idempotent transform exported for tests; runtime changes go through the localhost API as
// PATCH diffs only — runtime JSON is never overwritten. Mirrors import-mosuo-research.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAID_REFERENCE_P1 } from './public/node-styles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PHOTO_ID = 'WW-MOS-001';
export const HEADWEAR_ID = 'WW-MOS-001-C01';
export const BRAID_REF_PATH = BRAID_REFERENCE_P1;
const PHOTO_COLLECTION = 'mosuo_photo_001';
const VIDEO_COLLECTION = 'mosuo_video_002';

// 用户更正（2026-10-29）：作者自拟标签改用“摩梭人…”表述。
// 不改动来源标题《什么是真正的摩梭？》、字幕转写原文与 source 对象。
export function normalizeMosuoLabel(text) {
  if (typeof text !== 'string') return text;
  return text
    .replaceAll('摩梭民族', '摩梭人')
    .replaceAll('摩梭族', '摩梭人')
    .replace(/(?<!人)摩梭服饰/g, '摩梭人服饰')
    .replace(/(?<!人)摩梭套装/g, '摩梭人套装');
}

const appendUnique = (values, additions) => [...new Set([...(values || []), ...additions])];
const addNote = (notes, addition) => (notes || '').includes(addition) ? notes : [notes, addition].filter(Boolean).join('\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HEAD_NOTE = '用户更正与参考（2026-10-29）｜新增发型参考图 P1（/assets/mosuo-braid-reference-003.png）：用户识别其中为超粗牦牛毛辫、盘绕两圈的发型；P1 与照片001为不同穿戴者。可见几何用于 double-yak 程序化发型节点适配；照片001头饰的纤维未独立鉴定，不把 P1 的材料断言移植到照片001。';
const HEAD_OBSERVATIONS = [
  '用户澄清｜参考图 P1 中的发型为超粗牦牛毛辫盘绕两圈；P1 与照片001不是同一穿戴者，仅取可见几何作建模参考，原照片001的纤维未独立识别。',
  '制作决定｜旧版单圈盘旋（legacy-single）保留为游戏支持的通用程序化发型节点，是对旧资产的保留，并非真实传统发式的断言。',
  '制作决定｜double-yak 为参考 P1 摩梭人案例的照片参考适配，不作民族志分类；其余变体均为无文化归属的通用程序化发型节点。',
];
const PHOTO_NOTE = '用户更正与参考（2026-10-29）｜发型参考图 P1 登记于 C01；P1 与照片001为不同穿戴者。游戏内穿戴资产采用共享的平面赛璐璐着色；织物材质研究单独保留，不并入穿戴模型。';
const RENDER_OBSERVATION = '制作决定｜游戏支持的渲染方式：穿戴资产统一使用共享平面赛璐璐着色；织物材质研究作为独立课题保留，游戏渲染效果不构成原物材质证据。';

export function applyStyleUpdate(records, now = new Date().toISOString()) {
  const result = structuredClone(records);
  const photo = result.find(r => r.id === PHOTO_ID);
  const head = result.find(r => r.id === HEADWEAR_ID);
  if (!photo || !head) throw new Error('Missing mosuo photo records; run import-mosuo-video.mjs and import-mosuo-research.mjs first.');

  // 仅更正已知摩梭记录的作者自拟文字（标题／文化归属文字／笔记／观察／媒体图注）；source 对象逐字节保留。
  for (const record of result) {
    if (record.collection_id !== PHOTO_COLLECTION && record.collection_id !== VIDEO_COLLECTION) continue;
    record.title = normalizeMosuoLabel(record.title);
    record.notes = normalizeMosuoLabel(record.notes);
    record.observations = (record.observations || []).map(normalizeMosuoLabel);
    if (record.culture && typeof record.culture.text === 'string') {
      record.culture = { ...record.culture, text: normalizeMosuoLabel(record.culture.text) };
    }
    record.media = (record.media || []).map(m => ({ ...m, label: normalizeMosuoLabel(m.label) }));
  }

  head.notes = addNote(head.notes, HEAD_NOTE);
  head.observations = appendUnique(head.observations, HEAD_OBSERVATIONS);
  if (!(head.media || []).some(m => m.path === BRAID_REF_PATH)) {
    head.media = [...(head.media || []), {
      path: BRAID_REF_PATH,
      role: 'source',
      label: '参考图 P1：超粗牦牛毛辫盘绕两圈（用户识别，与照片001为不同穿戴者）',
      focus: { x: 50, y: 50 },
    }];
  }
  photo.notes = addNote(photo.notes, PHOTO_NOTE);
  photo.observations = appendUnique(photo.observations, [RENDER_OBSERVATION]);

  // 仅在内容实际变化时增加修订号与修改时间；无变化不空增。
  for (const record of result) {
    const before = records.find(r => r.id === record.id);
    if (before && !same(before, record)) {
      record.revision = (before.revision || 1) + 1;
      record.updated_at = now;
    }
  }
  return result;
}

export function stylePatch(before, after) {
  const patch = {};
  for (const key of ['title', 'notes', 'observations', 'media']) if (!same(before[key], after[key])) patch[key] = after[key];
  if (!same(before.culture, after.culture)) patch.culture_text = after.culture ? after.culture.text : '';
  return patch;
}

export async function importStyleUpdate({ baseUrl = 'http://127.0.0.1:4318', seedOnly = false } = {}) {
  const now = new Date().toISOString();
  const seedPath = path.join(here, 'seed/records.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  seed.records = applyStyleUpdate(seed.records, now);
  const serialized = JSON.stringify(seed, null, 2) + '\n';
  if (serialized !== readFileSync(seedPath, 'utf8')) writeFileSync(seedPath, serialized);
  if (seedOnly) return { seedRecords: seed.records.length };

  const api = async (route, method = 'GET', body) => {
    const response = await fetch(baseUrl + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const dump = await api('/export');
  const next = applyStyleUpdate(dump.records, now);
  let changedRecords = 0;
  for (const record of next) {
    const before = dump.records.find(r => r.id === record.id);
    if (!before) continue; // 不创建新记录；缺失的已知记录由既有导入脚本负责。
    const patch = stylePatch(before, record);
    if (Object.keys(patch).length) { await api(`/records/${record.id}`, 'PATCH', patch); changedRecords++; }
  }
  return { changedRecords, photoRecordId: PHOTO_ID, headwearRecordId: HEADWEAR_ID, braidReference: BRAID_REF_PATH };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('MOSUO_STYLE_UPDATE_IMPORTED', await importStyleUpdate({ seedOnly: process.argv.includes('--seed-only') }));
}
