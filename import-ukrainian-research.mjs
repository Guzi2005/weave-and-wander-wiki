// Idempotently supplement the archive via its API; never replace runtime data.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const COLLECTION = 'ukrainian_photo_001';
const SOURCE = '/assets/ukrainian-source.jpg';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const appendUnique = (values, additions) => [...new Set([...(values || []), ...additions])];
const addNote = (notes, addition) => (notes || '').includes(addition) ? notes : [notes, addition].filter(Boolean).join('\n');

const common = '归属仅来自用户提供的“乌克兰套装”描述和本张参考照片；不推导地区、年代、工艺或所有乌克兰服饰的统一样式。照片作者、拍摄时间、地点、原始网址和授权待补。游戏模型按既有小人身体适配，身体未修改；背面、不可见连接及材质细节属于制作推演。';
const specs = [
  ['WW-UKR-001', '乌克兰套装（参考照片适配）', 'ensemble', '服装', null,
    ['用户说明｜套装包含长衬衫衬裙、黄色布腰带、紫色围裙和黄紫绿条纹罩裙。',
      '画面观察｜颈部有多圈黑白珠串，胸前以红丝带系合；袖子蓬松，袖口收窄。',
      '制作决定｜腰带中心保持 y=1.42、罩裙腰口 y=1.44（模型米）；三圈布带贴合穿着后的截面，黄紫毛线流苏独立建模。'],
    '分件：C01 长衬衫衬裙，C02 条纹罩裙，C03 紫色围裙，C04 黄色腰带与流苏，C05 黑白珠串。M01/M02 为可复用 motif 参数资产。'],
  ['WW-UKR-001-C01', '白色长衬衫衬裙与红丝带', 'component', '服装', 'WW-UKR-001',
    ['用户说明｜衬裙是长至脚踝的长衬衫，胸口中央开领，由红丝带打结固定。',
      '制作决定｜建立蓬松灯笼袖与收窄袖口；下摆增加细织带，身体、手臂与手腕位置不变。'],
    '对应模型 ukrainian_undershirt_001.glb；衬衫、袖口、领口蝴蝶结和白色下摆同属此部件。'],
  ['WW-UKR-001-C02', '黄紫绿条纹罩裙', 'component', '服装', 'WW-UKR-001',
    ['用户说明｜罩裙具有黄、紫、绿条纹。',
      '制作决定｜遵循项目百褶裙参数合约，增加褶谷暗色、底布织纹点与黄色下摆织带；高位腰口未下调。'],
    '对应模型 ukrainian_overskirt_001.glb；条纹使用 M01 stripe-overskirt 配方。'],
  ['WW-UKR-001-C03', '紫色围裙', 'component', '服装', 'WW-UKR-001',
    ['用户说明｜套装前方有紫色围裙。', '制作决定｜以局部弧形褶裙覆盖罩裙前片，保留下摆织带。'],
    '对应模型 ukrainian_apron_001.glb。'],
  ['WW-UKR-001-C04', '黄色缠绕腰带与黄紫毛线流苏', 'component', '服装', 'WW-UKR-001',
    ['用户说明｜腰上有黄色布腰带，流苏有黄有紫。',
      '制作决定｜三圈布带随身体与裙层截面缠绕，带轻微倾斜和皱褶；毛线段和绒球簇按双色分组。'],
    '对应模型 ukrainian_sash_001.glb；流苏使用 M02 tassel-sash 配方。'],
  ['WW-UKR-001-C05', '黑白多圈珠串', 'component', '饰品', 'WW-UKR-001',
    ['用户说明与画面观察｜颈上挂有多圈黑、白珠串。', '制作决定｜四圈黑白交替珠串沿领口至胸前排列，每圈前侧下垂量分别控制。'],
    '对应模型 ukrainian_beads_001.glb；珠材未鉴定。'],
  ['WW-UKR-001-M01', 'motif｜黄紫绿经向条纹布料', 'object', '布艺', 'WW-UKR-001',
    ['制作决定｜条纹以周向重复单元、单元内绝对 u 偏移、底色、条色和带宽参数化。'],
    '当前配方 /assets/motifs/stripe-overskirt.tres；在“motif 参数资产”页查看并下载。'],
  ['WW-UKR-001-M02', 'motif｜黄紫混色毛线团流苏', 'object', '布艺', 'WW-UKR-001',
    ['制作决定｜毛线段数、绒球数、长度、散开半径、线半径、球半径、双色和随机种子参数化。'],
    '当前配方 /assets/motifs/tassel-sash.tres；在“motif 参数资产”页查看并下载。'],
];

function desiredRecord([id, title, record_type, category, parent_id, observations, note], now) {
  return { id, title, record_type, category, status: '待考证', parent_id, collection_id: COLLECTION,
    culture: { text: '乌克兰（用户提供）', attribution: 'user' }, place: null, date_text: null,
    notes: `${common}\n${note}`, observations,
    source: { author: null, captured_at: null, place: null, url: null, license: null },
    media: [{ path: SOURCE, role: 'source', label: '用户提供的乌克兰套装参考照片（原样保存）', focus: { x: 50, y: 48 } }],
    revision: 1, created_at: now, updated_at: now };
}

export function supplementUkrainianRecords(records, now = new Date().toISOString()) {
  const result = structuredClone(records);
  for (const spec of specs) {
    const desired = desiredRecord(spec, now);
    const index = result.findIndex((record) => record.id === desired.id);
    if (index < 0) { result.push(desired); continue; }
    const record = result[index];
    if (record.collection_id !== COLLECTION) throw new Error(`ID 冲突：${desired.id} 已属于其他集合`);
    // Only author-owned classification/relations and known factual fields update.
    for (const key of ['title', 'record_type', 'category', 'parent_id', 'collection_id']) {
      if (!Object.hasOwn(record,key) || record[key] === '') record[key] = desired[key];
    }
    record.culture ??= desired.culture;
    record.observations = appendUnique(record.observations, desired.observations);
    record.notes = addNote(record.notes, desired.notes);
    record.media ??= [];
    if (!record.media.some((media) => media.path === SOURCE)) record.media.push(...desired.media);
    if (!same(records[index], record)) { record.revision = (records[index].revision || 1) + 1; record.updated_at = now; }
  }
  return result;
}

export function ukrainianRecordPatch(before, after) {
  const patch = {};
  for (const key of ['title', 'record_type', 'category', 'parent_id', 'collection_id', 'notes', 'observations', 'media']) {
    if (!same(before[key], after[key])) patch[key] = after[key];
  }
  if (!before.culture && after.culture) patch.culture_text = after.culture.text;
  return patch;
}

export async function importUkrainianResearch({ baseUrl = 'http://127.0.0.1:4318', seedOnly = false } = {}) {
  copyFileSync(path.join(root, 'assets/collections/ukrainian_photo_001/source.jpg'), path.join(here, 'public/assets/ukrainian-source.jpg'));
  const now = new Date().toISOString();
  const seedPath = path.join(here, 'seed/records.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  seed.records = supplementUkrainianRecords(seed.records, now);
  const serialized = JSON.stringify(seed, null, 2) + '\n';
  if (serialized !== readFileSync(seedPath, 'utf8')) writeFileSync(seedPath, serialized);
  if (seedOnly) return { seedRecords: seed.records.length };
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(baseUrl + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const dump = await api('/export');
  const next = supplementUkrainianRecords(dump.records, now);
  let changedRecords = 0;
  for (const record of next.filter((item) => item.collection_id === COLLECTION)) {
    const before = dump.records.find((item) => item.id === record.id);
    if (!before) {
      const created = (await api('/records', 'POST', record)).record;
      if (created.id !== record.id) throw new Error('服务器不支持稳定 ID；请重启更新后的服务器再重试。');
      const createdAfter = next.find((item) => item.id === created.id);
      const patch = { ...ukrainianRecordPatch(created, createdAfter), status: record.status };
      await api(`/records/${record.id}`, 'PATCH', patch);
    } else {
      const patch = ukrainianRecordPatch(before, record);
      if (Object.keys(patch).length) await api(`/records/${record.id}`, 'PATCH', patch);
      else continue;
    }
    changedRecords++;
  }
  return { changedRecords, recordIds: specs.map(([id]) => id) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('UKRAINIAN_RESEARCH_IMPORTED', await importUkrainianResearch({ seedOnly: process.argv.includes('--seed-only') }));
}
