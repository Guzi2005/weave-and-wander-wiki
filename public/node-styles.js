// W&W Wiki 发型节点样式对比视图：读取 /assets/node-styles/manifest.json（ww-node-styles-v1），
// 以方形、小字号学术卡片并排比较程序化发型节点。所有文本经 textContent 渲染。
// 除 double-yak 外，所有变体均为游戏支持的通用程序化发型节点，不作文化归属。

export const NODE_STYLES_MANIFEST_PATH = '/assets/node-styles/manifest.json';
export const NODE_STYLES_SCHEMA = 'ww-node-styles-v1';
export const EXPECTED_NODE_STYLE_IDS = ['legacy-single', 'double-yak', 'double-loose', 'double-dense', 'single-copper', 'double-soft'];
// 参考图 P1 由根级工序生成；此处仅引用路径，不伪造资产。
export const BRAID_REFERENCE_P1 = '/assets/mosuo-braid-reference-003.png';

// legacy-single 是保留的旧版单圈盘旋，不是真实传统发式的断言；
// double-yak 是唯一参考摩梭人案例照片（P1）的适配，不是民族志分类。
const NODE_STYLE_KINDS = {
  'legacy-single': { kind: 'legacy', label: '旧版保留 · 通用节点' },
  'double-yak': { kind: 'photo-informed', label: '照片参考适配 · 非民族志分类' },
};

export function classifyNodeStyle(id) {
  return NODE_STYLE_KINDS[id] || { kind: 'generic', label: '通用程序化发型节点' };
}

// 图像与 recipe 只允许本机 /assets/node-styles/ 下的固定扩展名，拒绝越界与外链。
export function safeNodeStyleAsset(path, kind) {
  if (typeof path !== 'string') return null;
  const ext = kind === 'recipe' ? 'tres' : 'png';
  const pattern = new RegExp(`^/assets/node-styles/[A-Za-z0-9._-]+\\.${ext}$`);
  return pattern.test(path) ? path : null;
}

// 参数键的可读中文名；未收录的键原样显示。长度类参数单位为模型米，非实测历史尺寸。
const PARAM_LABELS = {
  loop_count: '盘绕圈数',
  coil_turns: '盘绕圈数',
  braid_count: '辫数',
  strand_count: '股数',
  braid_radius: '辫体半径',
  strand_radius: '辫股半径',
  loop_radius: '盘绕半径',
  base_radius: '基座半径',
  length: '长度',
  spacing: '节距',
  crown_height: '冠部高度',
  tightness: '紧密度',
  taper: '末端收细',
  twist: '扭转度',
  fuzz: '毛边程度',
  droop: '下垂度',
};
const METRE_PARAMS = new Set(['braid_radius', 'strand_radius', 'loop_radius', 'base_radius', 'length', 'spacing', 'crown_height']);

export function formatParameter(key, value) {
  const label = PARAM_LABELS[key] || key;
  if (typeof value === 'number' && METRE_PARAMS.has(key)) return [label, `${value} m（模型米）`];
  return [label, String(value)];
}

export function validateNodeStylesManifest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('节点样式清单不是有效的 JSON 对象');
  }
  if (data.schema !== NODE_STYLES_SCHEMA) {
    throw new Error(`节点样式清单 schema 应为 ${NODE_STYLES_SCHEMA}，实际为 ${JSON.stringify(data.schema)}`);
  }
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('节点样式清单缺少 title');
  if (typeof data.description !== 'string') throw new Error('节点样式清单缺少 description');
  if (!Array.isArray(data.entries) || data.entries.length === 0) throw new Error('节点样式清单 entries 为空');
  const seen = new Set();
  data.entries.forEach((entry, index) => {
    const where = `entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${where} 不是对象`);
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) throw new Error(`${where}.id 无效`);
    if (seen.has(entry.id)) throw new Error(`${where}.id 重复：${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw new Error(`${where}（${entry.id}）缺少 label`);
    if (!safeNodeStyleAsset(entry.image, 'image')) throw new Error(`${where}（${entry.id}）image 必须是 /assets/node-styles/*.png`);
    if (!safeNodeStyleAsset(entry.recipe, 'recipe')) throw new Error(`${where}（${entry.id}）recipe 必须是 /assets/node-styles/*.tres`);
    if (!entry.parameters || typeof entry.parameters !== 'object' || Array.isArray(entry.parameters)) {
      throw new Error(`${where}（${entry.id}）parameters 必须是对象`);
    }
    for (const [key, value] of Object.entries(entry.parameters)) {
      if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${where}（${entry.id}）参数 ${key} 必须是数字或字符串`);
    }
    if (typeof entry.evidence_status !== 'string' || !entry.evidence_status.trim()) throw new Error(`${where}（${entry.id}）缺少 evidence_status`);
    if (typeof entry.note !== 'string') throw new Error(`${where}（${entry.id}）缺少 note`);
  });
  for (const id of EXPECTED_NODE_STYLE_IDS) {
    if (!seen.has(id)) throw new Error(`节点样式清单缺少预期条目：${id}`);
  }
  return data;
}

function sourceP1Block(el) {
  return el('div', { class: 'ns-source' }, [
    el('p', { class: 'ns-source-title', text: '参考来源 P1' }),
    el('a', { class: 'ns-thumb ns-source-img source-to-model', href:'#/workshop?model=mosuo_headwear_001', 'aria-label':'预览摩梭人套装的头饰模型' }, [
      el('img', { src: BRAID_REFERENCE_P1, alt: '参考图 P1：超粗牦牛毛辫盘绕两圈' }),
      el('span', {class:'atlas-action', text:'头饰 3D ↗'}),
    ]),
    el('p', { class: 'hint', text: '参考图 P1 与照片001为不同穿戴者；用户识别为超粗牦牛毛辫盘绕两圈。可见几何用于建模适配；照片001头饰的纤维未独立鉴定，P1 的材料断言不移植到照片001。' }),
  ]);
}

function nodeStyleCard(entry, el, tag) {
  const kind = classifyNodeStyle(entry.id);
  const params = Object.entries(entry.parameters).map(([key, value]) => {
    const [label, text] = formatParameter(key, value);
    return [el('dt', { text: label }), el('dd', { text })];
  }).flat();
  return el('article', { class: 'ns-card' }, [
    el('div', { class: 'ns-thumb' }, [
      el('img', { src: entry.image, alt: `${entry.label}（${entry.id}）` }),
    ]),
    el('div', { class: 'ns-body' }, [
      el('p', { class: 'card-title', text: entry.label }),
      el('div', { class: 'card-meta' }, [
        el('span', { class: 'mono', text: entry.id }),
        tag(kind.label, `ns-${kind.kind}`),
        tag(entry.evidence_status),
      ]),
      el('dl', { class: 'meta ns-params' }, params),
      el('p', { class: 'hint', text: entry.note }),
      el('div', { class: 'form-actions' }, [
        el('a', { class: 'btn btn-quiet', href: entry.recipe, download: '', text: '下载 recipe (.tres)' }),
      ]),
      ...(entry.id === 'double-yak' && !document.querySelector('meta[name="ww-public"]') ? [sourceP1Block(el)] : []),
    ]),
  ]);
}

export async function renderNodeStyles(params, helpers) {
  const { view, el, tag, setNavCurrent, isStale, token } = helpers;
  setNavCurrent('node-styles');

  let manifest;
  try {
    const res = await fetch(NODE_STYLES_MANIFEST_PATH, { cache: 'no-store' });
    if (!res.ok) throw new Error(`清单请求失败（${res.status}）：节点样式资产可能尚未由根级工序生成`);
    manifest = validateNodeStylesManifest(await res.json());
  } catch (err) {
    if (isStale(token)) return;
    view.replaceChildren(
      el('h1', { class: 'page-title', text: '发型节点样式' }),
      el('div', { class: 'panel route-error' }, [
        el('p', { text: `清单加载失败：${err.message}` }),
        el('p', { class: 'hint', text: `预期路径：${NODE_STYLES_MANIFEST_PATH}（schema ${NODE_STYLES_SCHEMA}）。图像与 recipe 由根级工序产出，本页不生成替代资产。` }),
        el('a', { class: 'btn btn-quiet', href: '#/workshop', text: '返回工坊' }),
      ]),
    );
    return;
  }
  if (isStale(token)) return;

  view.replaceChildren(
    el('h1', { class: 'page-title', text: manifest.title }),
    el('p', { class: 'page-sub', text: manifest.description }),
    el('div', { class: 'panel' }, [
      el('p', { class: 'hint', text: '除 double-yak 外，所有变体均为游戏支持的通用程序化发型节点，不作文化归属。legacy-single 是保留的旧版单圈盘旋资产，并非真实传统发式的断言；double-yak 是参考摩梭人案例照片 P1 的适配，不是民族志分类。' }),
      el('p', { class: 'hint', text: '参数单位为模型米，是游戏模型的相对尺寸，不是实测历史尺寸。' }),
      el('div', { class: 'form-actions' }, [
        el('a', { class: 'btn btn-quiet', href: '#/workshop?model=mosuo_headwear_001', text: '预览摩梭人套装头饰' }),
      ]),
    ]),
    el('div', { class: 'ns-grid' }, manifest.entries.map((entry) => nodeStyleCard(entry, el, tag))),
  );
}
