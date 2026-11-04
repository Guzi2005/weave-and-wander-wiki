import {renderPractice,renderHome,renderGuide,renderContribute} from '/player-pages.js';
import {REGION_TAGS, ETHNIC_TAGS} from '/tag-presets.js';
// W&W Wiki 前端：hash 路由 + 原生 DOM。所有记录字段经 textContent 渲染，不注入 HTML。
const cleanupViewer = handle => handle?.cleanup();
import { renderQuestions } from '/questions.js';
import { renderNodeStyles } from '/node-styles.js';
import { renderMotifs } from '/motifs.js';
import { buildArchiveEntries, pickThumbMedia } from '/archive-layout.js';

const view = document.getElementById('view');
const PUBLIC_SITE = document.querySelector('meta[name="ww-public"]')?.content === 'true';
if (PUBLIC_SITE) document.documentElement.classList.add('public-site');
let activeViewer = null;
// 路由令牌：异步渲染完成前若已切换路由，丢弃过期结果，避免旧视图覆盖新视图。
let routeToken = 0;
let flashMsg = null;

const CATEGORIES = ['服装', '饰品', '布艺', '玩具', '工具', '其他', '待分类'];
const STATUSES = ['待整理', '待考证', '考证中', '已整理'];
const RECORD_TYPES = [
  ['object', '独立单件 object'],
  ['component', '部件 component'],
  ['ensemble', '套装 ensemble'],
];

// 档案记录 ↔ 游戏资产（GLB 模型）的已知映射。模型位于 /assets/models/。
let GAME_ASSETS = {};
async function loadAssets(){const data=await api('/assets/catalog.json');GAME_ASSETS=data.assets||{};}

function isStale(token) {
  return token !== routeToken;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'for') node.htmlFor = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function safeImgSrc(path) {
  return typeof path === 'string' && /^\/(media|assets)\/[A-Za-z0-9._-]+$/.test(path) ? path : null;
}

// 缩略图允许 CSS object-position 聚焦裁切；详情主图不裁切，另附完整原图链接。
// 只取原始证据媒体；生成概念图不进入列表缩略位，避免冒充原图。
function thumb(item, className) {
  const media = pickThumbMedia(item.media);
  const src = media && safeImgSrc(media.path);
  const box = el('div', { class: className });
  if (src) {
    const img = el('img', { src, alt: media.label || item.title || '记录图像', loading:'lazy', decoding:'async' });
    const focus = media.focus || { x: 50, y: 50 };
    img.style.objectPosition = `${focus.x}% ${focus.y}%`;
    box.append(img);
  } else {
    box.append(el('span', { class: 'hint', text: '暂无图像' }));
  }
  const asset=GAME_ASSETS[item.id];
  if(asset?.cover && src){
    box.classList.add('cover-switch');
    const model = el('img', {src:asset.cover, alt:'', class:'model-cover', loading:'lazy'});
    model.onerror = () => model.remove();
    box.append(model);
  } else if (!src && asset?.cover) {
    box.replaceChildren(el('img', {src:asset.cover, alt:item.title + ' · 游戏模型', loading:'lazy'}));
  }
  return box;
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应 */ }
  if (!res.ok) {
    throw new Error((body && body.error) || `请求失败（${res.status}）`);
  }
  return body;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function tag(text, extraClass = '') {
  return el('span', { class: `tag ${extraClass}`, text });
}

function questionStateTags(q) {
  const tags = [q.status === 'approved' ? tag('已审定', 'q-approved') : tag('草稿', 'q-draft')];
  if (q.needs_review) tags.push(tag('需复核：记录已变更', 'q-stale'));
  return tags;
}

function setNavCurrent(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function field(labelText, control) {
  return el('div', { class: 'form-field' }, [el('label', { for: control.id, text: labelText }), control]);
}

function section(title, children, open = true) {
  return el('details', { class: 'section', ...(open ? { open: '' } : {}) }, [
    el('summary', { text: title }),
    el('div', { class: 'section-body' }, children),
  ]);
}

function renderRouteError(err) {
  view.replaceChildren(
    el('h1', { class: 'page-title', text: '页面加载失败' }),
    el('div', { class: 'panel route-error' }, [
      el('p', { text: `错误信息：${err.message}` }),
      el('a', { class: 'btn btn-quiet', href: '#/archive', text: '返回资料库' }),
    ]),
  );
}

// 卡片文案只保留名称与考证状态；ID 与文化归属模板文案移至详情页。
function atlasImage(record, thumbClass, linkClass = '') {
  const model = GAME_ASSETS[record.id]?.model;
  const action = model ? '预览模型' : '查看档案';
  const href = model ? '#/workshop?model=' + encodeURIComponent(model) : '#/record/' + encodeURIComponent(record.id);
  const image = thumb(record, thumbClass);
  const cue = model && !pickThumbMedia(record.media) ? '模型图 · 3D ↗' : model ? '3D ↗' : '档案 ↗';
  image.append(el('span', {class:'atlas-action', text:cue}));
  return el('a', {class:'atlas-image ' + linkClass, href, 'aria-label':action + ' · ' + record.title}, [image]);
}

function articleLink(record, classes) {
  return el('a', {class:'atlas-caption ' + classes, href:'#/record/' + encodeURIComponent(record.id), text:record.title});
}

function recordCard(record) {
  return el('article', {class:'card'}, [
    atlasImage(record, 'card-thumb'),
    el('div', {class:'card-body'}, [articleLink(record, 'card-title')]),
  ]);
}

function ensembleCard({record, components}) {
  return el('article', {class:'card card-ensemble'}, [
    atlasImage(record, 'card-thumb ensemble-whole-thumb', 'ensemble-whole'),
    el('div', {class:'ensemble-side'}, [
      articleLink(record, 'ensemble-title card-title'),
      el('div', {class:'ensemble-components'}, components.map(component =>
        el('div', {class:'ensemble-component', 'data-record-id':component.id}, [
          atlasImage(component, 'component-thumb'),
          articleLink(component, 'component-title'),
        ])
      )),
    ]),
  ]);
}

// ---------- 资料库 ----------
async function renderArchive(token, params) {
  setNavCurrent('archive');
  await loadAssets();if(isStale(token))return;
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const status = params.get('status') || '';

  const qInput = el('input', { type: 'text', id: 'f-q', value: q, placeholder: '名称、ID、笔记、专题…' });
  const catSel = el('select', { id: 'f-category' }, [
    el('option', { value: '', text: '全部类别' }),
    ...CATEGORIES.map((c) => el('option', { value: c, text: c })),
  ]);
  catSel.value = category;
  const statusSel = el('select', { id: 'f-status' }, [
    el('option', { value: '', text: '全部状态' }),
    ...STATUSES.map((s) => el('option', { value: s, text: s })),
  ]);
  statusSel.value = status;

  const countSpan = el('span', { class: 'result-count', role: 'status', text: '' });
  const grid = el('div', { class: 'card-grid archive-grid' });
  const activeFilters = el('div', { class: 'active-filters', 'aria-label': '已选筛选' });
  const categoryButtons = ['', ...CATEGORIES].map(value => {
    const button = el('button', { type: 'button', class: 'category-link', text: value || '全部资料', 'aria-pressed': String(category === value) });
    button.onclick = () => { catSel.value = value; load(); };
    return { value, button };
  });
  function syncFilters() {
    categoryButtons.forEach(({value, button}) => button.setAttribute('aria-pressed', String(catSel.value === value)));
    activeFilters.replaceChildren();
    for (const [control, label] of [[qInput, '关键词'], [catSel, '类别'], [statusSel, '状态']]) {
      if (!control.value.trim()) continue;
      const clear = el('button', { type: 'button', class: 'filter-token', text: control.value + ' ×', 'aria-label': '清除' + label + '：' + control.value });
      clear.onclick = () => { control.value = ''; load(); };
      activeFilters.append(clear);
    }
    activeFilters.hidden = !activeFilters.childElementCount;
  }

  let searchSerial=0;
  async function load() {
    const serial=++searchSerial;
    syncFilters();
    grid.setAttribute('aria-busy', 'true');
    const query = new URLSearchParams();
    if (qInput.value.trim()) query.set('q', qInput.value.trim());
    if (catSel.value) query.set('category', catSel.value);
    if (statusSel.value) query.set('status', statusSel.value);
    history.replaceState(null,'','#/archive'+(query.size?'?'+query:''));
    let data;
    let childrenByEnsemble = new Map();
    try {
      data = await api(`/api/records?${query}`);
      if (isStale(token)||serial!==searchSerial) return;
      // 套装命中且未按类别筛选时，取回其完整子记录，
      // 使未命中关键词的部件也能随套装组合卡展示。
      if (!catSel.value) {
        const ensembles = data.records.filter((r) => r.record_type === 'ensemble');
        const fetched = await Promise.all(ensembles.map(async (r) => {
          const detail = await api(`/api/records/${encodeURIComponent(r.id)}`);
          return [r.id, detail.children || []];
        }));
        childrenByEnsemble = new Map(fetched);
      }
    } catch (err) {
      if (isStale(token)||serial!==searchSerial) return;
      countSpan.textContent = '';
      grid.removeAttribute('aria-busy');
      grid.replaceChildren(el('div', { class: 'empty-state', text: `检索失败：${err.message}` }));
      return;
    }
    if (isStale(token)||serial!==searchSerial) return;
    grid.removeAttribute('aria-busy');
    countSpan.textContent = `${data.count} / ${data.total} 条资料`;
    grid.replaceChildren();
    if (data.records.length === 0) {
      grid.append(el('div', { class: 'empty-state', text: '没有匹配的资料。试试清除筛选，或通过“收录资料”添加线索。' }));
      return;
    }
    const entries = buildArchiveEntries(data.records, {
      categoryFilterActive: Boolean(catSel.value),
      childrenOf: (id) => childrenByEnsemble.get(id) || [],
    });
    for (const entry of entries) {
      grid.append(entry.kind === 'ensemble' ? ensembleCard(entry) : recordCard(entry.record));
    }
  }

  const applyBtn = el('button', { class: 'btn', type: 'button', text: '检索' });
  applyBtn.addEventListener('click', load);
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  statusSel.addEventListener('change', load);
  const resetBtn = el('button', { class: 'filter-reset', type: 'button', text: '重置' });
  resetBtn.onclick = () => { qInput.value = ''; catSel.value = ''; statusSel.value = ''; load(); };

  view.replaceChildren(
    el('div', { class: 'archive-layout' }, [
      el('aside', { class: 'archive-sidebar', 'aria-label': '资料库目录' }, [
        ...[['省级行政区', REGION_TAGS], ['民族', ETHNIC_TAGS]].map(([label, tags]) => el('details', {class:'preset-directory'}, [
          el('summary', {text:label}),
          ...tags.map(text => {
            const button = el('button', {type:'button', class:'filter-token', text});
            button.onclick = () => { qInput.value = text; load(); };
            return button;
          }),
        ])),
        el('details', { class: 'category-directory', ...(matchMedia('(min-width:641px)').matches ? {open:''} : {}) }, [
          el('summary', { text: '资料类别' }),
          el('nav', { class: 'category-list', 'aria-label': '按类别筛选' }, categoryButtons.map(item => item.button)),
        ]),
        el('nav', { class: 'archive-tools', 'aria-label': '资料工具' }, [
          el('a', { href: '#/node-styles', text: '节点样式 ↗' }),
          el('a', { href: '#/motifs', text: '纹样与材质 ↗' }),
          ...(!PUBLIC_SITE ? [el('a', { href: '#/intake', text: '收录资料 ＋' })] : []),
        ]),
      ]),
      el('section', { class: 'archive-content', 'aria-labelledby': 'archive-title' }, [
        el('header', { class: 'archive-intro' }, [
          el('h1', { class: 'page-title', id: 'archive-title', text: '图像资料库' }),
          el('p', { text: '从来源图像到服饰部件，连接考证、制作与游戏。' }),
        ]),
    el('div', { class: 'toolbar archive-toolbar', role: 'search', 'aria-label': '检索资料' }, [
      el('div', { class: 'field grow' }, [el('label', { for: 'f-q', text: '关键词' }), qInput]),
      el('div', { class: 'field' }, [el('label', { for: 'f-status', text: '状态' }), statusSel]),
      applyBtn,
      resetBtn,
    ]),
    el('div', { class: 'archive-results' }, [activeFilters, countSpan]),
    grid,
      ]),
    ]),
  );
  await load();
}

// ---------- 详情 ----------
async function renderDetail(token, id) {
  setNavCurrent('archive');
  let data;
  let allRecords;
  let questionData;
  try {
    data = await api(`/api/records/${encodeURIComponent(id)}`);
    if (isStale(token)) return;
    allRecords = await api('/api/records');
    if (isStale(token)) return;
    questionData = await api(`/api/questions?record_id=${encodeURIComponent(id)}`);
  } catch (err) {
    if (isStale(token)) return;
    view.replaceChildren(
      el('h1', { class: 'page-title', text: '记录加载失败' }),
      el('p', { class: 'page-sub', text: err.message }),
      el('a', { class: 'btn btn-quiet', href: '#/archive', text: '返回资料库' }),
    );
    return;
  }
  if (isStale(token)) return;
  await loadAssets(); if (isStale(token)) return;
  const { record, children, parent } = data;

  // 左栏：媒体（原始证据在前，生成概念在后并明确标注非证据）
  const mainBox = el('div', { class: 'media-main' });
  const tabs = el('div', { class: 'media-tabs' });
  const mediaNote = el('p', { class: 'media-note' });
  const fullLink = el('a', { class: 'full-image-link', href: '#', target: '_blank', rel: 'noreferrer', text: '打开完整原图 ↗' });

  const orderedIndices = [
    ...record.media.map((m, i) => (m.role === 'source' ? i : -1)).filter((i) => i >= 0),
    ...record.media.map((m, i) => (m.role !== 'source' ? i : -1)).filter((i) => i >= 0),
  ];

  function showMedia(index) {
    const media = record.media[index];
    mainBox.replaceChildren();
    const src = safeImgSrc(media.path);
    if (src) {
      // 详情主图默认显示完整原图，不做 CSS 裁切。
      const photo = el('img', {
        src, alt:media.label || record.title, loading:'eager', decoding:'sync',
        ...(record.record_type === 'component' || record.id.endsWith('-P01') ? {class:'detail-source-crop'} : {}),
      });
      if (photo.classList.contains('detail-source-crop')) {
        const focus = media.focus || {x:50,y:50};
        photo.style.objectPosition = `${focus.x}% ${focus.y}%`;
      }
      const model = GAME_ASSETS[record.id]?.model;
      mainBox.append(model ? el('a', {class:'source-to-model', href:'#/workshop?model=' + encodeURIComponent(model), 'aria-label':'预览模型 · ' + record.title}, [photo, el('span', {class:'atlas-action', text:'3D ↗'})]) : photo);
      fullLink.href = src;
      fullLink.style.display = '';
    } else {
      mainBox.append(el('span', { class: 'hint', text: '媒体路径无效' }));
      fullLink.style.display = 'none';
    }
    mediaNote.replaceChildren(
      media.role === 'generated_concept'
        ? el('span', { text: '生成概念图' })
        : el('span', { text: '来源图像' }),
    );
    [...tabs.children].forEach((btn) => btn.setAttribute('aria-pressed', String(Number(btn.dataset.index) === index)));
  }

  for (const i of orderedIndices) {
    const media = record.media[i];
    const btn = el('button', { type: 'button', 'data-index': String(i) }, [
      media.role === 'generated_concept'
        ? tag('生成概念 · 非证据', 'role-generated_concept')
        : tag('原始证据', 'role-source'),
      ` ${media.label || media.path}`,
    ]);
    btn.addEventListener('click', () => showMedia(i));
    tabs.append(btn);
  }
  if (record.media.length > 0) showMedia(orderedIndices[0]);
  else {
    mediaNote.textContent = PUBLIC_SITE ? '来源图像尚未开放；可查看图纸与 3D 模型。' : '本记录暂无本地图像。';
    fullLink.style.display = 'none';
  }

  // 向既有记录附加图像：POST /api/media 上传，再 PATCH media 保留现有数组。
  const uploadFile = el('input', { type: 'file', id: 'm-file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  const uploadLabel = el('input', { type: 'text', id: 'm-label', placeholder: '图注（可选）' });
  const uploadMsg = el('span', { class: 'form-msg', role: 'status' });
  const uploadBtn = el('button', { class: 'btn btn-quiet', type: 'button', text: '上传并附加到本记录' });
  uploadBtn.addEventListener('click', async () => {
    uploadMsg.className = 'form-msg';
    const file = uploadFile.files && uploadFile.files[0];
    if (!file) {
      uploadMsg.classList.add('err');
      uploadMsg.textContent = '请先选择图片文件。';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      uploadMsg.classList.add('err');
      uploadMsg.textContent = '图片超过 8MB 上限。';
      return;
    }
    uploadMsg.textContent = '上传中…';
    uploadBtn.disabled = true;
    try {
      const dataUrl = await readFileAsDataURL(file);
      const base64 = String(dataUrl).split(',')[1];
      const saved = await api('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_base64: base64, mime: file.type }),
      });
      const media = [...(record.media || []), {
        path: saved.path,
        role: 'source',
        label: uploadLabel.value.trim() || file.name.slice(0, 120),
        focus: { x: 50, y: 50 },
      }];
      await api(`/api/records/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media }),
      });
      if (isStale(token)) return;
      flashMsg = '图片已附加到本记录。';
      renderDetail(token, record.id);
    } catch (err) {
      uploadMsg.classList.add('err');
      uploadMsg.textContent = `附加失败：${err.message}`;
      uploadBtn.disabled = false;
    }
  });

  const mediaPanel = el('div', { class: 'panel' }, [
    el('h2', { text: '图像媒体' }),
    mainBox,
    fullLink,
    tabs,
    mediaNote,
    ...(!PUBLIC_SITE ? [section('附加图像', [
      field('图片文件（PNG/JPEG/GIF/WebP，≤8MB）', uploadFile),
      field('图注', uploadLabel),
      el('div', { class: 'form-actions' }, [uploadBtn, uploadMsg]),
    ], false)] : []),
  ]);

  const provenancePanel = el('div', { class: 'panel' }, [
    el('h2', { text: '来源（当前记录）' }),
    el('dl', { class: 'meta' }, [
      el('dt', { text: '作者' }), el('dd', { text: record.source?.author || '待补' }),
      el('dt', { text: '拍摄时间' }), el('dd', { text: record.source?.captured_at || '待补' }),
      el('dt', { text: '拍摄地点' }), el('dd', { text: record.source?.place || '待补' }),
      el('dt', { text: '原始网址' }), sourceUrlNode(record.source?.url),
      el('dt', { text: '授权' }), el('dd', { text: record.source?.license || '待确认（内部研究）' }),
      ...(record.source?.note ? [el('dt', { text: '校验' }), el('dd', { class: 'mono', text: record.source.note })] : []),
    ]),
  ]);

  // 右栏：分组编辑（避免整表平铺）
  const titleInput = el('input', { type: 'text', id: 'e-title', value: record.title });
  const catSel = el('select', { id: 'e-category' }, CATEGORIES.map((c) => el('option', { value: c, text: c })));
  catSel.value = record.category;
  const statusSel = el('select', { id: 'e-status' }, STATUSES.map((s) => el('option', { value: s, text: s })));
  statusSel.value = record.status;
  const typeSel = el('select', { id: 'e-record-type' }, RECORD_TYPES.map(([v, label]) => el('option', { value: v, text: label })));
  typeSel.value = record.record_type || 'object';
  const cultureInput = el('input', { type: 'text', id: 'e-culture', value: record.culture?.text || '', placeholder: '待补；用户提供归属请注明' });
  const placeInput = el('input', { type: 'text', id: 'e-place', value: record.place || '', placeholder: '待补' });
  const dateInput = el('input', { type: 'text', id: 'e-date', value: record.date_text || '', placeholder: '待补' });

  const parentSel = el('select', { id: 'e-parent' }, [
    el('option', { value: '', text: '（无母条目）' }),
    ...allRecords.records
      .filter((r) => r.id !== record.id)
      .map((r) => el('option', { value: r.id, text: `${r.title}（${r.id}）` })),
  ]);
  parentSel.value = record.parent_id || '';
  const collectionInput = el('input', { type: 'text', id: 'e-collection', value: record.collection_id || '', placeholder: '集合名称；无则留空' });

  const srcAuthorInput = el('input', { type: 'text', id: 'e-src-author', value: record.source?.author || '', placeholder: '待补' });
  const srcCapturedInput = el('input', { type: 'text', id: 'e-src-captured', value: record.source?.captured_at || '', placeholder: '待补，如 2026-10' });
  const srcPlaceInput = el('input', { type: 'text', id: 'e-src-place', value: record.source?.place || '', placeholder: '待补' });
  const srcUrlInput = el('input', { type: 'url', id: 'e-src-url', value: record.source?.url || '', placeholder: '待补；无出处请留空' });
  const srcLicenseInput = el('input', { type: 'text', id: 'e-src-license', value: record.source?.license || '', placeholder: '待确认（内部研究）' });

  const notesInput = el('textarea', { id: 'e-notes', text: record.notes || '' });
  const obsInput = el('textarea', { id: 'e-obs', text: (record.observations || []).join('\n') });

  const msg = el('span', { class: 'form-msg', role: 'status' });
  const saveBtn = el('button', { class: 'btn', type: 'button', text: '保存修改' });
  saveBtn.addEventListener('click', async () => {
    msg.className = 'form-msg';
    msg.textContent = '保存中…';
    saveBtn.disabled = true;
    try {
      await api(`/api/records/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput.value,
          category: catSel.value,
          status: statusSel.value,
          record_type: typeSel.value,
          parent_id: parentSel.value,
          collection_id: collectionInput.value,
          culture_text: cultureInput.value,
          place: placeInput.value,
          date_text: dateInput.value,
          source_author: srcAuthorInput.value,
          source_captured_at: srcCapturedInput.value,
          source_place: srcPlaceInput.value,
          source_url: srcUrlInput.value,
          source_license: srcLicenseInput.value,
          notes: notesInput.value,
          observations: obsInput.value.split('\n').map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (isStale(token)) return;
      flashMsg = '已保存。';
      renderDetail(token, record.id);
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = `保存失败：${err.message}`;
      saveBtn.disabled = false;
    }
  });

  const editPanel = el('div', { class: 'panel' }, [
    el('h2', { text: '编辑记录' }),
    section('基本信息', [
      field('名称', titleInput),
      field('类别', catSel),
      field('状态', statusSel),
      field('记录类型', typeSel),
      field('文化与社群', cultureInput),
      field('地点', placeInput),
      field('年代', dateInput),
    ]),
    section('关系与集合', [
      field('母条目', parentSel),
      field('专题集合 ID', collectionInput),
      el('p', { class: 'hint', text: '母条目构成套装—部件关系；不允许循环。部件与其母条目互链显示在下方“标识与关系”面板。' }),
    ]),
    section('出处与授权（可编辑）', [
      field('作者', srcAuthorInput),
      field('拍摄时间', srcCapturedInput),
      field('拍摄地点', srcPlaceInput),
      field('原始网址', srcUrlInput),
      field('授权', srcLicenseInput),
    ]),
    section('笔记与观察', [
      field('笔记', notesInput),
      field('观察（每行一条，只写图中可见内容）', obsInput),
    ]),
    el('div', { class: 'form-actions' }, [saveBtn, msg]),
  ]);

  const relationItems = [];
  if (parent) {
    relationItems.push(el('li', {}, [
      '母条目：', el('a', { href: `#/record/${encodeURIComponent(parent.id)}`, text: `${parent.title}（${parent.id}）` }),
    ]));
  }
  for (const child of children) {
    relationItems.push(el('li', {}, [
      '部件：', el('a', { href: `#/record/${encodeURIComponent(child.id)}`, text: `${child.title}（${child.id}）` }),
      ' ', tag(child.status, `status-${child.status}`),
    ]));
  }
  if (relationItems.length === 0) relationItems.push(el('li', { text: '暂无关联记录。' }));

  const metaPanel = el('div', { class: 'panel' }, [
    el('h2', { text: '标识与关系' }),
    el('dl', { class: 'meta' }, [
      el('dt', { text: '记录 ID' }), el('dd', { class: 'mono', text: record.id }),
      el('dt', { text: '类型' }), el('dd', { text: record.record_type }),
      el('dt', { text: '专题集合' }), el('dd', { text: record.collection_id || '无' }),
      el('dt', { text: '修订' }), el('dd', { class: 'mono', text: `r${record.revision}` }),
      el('dt', { text: '录入时间' }), el('dd', { class: 'mono', text: record.created_at }),
      el('dt', { text: '最近修改' }), el('dd', { class: 'mono', text: record.updated_at }),
    ]),
    el('ul', { class: 'relation-list' }, relationItems),
  ]);

  // 关联题目：草稿 / 已审定 / 需复核状态一目了然。
  const questionItems = (questionData?.questions || []).map((q) => el('li', {}, [
    el('a', { href: `#/questions?record_id=${encodeURIComponent(q.record_id)}`, text: q.prompt }),
    ' ', ...questionStateTags(q),
  ]));
  const questionsPanel = el('div', { class: 'panel' }, [
    el('h2', { text: '关联题目' }),
    questionItems.length
      ? el('ul', { class: 'relation-list' }, questionItems)
      : el('p', { class: 'hint', text: '本记录暂无题目。题目仅可基于图像观察、用户澄清或注明出处，不得虚构历史答案。' }),
    el('div', { class: 'form-actions' }, [
      ...(!PUBLIC_SITE ? [el('a', { class: 'btn btn-quiet', href: `#/questions?record_id=${encodeURIComponent(record.id)}&new=1`, text: '为此记录出题' })] : []),
    ]),
  ]);

  // 游戏资产链接：已知映射才显示；模型为适配品，非考证证据。
  const asset = GAME_ASSETS[record.id];
  const assetPanel = asset ? el('div', { class: 'panel' }, [
    el('h2', { text: '游戏资产适配' }),
    el('dl', { class: 'meta' }, [
      el('dt', { text: '适配内容' }), el('dd', { text: asset.label }),
      el('dt', { text: '模型文件' }), el('dd', { class: 'mono', text: `/assets/models/${asset.model}.glb` }),
    ]),
    el('div', { class: 'form-actions' }, [
      el('a', { class: 'btn btn-quiet', href: `/assets/models/${asset.model}.glb`, download: '', text: '下载模型 (.glb)' }),
      el('a', { class: 'btn btn-quiet', href: `#/workshop?model=${asset.model}`, text: '在工坊中查看' }),
    ]),
    el('p', { class: 'hint', text: '适配说明：背面与系合方式为推断，材质依据参考图制作。' }),
  ]) : null;

  const compare=el('div',{class:'detail-compare'});
  mediaPanel.classList.add('source-column');
  mediaPanel.querySelector('h2').textContent='来源图像';
  compare.append(mediaPanel);
  if(asset?.drawing){
    const drawingStatus=el('p',{class:'hint drawing-status',text:asset.drawing_label+' · 模型展开，非裁剪纸样'});
    const drawing=el('img',{src:asset.drawing,alt:asset.drawing_label,loading:'lazy'});
    drawing.addEventListener('load',()=>drawing.closest('.drawing-column')?.classList.add('is-ready'),{once:true});
    drawing.addEventListener('error',()=>{
      drawing.hidden=true;
      drawingStatus.textContent='图纸资源暂不可用';
      drawing.closest('.drawing-column')?.classList.add('is-missing');
    },{once:true});
    compare.append(el('section',{class:'drawing-column'},[el('h2',{text:'图纸'}),drawing,drawingStatus]));
  }
  let detailViewer;
  if(asset){
    detailViewer=el('div',{class:'model-viewer detail-model'});
    const mode=el('select',{id:'motion-mode','aria-label':'动作'},['idle','walk','spin','sit','lie'].map((v,i)=>el('option',{value:v,text:['待机','行走','转圈','坐下','躺卧'][i]})));
    compare.append(el('section',{class:'model-column'},[el('h2',{text:'3D 预览'}),detailViewer,el('div',{class:'form-actions'},[mode,el('button',{id:'pause-motion',class:'btn btn-quiet',text:'暂停动作'}),el('button',{id:'reset-view',class:'btn btn-quiet',text:'复位'})]),el('p',{id:'motion-status',class:'hint'})]));
  }
  const flash = flashMsg
    ? el('p', { class: 'form-msg ok', role: 'status', text: flashMsg })
    : null;
  flashMsg = null;

  view.replaceChildren(
    el('a', { class: 'btn btn-quiet', href: '#/archive', text: '← 返回资料库' }),
    el('h1', { class: 'page-title', text: record.title }),
    el('p', { class: 'page-sub' }, [
      el('span', { class: 'mono', text: record.id }), ' ',
      tag(record.category), ' ', tag(record.status, `status-${record.status}`), ' ',
      tag(record.record_type || 'object'),
    ]),
    ...(flash ? [flash] : []),compare,
    el('div', { class: 'detail-layout' }, [
      el('div', {}, [provenancePanel, assetPanel]),
      el('div', {}, [
        ...(PUBLIC_SITE && record.observations?.length ? [el('section', {class:'panel'}, [el('h2',{text:'观察与研究'}),el('ul',{class:'relation-list'},record.observations.map(text=>el('li',{text})))])] : []),
        ...(!PUBLIC_SITE ? [section('编辑资料',[editPanel],false)] : []), metaPanel, questionsPanel]),
    ]),
  );
  if(detailViewer){
    const label = el('span',{class:'atlas-action',text:'打开三维模型'});
    const open=el('button',{class:'detail-poster',type:'button','aria-label':'打开三维模型 · '+asset.label},[
      el('img',{src:asset.cover,alt:'',decoding:'sync',loading:'eager'}),label
    ]);
    detailViewer.append(open);
    open.onclick=async()=>{
      open.disabled=true;
      try {
        const {mountViewer}=await import('/viewer.js');
        if(!isStale(token))activeViewer=mountViewer(detailViewer,{root:compare,modelUrl:'/assets/models/'+asset.model+'.glb'});
      } catch {open.disabled=false;label.textContent='重试三维预览';}
    };
  }
}

function sourceUrlNode(url) {
  if (!url) return el('dd', { text: '待补' });
  if (/^https?:\/\//i.test(url)) {
    return el('dd', {}, [el('a', { href: url, rel: 'noreferrer', text: url })]);
  }
  return el('dd', { text: '待补' });
}

// ---------- 快速收录 ----------
function renderIntake() {
  setNavCurrent('intake');
  const fileInput = el('input', { type: 'file', id: 'i-file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  const urlInput = el('input', { type: 'url', id: 'i-url', placeholder: 'https://…（无出处请留空）' });
  const titleInput = el('input', { type: 'text', id: 'i-title', placeholder: '描述性暂名，可留空' });
  const catSel = el('select', { id: 'i-category' },
    ['待分类', ...CATEGORIES.filter((c) => c !== '待分类')].map((c) => el('option', { value: c, text: c })));
  const notesInput = el('textarea', { id: 'i-notes', placeholder: '随手记：来源线索、可见内容、待办…' });
  const msg = el('span', { class: 'form-msg', role: 'status' });
  const submitBtn = el('button', { class: 'btn', type: 'button', text: '收录' });

  submitBtn.addEventListener('click', async () => {
    msg.className = 'form-msg';
    msg.textContent = '提交中…';
    submitBtn.disabled = true;
    try {
      const media = [];
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        if (file.size > 8 * 1024 * 1024) throw new Error('图片超过 8MB 上限');
        const dataUrl = await readFileAsDataURL(file);
        const base64 = String(dataUrl).split(',')[1];
        const saved = await api('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_base64: base64, mime: file.type }),
        });
        media.push({ path: saved.path, role: 'source', label: file.name.slice(0, 120), focus: { x: 50, y: 50 } });
      }
      const { record } = await api('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput.value,
          category: catSel.value,
          notes: notesInput.value,
          source_url: urlInput.value,
          media,
        }),
      });
      msg.classList.add('ok');
      msg.textContent = `已收录为 ${record.id}，正在打开…`;
      location.hash = `#/record/${encodeURIComponent(record.id)}`;
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  view.replaceChildren(
    el('h1', { class: 'page-title', text: '快速收录' }),
    el('p', { class: 'page-sub', text: '最小输入是一张图或一个链接；其余字段可以之后补。不为了通过校验伪造网址。' }),
    el('div', { class: 'intake-form' }, [
      field('图片（可选，PNG/JPEG/GIF/WebP，≤8MB）', fileInput),
      field('来源网址（可选）', urlInput),
      field('暂名（可选）', titleInput),
      field('大体类别', catSel),
      field('笔记（可选）', notesInput),
      el('div', { class: 'form-actions' }, [submitBtn, msg]),
    ]),
  );
}

// ---------- 工坊 ----------


async function renderWorkshop(params, token) {
  const {mountViewer}=await import('/viewer.js');
  if(isStale(token))return;
  await loadAssets();
  if(isStale(token))return;
  const WORKSHOP_MODELS=Object.values(GAME_ASSETS).map(a=>[a.model,a.label]);
  if(!WORKSHOP_MODELS.length){view.replaceChildren(el('p',{text:'尚无数字资产。'}));return;}
  setNavCurrent('workshop');

  const requested = params.get('model');
  const initialModel = WORKSHOP_MODELS.some(([v]) => v === requested) ? requested : WORKSHOP_MODELS[0][0];

  const refImg = el('div');

  const modelSel = el('select', { id: 'asset-model' },
    WORKSHOP_MODELS.map(([v, label]) => el('option', { value: v, text: label })));
  modelSel.value = initialModel;

  const viewerBox = el('div', { id: 'model-viewer', class: 'model-viewer' });

  const modeSel = el('select', { id: 'motion-mode', 'aria-label': '动作模式' }, [
    el('option', { value: 'idle', text: '待机 idle' }),
    el('option', { value: 'walk', text: '行走 walk' }),
    el('option', { value: 'spin', text: '旋转 spin' }),
    el('option', { value: 'handwork', text: '手持鞋垫 handwork' }),
    el('option', { value: 'sit', text: '坐下 · 衣料检查' }),
    el('option', { value: 'lie', text: '坐下 → 躺卧 · 衣料检查' }),
  ]);
  const paceInput = el('input', { type: 'range', id: 'pace', min: '0.25', max: '2', step: '0.05', value: '1' });
  const paceOut = el('output', { text: '1.00×' });
  const spinSpeed = el('input', { type: 'range', id: 'spin-speed', min: '0', max: '120', step: '1', value: '45' });
  const spinSpeedOut = el('output', { text: '45°/s' });
  const spinVar = el('input', { type: 'range', id: 'spin-variation', min: '0', max: '0.9', step: '0.05', value: '0' });
  const spinVarOut = el('output', { text: '0.00' });
  const pauseBtn = el('button', { id: 'pause-motion', class: 'btn btn-quiet', type: 'button', text: '暂停动作' });
  const replayBtn = el('button', { id: 'replay-motion', class: 'btn btn-quiet', type: 'button', text: '重播动作' });
  const stepBtn = el('button', { id: 'step-motion', class: 'btn btn-quiet', type: 'button', text: '单步 1/60 秒' });
  const resetBtn = el('button', { id: 'reset-view', class: 'btn btn-quiet', type: 'button', text: '重置视图' });
  const progressInput = el('input', { id: 'motion-progress', type: 'range', min: '0', max: '1', step: '0.001', value: '0' });
  const statusLine = el('p', { id: 'motion-status', class: 'motion-status', role: 'status', text: '' });

  // 情境分组：行走节奏仅在行走模式显示，旋转参数仅在旋转模式显示。
  // 查看器对 #motion-mode 的 change 有自己的状态监听；这里只切换分组可见性，
  // 节奏预设按钮会让查看器把模式切到 walk，因此点击后同步显示节奏组。
  function syncModeGroups(mode) {
    for (const group of [paceGroup, spinGroup]) group.hidden = group.dataset.modeGroup !== mode;
  }

  // 节奏预设：写入 #pace 并派发 input，由查看器统一响应。
  const pacePresets = el('div', { class: 'seg-row', role: 'group', 'aria-label': '节奏预设' },
    [['0.55', '慢速'], ['1', '常速'], ['1.65', '快速']].map(([pace, label]) => {
      const btn = el('button', { type: 'button', class: 'seg-btn', 'data-pace': pace, text: label });
      btn.addEventListener('click', () => {
        paceInput.value = pace;
        paceInput.dispatchEvent(new Event('input'));
        syncModeGroups('walk');
      });
      return btn;
    }));

  const paceGroup = el('div', { class: 'mode-group', 'data-mode-group': 'walk' }, [
    el('label', { for: 'pace', text: '行走节奏（0.25–2 倍）' }),
    el('div', { class: 'control-row' }, [paceInput, paceOut]),
    pacePresets,
  ]);
  const spinGroup = el('div', { class: 'mode-group', 'data-mode-group': 'spin' }, [
    el('label', { for: 'spin-speed', text: '旋转速度（0–120 度/秒）' }),
    el('div', { class: 'control-row' }, [spinSpeed, spinSpeedOut]),
    el('label', { for: 'spin-variation', text: '旋转变化（0–0.9）' }),
    el('div', { class: 'control-row' }, [spinVar, spinVarOut]),
  ]);
  syncModeGroups(modeSel.value);
  modeSel.addEventListener('change', () => syncModeGroups(modeSel.value));

  // 视角预设：在容器上记录 data-angle 并派发 viewer-angle 事件，供查看器实现接管。
  const anglePresets = el('div', { class: 'seg-row', role: 'group', 'aria-label': '视角预设' },
    [['0', '正面'], ['90', '侧面'], ['180', '背面']].map(([angle, label], i) => {
      const btn = el('button', { type: 'button', class: 'seg-btn', 'data-angle': angle, text: label, 'aria-pressed': String(i === 0) });
      btn.addEventListener('click', () => {
        [...anglePresets.children].forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        viewerBox.dataset.angle = angle;
        viewerBox.dispatchEvent(new CustomEvent('viewer-angle', { bubbles: true, detail: { angle: Number(angle) } }));
      });
      return btn;
    }));
  viewerBox.dataset.angle = '0';

  // 珠串物理参数：写入容器 data 属性并派发事件，查看器同时监听控件
  // 本身，因此重挂载模型时也能从同一组输入恢复当前参数。
  const dampingInput = el('input', { type: 'range', id: 'physics-damping', min: '0.01', max: '0.16', step: '0.01', value: '0.08' });
  const dampingOut = el('output', { text: '0.08' });
  const gravityInput = el('input', { type: 'range', id: 'physics-gravity', min: '0.5', max: '1.5', step: '0.05', value: '1' });
  const gravityOut = el('output', { text: '1.00×' });
  const beadInput = el('input', { type: 'range', id: 'bead-size', min: '0.006', max: '0.012', step: '0.001', value: '0.008' });
  const beadOut = el('output', { text: '0.008' });
  const resetPhysicsBtn = el('button', { id: 'reset-physics', class: 'btn btn-quiet', type: 'button', text: '重置物理参数' });

  function publishPhysics() {
    viewerBox.dataset.physicsDamping = dampingInput.value;
    viewerBox.dataset.physicsGravity = gravityInput.value;
    viewerBox.dataset.beadSize = beadInput.value;
    viewerBox.dispatchEvent(new CustomEvent('physics-params', {
      bubbles: true,
      detail: {
        damping: Number(dampingInput.value),
        gravity: Number(gravityInput.value),
        beadSize: Number(beadInput.value),
      },
    }));
  }
  dampingInput.addEventListener('input', () => { dampingOut.textContent = Number(dampingInput.value).toFixed(2); publishPhysics(); });
  gravityInput.addEventListener('input', () => { gravityOut.textContent = `${Number(gravityInput.value).toFixed(2)}×`; publishPhysics(); });
  beadInput.addEventListener('input', () => { beadOut.textContent = Number(beadInput.value).toFixed(3); publishPhysics(); });
  resetPhysicsBtn.addEventListener('click', () => {
    dampingInput.value = '0.08';
    gravityInput.value = '1';
    beadInput.value = '0.008';
    dampingOut.textContent = '0.08';
    gravityOut.textContent = '1.00×';
    beadOut.textContent = '0.008';
    publishPhysics();
  });
  publishPhysics();

  view.replaceChildren(
    el('h1', { class: 'page-title', text: '数字工坊' }),

    el('div', { class: 'workshop-layout' }, [
      el('div', { class: 'panel workshop-stage' }, [
        el('h2', { text: '三维预览' }),
        field('资产模型', modelSel),
        viewerBox,
        el('div', { class: 'transport-bar' }, [
          el('div', { class: 'transport-timeline' }, [
            el('label', { for: 'motion-progress', text: '动作进度' }),
            progressInput,
          ]),
          pauseBtn,
          replayBtn,
          stepBtn,
        ]),
        statusLine,
        el('p', { class: 'hint', text: '坐下和躺卧沿用百褶裙编辑器姿态。单步检查惯性与接触；拖动进度会重新初始化饰物，连续播放才保留物理历史。' }),
      ]),
      el('aside', { class: 'workshop-side' }, [
        section('参考资料与出处', [
          refImg,
        ]),
        section('动作', [
          field('动作模式', modeSel),
          paceGroup,
          spinGroup,
        ]),
        section('视角', [
          el('label', { text: '视角预设' }),
          anglePresets,
          el('div', { class: 'form-actions' }, [resetBtn]),
        ]),
        section('珠串物理', [
          el('label', { for: 'physics-damping', text: '阻尼' }),
          el('div', { class: 'control-row' }, [dampingInput, dampingOut]),
          el('label', { for: 'physics-gravity', text: '重力倍率' }),
          el('div', { class: 'control-row' }, [gravityInput, gravityOut]),
          el('label', { for: 'bead-size', text: '珠径（模型单位）' }),
          el('div', { class: 'control-row' }, [beadInput, beadOut]),
          el('div', { class: 'form-actions' }, [resetPhysicsBtn]),
          el('p', { class: 'hint', text: '珠串从头饰绕过肩头，垂在身前。播放动作可观察肩头两侧的珠串如何随重力落下。' }),
          el('p', { class: 'hint', text: '紫色米珠串属于头饰。几何参数在 Godot 原生研究台调节：珠径、重复单元、紧密度、辫冠、朝上头花及挂点；本页查看导出的模型。' }),
        ], false),
        el('div', { class: 'form-actions' }, [
          el('a', { class: 'btn btn-quiet', href: '#/node-styles', text: '发型节点样式对比' }),
          el('a', { class: 'btn btn-quiet', href: '#/motifs', text: 'motif 参数资产' }),
        ]),
      ]),
    ]),
  );

  let referenceRequest=0;
  async function showReference(model){
    const serial=++referenceRequest;
    const id=Object.keys(GAME_ASSETS).find(id=>GAME_ASSETS[id].model===model);
    refImg.replaceChildren();
    if(!id)return;
    try{const {record}=await api('/api/records/'+encodeURIComponent(id));
      if(isStale(token)||serial!==referenceRequest)return;
      const source = pickThumbMedia(record.media);
      const src = safeImgSrc(source?.path);
      const entry = el('a', {href:'#/record/'+encodeURIComponent(id),class:'workshop-source-link'}, [
        src ? el('img', {src, alt:source.label || record.title, class:'workshop-source-photo'}) : null,
        el('span', {text:'查看档案 · ' + record.title}),
      ]);
      refImg.append(entry);
    }catch{if(!isStale(token)&&serial===referenceRequest)refImg.append(el('p',{text:'关联资料暂不可用。'}));}
  }
  function mount(model) {
    showReference(model);
    if (activeViewer) {
      cleanupViewer(activeViewer);
      activeViewer = null;
    }
    activeViewer = mountViewer(viewerBox, {
      modelUrl: `/assets/models/${model}.glb`,
      root: view,
      outputs: { pace: paceOut, spinSpeed: spinSpeedOut, spinVariation: spinVarOut },
    });
  }

  modelSel.addEventListener('change', () => {
    history.replaceState(null, '', '#/workshop?model=' + encodeURIComponent(modelSel.value));
    mount(modelSel.value);
  });
  mount(initialModel);
}

// ---------- 路由 ----------
function route() {
  const token = ++routeToken;
  if (activeViewer) {
    cleanupViewer(activeViewer);
    activeViewer = null;
  }
  const hash = location.hash || '#/';
  const [pathPart, queryPart] = hash.slice(1).split('?');
  const params = new URLSearchParams(queryPart || '');

  const dispatch = async () => {
    if (pathPart === '/' || pathPart === '') {
      await renderHome({view, el, setNavCurrent, api, loadAssets, ensembleCard, recordCard, isStale, token});
    } else if(pathPart === '/archive'){
      await renderArchive(token,params);
    } else if(pathPart === '/practice'){
      await renderPractice({view,el,api,setNavCurrent,isStale,token});
    } else if(pathPart === '/guide'){
      renderGuide({view,el,setNavCurrent,params});
    } else if(pathPart === '/contribute'){
      renderContribute({view,el,setNavCurrent});
    } else if (pathPart.startsWith('/record/')) {
      await renderDetail(token, decodeURIComponent(pathPart.slice('/record/'.length)));
    } else if (pathPart === '/intake' && !PUBLIC_SITE) {
      renderIntake();
    } else if (pathPart === '/workshop') {
      await renderWorkshop(params,token);
    } else if (pathPart === '/node-styles') {
      await renderNodeStyles(params, { view, el, tag, setNavCurrent, isStale, token });
    } else if (pathPart === '/motifs') {
      await renderMotifs(params, { view, el, tag, setNavCurrent, isStale, token });
    } else if (pathPart === '/questions' && !PUBLIC_SITE) {
      await renderQuestions(params, { view, el, api, tag, field, setNavCurrent, questionStateTags, isStale, token });
    } else {
      await renderArchive(token, params);
    }
  };

  // 路由错误必须可见，不静默吞掉。
  dispatch().catch((err) => {
    if (!isStale(token)) renderRouteError(err);
  });
}

window.addEventListener('hashchange', route);
route();
