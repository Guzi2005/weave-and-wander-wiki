// Supplement the local archive through its API; never replace runtime user data.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const INSOLE_ID = 'WW-MOS-001-P01';
const PHOTO_ID = 'WW-MOS-001';
const oldHeld = '人物双手持一粉边灰面小物件，与本套装共处一图，暂不建立套装部件关系。';
const held = '用户澄清｜原照片中央人物手持的是灰面、玫红色镶边的鞋垫，单列关联手工对象 WW-MOS-001-P01；不增加为头饰／上衣／长裙之外的第四件服装。';
const oldWaist = '手部、手持物及上衣遮挡了大部分腰部连接处，裙腰结构不可充分判断。';
const waist = '用户澄清与画面观察｜腰部有宽腰带，部分被手、鞋垫和衣身遮挡。模型按可见的暗玫红／灰紫色宽带补齐，纳入上衣资产；背面系结、尺寸与实际织法仍待查。';
const sourceNotes = [
  '视频讲述｜02:10：字幕将羊皮披肩、牦牛尾制作的假发列为画面中服饰的组成。这是本视频的材料说明，尚不能证明原照片001头饰的实际纤维。',
  '视频讲述｜02:12–02:14：镜头展示裙身红线，字幕随后将其解释为祖先迁徙的路线。作为讲述者的文化解释收录，尚未独立核验，也不推定所有摩梭裙装的红线都具有相同含义。',
  '视频讲述｜06:28：字幕称摩梭人将母亲称为“阿咪”。此处保留字幕转写与视频出处；发音、语言／方言范围和学术转写有待语言学材料核对。',
  '画面观察｜07:16：视频以“四合院”示意图介绍建筑布局，图中可读到“经堂”标签；这能支持该视频采用的空间示意，不能代替村落建筑实测。',
  '视频讲述｜07:20：字幕出现“其他人住花楼”。因前后指代尚需完整核对，只作为居住空间研究线索；不据此概括所有家庭的居住制度。',
];
const appendUnique = (values, additions) => [...new Set([...(values || []), ...additions])];
const addNote = (notes, addition) => (notes || '').includes(addition) ? notes : [notes, addition].filter(Boolean).join('\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function supplementRecords(records, now = new Date().toISOString()) {
  const result = structuredClone(records);
  const ref = result.find(r => r.collection_id === 'mosuo_video_002');
  if (!ref) throw new Error('Run import-mosuo-video.mjs first: video source is missing.');
  const byId = id => result.find(r => r.id === id);
  for (const id of [PHOTO_ID, `${PHOTO_ID}-C01`, `${PHOTO_ID}-C02`, `${PHOTO_ID}-C03`]) {
    const record = byId(id);
    if (!record) throw new Error(`Missing source record ${id}`);
    record.title = record.title.replaceAll('种子珠', '米珠');
    record.notes = (record.notes || '').replaceAll('种子珠', '米珠');
    record.observations = (record.observations || []).map(s => s.replaceAll('种子珠', '米珠'));
  }
  const photo = byId(PHOTO_ID);
  photo.observations = appendUnique(photo.observations.map(s => s === oldHeld ? held : s === oldWaist ? waist : s), [held, waist]);
  photo.notes = addNote(photo.notes, '套装核心部件保持 C01 头饰（含紫色米珠串）、C02 上衣（含宽腰带）、C03 长裙。P01 鞋垫为同图关联手工对象；通用基底鞋履 WW-GEN-001 无文化属性。');
  const top = byId(`${PHOTO_ID}-C02`);
  top.observations = appendUnique(top.observations, [waist,
    '制作决定｜依据原图打磨立领、浅色滚边与偏襟结构；蒙古袍和旗袍只作为领型建模的比较参考，不作为这件衣物的名称、来源或文化归属证据。']);
  const head = byId(`${PHOTO_ID}-C01`);
  head.observations = appendUnique(head.observations, [
    '用户澄清｜头花向上开放；长紫色米珠束从后脑收束，经过肩侧自然垂落。结构借鉴视频 V-MOS-002 的不同穿戴实例，原图不可见的连接仍属推演。',
    '制作决定｜头花与紫色米珠束分别通过头骨挂点连接；花瓣层数、花径、杯深、花色和朝向可调。米珠的尺寸、材质、重复单元、串数、紧密度与路径独立控制。']);
  const skirt = byId(`${PHOTO_ID}-C03`);
  skirt.observations = appendUnique(skirt.observations, [
    '用户要求与制作决定｜银线织纹单独控制金属反射，底布保留丝绸光泽；褶脊改为柔软圆弧。银线与底布的具体纤维／工艺尚未鉴定，游戏生成纹理不充当原物证据。']);
  ref.observations = appendUnique(ref.observations, sourceNotes);
  ref.notes = addNote(ref.notes, '本次补记抽帧时间：02:10、02:14、06:28、07:16、07:20。短句指代不足的片段仅保留研究线索；不将视频中的社会制度概括或价值判断自动写为民族志事实。');
  for (const time of [134, 388, 436, 440]) {
    const mediaPath = `/assets/mosuo-video-${time}s.jpg`;
    if (!(ref.media || []).some(m => m.path === mediaPath)) {
      ref.media ??= [];
      ref.media.push({ path: mediaPath, role: 'source', label: `本地视频帧 ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}，时差岛`, focus: { x: 50, y: 50 } });
    }
  }
  if (!byId(INSOLE_ID)) result.push({
    id: INSOLE_ID, title: '玫红镶边灰面鞋垫（关联手工对象）', record_type: 'object', category: '布艺', status: '待考证',
    parent_id: PHOTO_ID, collection_id: 'mosuo_photo_001', culture: null, place: null, date_text: null,
    notes: '名称由用户在本次建模校正中明确：原图人物手持一只玫红色镶边的鞋垫。作为同图关联手工对象收录，不列入头饰／上衣／长裙三件套装，不附加未经证实的文化专属性。实际尺寸、纤维、背面、层数、针法和制作者待查。游戏资产为基于可见轮廓的适配品，不能代替工艺鉴定。',
    observations: ['画面观察｜灰色主体有玫红色缘边，局部被双手遮挡。', '用户澄清｜物件名称为鞋垫。', '制作决定｜手持鞋垫通过手部挂点连接，独立模型 mosuo_insole_001.glb；区别于穿在脚上的通用基底鞋履。'],
    source: { author: null, captured_at: null, place: null, url: null, license: null },
    media: [{ path: '/assets/source.png', role: 'source', label: '原始照片中的手持鞋垫（未改动原图）', focus: { x: 51, y: 41 } }],
    revision: 1, created_at: now, updated_at: now,
  });
  for (const record of result) {
    const before = records.find(r => r.id === record.id);
    if (before && !same(before, record)) {
      record.revision = (before.revision || 1) + 1;
      record.updated_at = now;
    }
  }
  return result;
}

export function researchQuestions(record) {
  return [
    { id: 'WW-Q-MOS-VIDEO-001', prompt: '按《什么是真正的摩梭？》02:10 的字幕讲述，画面中假发使用什么材料？', options: ['牦牛尾', '竹篾', '金属丝'], correct_index: 0,
      explanation: '答案限于该视频在 02:10 的材料说明。此题考查对来源的阅读，不证明照片001的头饰也使用同样材料。', evidence_note: 'V-MOS-002｜02:10｜字幕“羊皮披肩 牦牛尾做的假发”；/assets/mosuo-video-130s.jpg。' },
    { id: 'WW-Q-MOS-VIDEO-002', prompt: '按《什么是真正的摩梭？》06:28 的字幕，视频将母亲的称呼转写为什么？', options: ['阿咪', '阿爸', '阿哥'], correct_index: 0,
      explanation: '视频字幕转写为“阿咪”。本题只要求辨读这一来源；语言／方言覆盖范围、发音与学术转写尚待独立核对。', evidence_note: 'V-MOS-002｜06:28｜字幕“摩梭人把母亲叫做阿咪”；/assets/mosuo-video-388s.jpg。' },
  ].map(q => ({ ...q, record_id: record.id, record_revision: record.revision || 1, evidence_kind: 'source', status: 'draft', reviewed_by: null, reviewed_at: null }));
}

export function recordPatch(before, after) {
  const patch = {};
  for (const key of ['title', 'notes', 'observations', 'media']) if (!same(before[key], after[key])) patch[key] = after[key];
  return patch;
}

export async function importResearch({ baseUrl = 'http://127.0.0.1:4318', seedOnly = false } = {}) {
  for (const time of [134, 388, 436, 440]) {
    const source = path.join(root, `captures/mosuo_video/frame-${time.toFixed(1).padStart(6, '0')}.jpg`);
    if (!existsSync(source)) throw new Error(`Missing verified video frame: ${source}`);
    copyFileSync(source, path.join(here, `public/assets/mosuo-video-${time}s.jpg`));
  }
  const now = new Date().toISOString();
  const seedPath = path.join(here, 'seed/records.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  seed.records = supplementRecords(seed.records, now);
  seed.questions ??= [];
  for (const q of researchQuestions(seed.records.find(r => r.collection_id === 'mosuo_video_002'))) {
    if (!seed.questions.some(existing => existing.id === q.id)) seed.questions.push({ ...q, revision: 1, created_at: now, updated_at: now });
  }
  const serialized = JSON.stringify(seed, null, 2) + '\n';
  if (serialized !== readFileSync(seedPath, 'utf8')) writeFileSync(seedPath, serialized);
  if (seedOnly) return { seedRecords: seed.records.length, seedQuestions: seed.questions.length };
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(baseUrl + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const dump = await api('/export');
  const next = supplementRecords(dump.records, now);
  let changedRecords = 0;
  for (const record of next) {
    const before = dump.records.find(r => r.id === record.id);
    if (!before) {
      const created = (await api('/records', 'POST', record)).record;
      if (created.id !== record.id) throw new Error('Server lacks stable-ID import support. Restart the updated server before retrying.');
      if (created.status !== record.status) await api(`/records/${record.id}`, 'PATCH', { status: record.status });
      changedRecords++;
    } else {
      const patch = recordPatch(before, record);
      if (Object.keys(patch).length) { await api(`/records/${record.id}`, 'PATCH', patch); changedRecords++; }
    }
  }
  const ref = next.find(r => r.collection_id === 'mosuo_video_002');
  const { record: currentRef } = await api(`/records/${ref.id}`);
  let createdQuestions = 0;
  const { questions } = await api('/questions');
  for (const q of researchQuestions(currentRef)) {
    if (questions.some(existing => existing.record_id === ref.id && (existing.prompt === q.prompt || existing.evidence_note === q.evidence_note))) continue;
    await api('/questions', 'POST', q); createdQuestions++;
  }
  return { changedRecords, createdQuestions, videoRecordId: ref.id, insoleRecordId: INSOLE_ID };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('MOSUO_RESEARCH_IMPORTED', await importResearch({ seedOnly: process.argv.includes('--seed-only') }));
}
