// 可调参织物与流苏：本地 manifest + 二维实时示意 + 修改配方下载。
import { normalizeMotifParameters, normalizeHex, hexForInput, serializeMotifRecipe, MOTIF_LIMITS } from './motif-recipe.js';
import { drawMotifPreview } from './motif-preview.js';

export const MOTIFS_MANIFEST_PATH = '/assets/motifs/manifest.json';
export const MOTIFS_SCHEMA = 'ww-motifs-v1';
export const EXPECTED_MOTIF_IDS = ['stripe-overskirt', 'tassel-sash'];

export function safeMotifAsset(path, kind) {
  if (typeof path !== 'string') return null;
  const ext = kind === 'recipe' ? 'tres' : 'png';
  return new RegExp(`^/assets/motifs/[A-Za-z0-9._-]+\\.${ext}$`).test(path) ? path : null;
}

export function formatMotifParameter(key, value) {
  if (key === 'sequence' && Array.isArray(value)) return value.map((s) => `${s.role} ${s.color} · u ${s.u0}–${s.u1}`).join('；');
  if (Array.isArray(value)) return value.join(' / ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

export function validateMotifsManifest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('motif 清单不是有效的 JSON 对象');
  if (data.schema !== MOTIFS_SCHEMA) throw new Error(`motif 清单 schema 应为 ${MOTIFS_SCHEMA}`);
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('motif 清单缺少 title');
  if (typeof data.description !== 'string') throw new Error('motif 清单缺少 description');
  if (!Array.isArray(data.entries) || data.entries.length === 0) throw new Error('motif 清单 entries 为空');
  const seen = new Set();
  for (const [index, entry] of data.entries.entries()) {
    const where = `entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${where} 不是对象`);
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) throw new Error(`${where}.id 无效`);
    if (seen.has(entry.id)) throw new Error(`${where}.id 重复：${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw new Error(`${where} 缺少 label`);
    if (typeof entry.record_id !== 'string' || !/^WW-UKR-001-M0[12]$/.test(entry.record_id)) throw new Error(`${where}.record_id 无效`);
    if (!safeMotifAsset(entry.image, 'image')) throw new Error(`${where}.image 必须是 /assets/motifs/*.png`);
    if (!safeMotifAsset(entry.recipe, 'recipe')) throw new Error(`${where}.recipe 必须是 /assets/motifs/*.tres`);
    if (!entry.parameters || typeof entry.parameters !== 'object' || Array.isArray(entry.parameters)) throw new Error(`${where}.parameters 必须是对象`);
    if (typeof entry.evidence_status !== 'string' || !entry.evidence_status.trim()) throw new Error(`${where} 缺少 evidence_status`);
    if (typeof entry.note !== 'string') throw new Error(`${where} 缺少 note`);
  }
  for (const id of EXPECTED_MOTIF_IDS) if (!seen.has(id)) throw new Error(`motif 清单缺少：${id}`);
  return data;
}

function motifCard(entry, el, tag) {
  const initial = normalizeMotifParameters(entry.id, entry.parameters);
  let state = structuredClone(initial);
  const controls = [];
  const canvas = el('canvas', { class: 'motif-canvas', width: '640', height: '640', 'aria-label': `${entry.label}实时二维参数示意` });
  const status = el('p', { class: 'hint motif-status', role: 'status', text: '调整参数即可更新二维示意；尚未写入 Godot 模型。' });
  const form = el('div', { class: 'motif-form' });

  function update() {
    state = normalizeMotifParameters(entry.id, state);
    drawMotifPreview(canvas, entry.id, state);
    for (const control of controls) {
      const value = control.get();
      control.input.value = control.color ? hexForInput(value) : String(value);
      if (control.output) control.output.textContent = String(value);
    }
  }
  function addNumber(label, get, set, min, max, step) {
    const input = el('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(get()) });
    const output = el('output', { text: String(get()) });
    input.addEventListener('input', () => { set(Number(input.value)); update(); });
    controls.push({ input, output, get, color: false });
    form.append(el('label', { class: 'motif-field' }, [el('span', { text: label }), el('span', { class: 'motif-input' }, [input, output])]));
  }
  function addColor(label, get, set) {
    const input = el('input', { type: 'color', value: hexForInput(get()), 'aria-label': label });
    input.addEventListener('input', () => { set(normalizeHex(input.value)); update(); });
    controls.push({ input, output: null, get, color: true });
    form.append(el('label', { class: 'motif-field' }, [el('span', { text: label }), input]));
  }

  if (entry.id === 'stripe-overskirt') {
    addColor('底色', () => state.base_color, (value) => { state.base_color = value; });
    addNumber('重复单元数', () => state.repeat_count, (value) => { state.repeat_count = value; }, ...MOTIF_LIMITS.stripe.repeat_count, 1);
    state.sequence.forEach((stripe, index) => {
      form.append(el('p', { class: 'motif-group-title', text: `色条 ${index + 1} · ${stripe.role}` }));
      addColor('颜色', () => state.sequence[index].color, (value) => { state.sequence[index].color = value; });
      addNumber('起点 u0（单元内绝对偏移）', () => state.sequence[index].u0, (value) => { state.sequence[index].u0 = value; }, 0, 1, 0.001);
      addNumber('终点 u1', () => state.sequence[index].u1, (value) => { state.sequence[index].u1 = value; }, 0.0001, 1, 0.001);
    });
  } else {
    const t = MOTIF_LIMITS.tassel;
    addColor('毛线颜色 A', () => state.colors[0], (value) => { state.colors[0] = value; });
    addColor('毛线颜色 B', () => state.colors[1], (value) => { state.colors[1] = value; });
    addNumber('毛线段数', () => state.strand_count, (value) => { state.strand_count = value; }, ...t.strand_count, 1);
    addNumber('绒球数', () => state.puff_count, (value) => { state.puff_count = value; }, ...t.puff_count, 1);
    addNumber('长度 / m（模型米）', () => state.length, (value) => { state.length = value; }, ...t.length, 0.005);
    addNumber('散开半径 / m', () => state.spread, (value) => { state.spread = value; }, ...t.spread, 0.005);
    addNumber('毛线半径 / m', () => state.strand_radius, (value) => { state.strand_radius = value; }, ...t.strand_radius, 0.001);
    addNumber('绒球半径 / m', () => state.puff_radius, (value) => { state.puff_radius = value; }, ...t.puff_radius, 0.001);
    addNumber('随机种子', () => state.seed, (value) => { state.seed = value; }, ...t.seed, 1);
  }

  const reset = el('button', { class: 'btn btn-quiet', type: 'button', text: '恢复当前资产参数' });
  reset.addEventListener('click', () => { state = structuredClone(initial); update(); });
  const download = el('button', { class: 'btn', type: 'button', text: '下载修改后的配方 (.tres)' });
  download.addEventListener('click', () => {
    const blob = new Blob([serializeMotifRecipe(entry.id, state)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `${entry.id}.tres` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = '修改配方已下载；替换项目配方并重新导出后，才会更新三维模型。';
  });
  const reference = el('details', { class: 'motif-reference' }, [
    el('summary', { text: '对照当前三维模型局部' }),
    el('a', { class:'source-to-model', href:'#/workshop?model=' + (entry.id === 'stripe-overskirt' ? 'ukrainian_overskirt_001' : 'ukrainian_sash_001') }, [
      el('img', { src: entry.image, alt: `${entry.label}当前三维模型局部` }),
      el('span', {class:'atlas-action', text:'预览部件 3D ↗'}),
    ]),
  ]);
  queueMicrotask(update);
  return el('article', { class: 'ns-card motif-card' }, [
    el('div', { class: 'motif-preview' }, [canvas]),
    el('div', { class: 'ns-body' }, [
      el('p', { class: 'card-title', text: entry.label }),
      el('div', { class: 'card-meta' }, [el('span', { class: 'mono', text: entry.id }), tag(entry.evidence_status)]),
      el('p', { class: 'hint', text: entry.note }), form, status,
      el('div', { class: 'form-actions' }, [download, reset,
        el('a', { class: 'btn btn-quiet', href: entry.recipe, download: '', text: '下载原始配方' }),
        el('a', { class: 'btn btn-quiet', href: `#/record/${entry.record_id}`, text: '查看档案' })]),
      reference,
    ]),
  ]);
}

export async function renderMotifs(params, helpers) {
  const { view, el, tag, setNavCurrent, isStale, token } = helpers;
  setNavCurrent('motifs');
  let manifest;
  try {
    const response = await fetch(MOTIFS_MANIFEST_PATH, { cache: 'no-store' });
    if (!response.ok) throw new Error(`清单请求失败（${response.status}）`);
    manifest = validateMotifsManifest(await response.json());
  } catch (err) {
    if (isStale(token)) return;
    view.replaceChildren(el('h1', { class: 'page-title', text: 'motif 参数资产' }),
      el('div', { class: 'panel route-error' }, [el('p', { text: err.message })]));
    return;
  }
  if (isStale(token)) return;
  view.replaceChildren(
    el('h1', { class: 'page-title', text: manifest.title }),
    el('p', { class: 'page-sub', text: manifest.description }),
    el('div', { class: 'panel' }, [
      el('p', { class: 'hint', text: '参数尺寸是游戏模型米，不是原物实测尺寸。画布为实时二维参数示意，不是重新渲染的三维模型；下载的配方可交给 Godot 重新生成几何。' }),
      el('div', { class: 'form-actions' }, [
        el('a', { class: 'btn btn-quiet', href: '#/record/WW-UKR-001', text: '查看乌克兰套装' }),
        el('a', { class: 'btn btn-quiet', href: '#/workshop?model=ukrainian_ensemble', text: '在工坊中查看整套' }),
      ]),
    ]),
    el('div', { class: 'ns-grid motif-grid' }, manifest.entries.map((entry) => motifCard(entry, el, tag))),
  );
}
