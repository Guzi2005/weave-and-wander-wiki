import {validateLibraryPart,assertLibraryDeletion,LibraryError} from './library-schema.mjs';
// W&W Wiki 本地 JSON 数据层：加载、校验、原子持久化。
// 仅使用 Node 内置模块。未知字段允许为空，不因缺出处阻塞保存。

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const CATEGORIES = ['服装', '饰品', '布艺', '玩具', '工具', '其他', '待分类'];
export const STATUSES = ['待整理', '待考证', '考证中', '已整理'];

const LIMITS = {
  title: 120,
  notes: 4000,
  short: 200,       // place / date_text / culture 等短字段
  url: 500,
  observation: 500,
  maxObservations: 50,
};

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function assertString(value, field, max, { optional = true } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new ValidationError(`字段 ${field} 不能为空`);
  }
  if (typeof value !== 'string') throw new ValidationError(`字段 ${field} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed && !optional) throw new ValidationError(`字段 ${field} 不能为空`);
  if (trimmed.length > max) throw new ValidationError(`字段 ${field} 超过长度上限 ${max}`);
  return trimmed === '' ? null : trimmed;
}

function assertUrl(value) {
  const url = assertString(value, 'source_url', LIMITS.url);
  if (url === null) return null;
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
  } catch {
    throw new ValidationError('source_url 必须是有效的 http:// 或 https:// 网址；没有出处时请留空');
  }
  return url;
}

function assertChoice(value, field, choices, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!choices.includes(value)) throw new ValidationError(`字段 ${field} 必须是：${choices.join(' / ')}`);
  return value;
}

function assertObservations(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('observations 必须是字符串数组');
  if (value.length > LIMITS.maxObservations) throw new ValidationError(`observations 最多 ${LIMITS.maxObservations} 条`);
  return value.map((item, i) => {
    const text = assertString(item, `observations[${i}]`, LIMITS.observation, { optional: false });
    return text;
  });
}

function assertMedia(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('media 必须是数组');
  if (value.length > 50) throw new ValidationError('media 最多 50 项');
  return value.map((item, i) => {
    if (!item || typeof item !== 'object') throw new ValidationError(`media[${i}] 必须是对象`);
    const p = assertString(item.path, `media[${i}].path`, 300, { optional: false });
    if (!/^\/(media|assets)\/[A-Za-z0-9._-]+$/.test(p)) {
      throw new ValidationError(`media[${i}].path 只允许 /media/ 或 /assets/ 下的安全文件名`);
    }
    const role = item.role === 'generated_concept' ? 'generated_concept' : 'source';
    const label = assertString(item.label, `media[${i}].label`, 120);
    const focus = item.focus && Number.isFinite(item.focus.x) && Number.isFinite(item.focus.y)
      ? { x: Math.min(100, Math.max(0, item.focus.x)), y: Math.min(100, Math.max(0, item.focus.y)) }
      : { x: 50, y: 50 };
    return { path: p, role, label, focus };
  });
}

function assertObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('请求体必须是对象');
}

function validateRelations(record, records) {
  if (!record.parent_id) return;
  const visited = new Set([record.id]);
  let parentId = record.parent_id;
  while (parentId) {
    if (visited.has(parentId)) throw new ValidationError('母条目关系不能形成循环');
    visited.add(parentId);
    const parent = records.find((r) => r.id === parentId);
    if (!parent) throw new ValidationError(`parent_id 指向不存在的记录：${parentId}`);
    parentId = parent.parent_id;
  }
}

function questionFields(input, previous, records) {
  assertObject(input);
  const merged = { ...previous, ...input };
  const recordId = assertString(merged.record_id, 'record_id', 60, { optional: false });
  const record = records.find((r) => r.id === recordId);
  if (!record) throw new ValidationError('题目必须关联已有档案记录');
  if (!Array.isArray(merged.options) || merged.options.length < 2 || merged.options.length > 6) {
    throw new ValidationError('题目须有 2–6 个选项');
  }
  const options = merged.options.map((option) => assertString(option, 'option', 500, { optional: false }));
  if (new Set(options).size !== options.length) throw new ValidationError('选项不能重复');
  if (!Number.isInteger(merged.correct_index) || merged.correct_index < 0 || merged.correct_index >= options.length) {
    throw new ValidationError('correct_index 必须指向现有选项');
  }
  // Editing an approved question is a new draft unless explicitly reviewed again.
  const status = assertChoice(input.status, 'status', ['draft', 'approved'], 'draft');
  const reviewedBy = assertString(merged.reviewed_by, 'reviewed_by', 120);
  const gameVersions = merged.game_versions ?? [];
  if (!Array.isArray(gameVersions) || gameVersions.length > 30) throw new ValidationError('game_versions 必须为版本列表');
  if (status === 'approved' && !reviewedBy) throw new ValidationError('批准题目须填写 reviewed_by');
  return {
    record_id: recordId,
    game_versions: [...new Set(gameVersions.map(v => assertString(v, 'game_versions', 80, { optional: false })))],
    record_revision: record.revision,
    prompt: assertString(merged.prompt, 'prompt', 1000, { optional: false }),
    options,
    correct_index: merged.correct_index,
    explanation: assertString(merged.explanation, 'explanation', 2000, { optional: false }),
    evidence_note: assertString(merged.evidence_note, 'evidence_note', 2000, { optional: false }),
    evidence_kind: assertChoice(merged.evidence_kind, 'evidence_kind', ['image_observation', 'user_clarification', 'source'], 'source'),
    status,
    reviewed_by: status === 'approved' ? reviewedBy : null,
    reviewed_at: status === 'approved' ? new Date().toISOString() : null,
  };
}

// 自定义稳定 ID：WW- 前缀 + 大写字母/数字分段，供幂等导入指定规范 ID（如 WW-MOS-001-P01）。
const CUSTOM_ID_PATTERN = /^WW-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function assertCustomId(value, existing) {
  if (value === undefined || value === null) return null;
  const id = assertString(value, 'id', 60, { optional: false });
  if (!CUSTOM_ID_PATTERN.test(id)) {
    throw new ValidationError('自定义 id 必须形如 WW-MOS-001-P01：WW- 前缀，分段仅含大写字母与数字');
  }
  if (existing.has(id)) throw new ValidationError(`记录 ID 已存在：${id}`);
  return id;
}

function generateId(existing) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `WW-L-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    if (!existing.has(id)) return id;
  }
  throw new Error('无法生成唯一记录 ID');
}

export function createStore({ dataFile, seedFile }) {
  let db = null;

  function load() {
    mkdirSync(path.dirname(dataFile), { recursive: true });
    if (!existsSync(dataFile)) {
      if (!existsSync(seedFile)) throw new Error(`缺少种子数据文件：${seedFile}`);
      copyFileSync(seedFile, dataFile);
    }
    const parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.records)) throw new Error('数据文件格式错误：缺少 records 数组');
    parsed.questions ??= [];
    if (!Array.isArray(parsed.questions)) throw new Error('数据文件格式错误：questions 必须是数组');
    for (const record of parsed.records) record.revision ??= 1;
    db = parsed;
    return structuredClone(db);
  }

  // 原子写：先写临时文件，再 rename 覆盖，避免中途断电留下半个 JSON。
  // create/patch 为同步调用，天然被事件循环串行化。
  function persist(next) {
    const tmp = `${dataFile}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmp, dataFile);
    db = next;
  }

  function summary(record) {
    return {
      id: record.id,
      title: record.title,
      record_type: record.record_type,
      category: record.category,
      status: record.status,
      parent_id: record.parent_id,
      collection_id: record.collection_id,
      culture: record.culture,
      media: structuredClone((record.media || []).filter(m => m.role === 'source').slice(0, 1)),
      revision: record.revision,
      updated_at: record.updated_at,
    };
  }

  return {
    load,
    libraryState(){return structuredClone(db.library||{revision:0,topics:null,trees:null,records:{},autosaves:[]});},
    setLibraryPart(part,value,vocabulary=[]){
      const validated=validateLibraryPart(part,value),next=structuredClone(db);
      next.library??={revision:0,topics:null,trees:null,records:{},autosaves:[]};
      if(part==='trees')assertLibraryDeletion(next.library.trees||vocabulary,validated,next.records,next.library.records,next.library.autosaves);
      if(part==='records')for(const [id,edit] of Object.entries(validated)){
        let record=next.records.find(r=>r.id===id);const now=new Date().toISOString();
        if(!record){record={id,title:edit.title,record_type:'object',category:'待分类',status:'待整理',parent_id:null,collection_id:null,culture:null,place:null,date_text:null,notes:null,observations:[],source:{},media:[],revision:0,created_at:now};next.records.push(record);}
        const categories=vocabulary.filter(n=>n.dimension==='object-kind'&&edit.tagIds.includes(n.id)&&CATEGORIES.includes(n.label)).map(n=>n.label);const category=categories.length===1?categories[0]:record.category;
        const changed=record.category!==category||record.title!==edit.title||(record.notes||'')!==edit.note||(record.source?.author||'')!==edit.source.author||(record.source?.url||'')!==edit.source.url;
        record.category=category;record.title=edit.title;record.notes=edit.note;record.source={...record.source,...edit.source};
        if(changed){record.revision=(record.revision||0)+1;record.updated_at=now;}
      }
      next.library[part]=validated;next.library.revision=(next.library.revision||0)+1;persist(next);return structuredClone(next.library);
    },
    saveLibraryFiles(input){
      const next=structuredClone(db);next.library??={revision:0,topics:null,trees:null,records:{},autosaves:[]};
      const record=next.records.find(r=>r.id===input.recordId);if(!record)throw new LibraryError('资料尚未保存');
      const asset=next.library.autosaves.find(r=>r.recordId===input.recordId);
      const item={...input,id:'autosave:'+input.recordId,status:'autosaved'};
      next.library.autosaves=[...(next.library.autosaves||[]).filter(r=>r.recordId!==input.recordId),item];
      const priorPaths=new Set((asset?.files||[]).map(f=>f.path));
      record.media=[...record.media.filter(m=>!priorPaths.has(m.path)),...input.files.filter(f=>f.type.startsWith('image/')).map(f=>({path:f.path,label:f.name,role:'source',focus:{x:50,y:50}}))];
      if(input.record?.parent_id){record.parent_id=assertString(input.record.parent_id,'parent_id',60);validateRelations(record,next.records);}
      if(CATEGORIES.includes(input.record?.category))record.category=input.record.category;
      item.record=structuredClone(record);next.library.revision=(next.library.revision||0)+1;persist(next);return structuredClone(item);
    },

    count() {
      return db.records.length;
    },

    list({ q = null, category = null, status = null } = {}) {
      let rows = db.records;
      if (category) rows = rows.filter((r) => r.category === category);
      if (status) rows = rows.filter((r) => r.status === status);
      if (q) {
        const needle = q.toLowerCase();
        rows = rows.filter((r) => [r.id, r.title, r.notes, r.culture?.text, r.place, r.collection_id]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)));
      }
      return rows.map(summary);
    },

    get(id) {
      const record = db.records.find((r) => r.id === id);
      if (!record) return null;
      const children = db.records.filter((r) => r.parent_id === id).map(summary);
      const parent = record.parent_id
        ? summary(db.records.find((r) => r.id === record.parent_id) || { id: record.parent_id, title: '（缺失的母条目）' })
        : null;
      return structuredClone({ record, children, parent });
    },

    create(input) {
      assertObject(input);
      const now = new Date().toISOString();
      const existingIds = new Set(db.records.map((r) => r.id));
      const record = {
        id: assertCustomId(input.id, existingIds) ?? generateId(existingIds),
        title: assertString(input.title, 'title', LIMITS.title) || '未命名线索',
        record_type: assertChoice(input.record_type, 'record_type', ['object', 'component', 'ensemble'], 'object'),
        category: assertChoice(input.category, 'category', CATEGORIES, '待分类'),
        status: '待整理',
        parent_id: assertString(input.parent_id, 'parent_id', 60),
        collection_id: assertString(input.collection_id, 'collection_id', 60),
        culture: null,
        place: null,
        date_text: null,
        notes: assertString(input.notes, 'notes', LIMITS.notes),
        observations: assertObservations(input.observations),
        source: { author: null, captured_at: null, place: null, url: assertUrl(input.source_url), license: null },
        media: assertMedia(input.media),
        created_at: now,
        updated_at: now,
        revision: 1,
      };
      validateRelations(record, db.records);
      const next = structuredClone(db);
      next.records.push(record);
      persist(next);
      return structuredClone(record);
    },

    patch(id, input) {
      assertObject(input);
      const next = structuredClone(db);
      const record = next.records.find((r) => r.id === id);
      if (!record) return null;
      if ('title' in input) {
        const title = assertString(input.title, 'title', LIMITS.title, { optional: false });
        record.title = title;
      }
      if ('category' in input) record.category = assertChoice(input.category, 'category', CATEGORIES, record.category);
      if ('status' in input) record.status = assertChoice(input.status, 'status', STATUSES, record.status);
      if ('record_type' in input) record.record_type = assertChoice(input.record_type, 'record_type', ['object', 'component', 'ensemble'], record.record_type);
      if ('parent_id' in input) record.parent_id = assertString(input.parent_id, 'parent_id', 60);
      if ('collection_id' in input) record.collection_id = assertString(input.collection_id, 'collection_id', 60);
      validateRelations(record, next.records);
      if ('notes' in input) record.notes = assertString(input.notes, 'notes', LIMITS.notes);
      if ('place' in input) record.place = assertString(input.place, 'place', LIMITS.short);
      if ('date_text' in input) record.date_text = assertString(input.date_text, 'date_text', LIMITS.short);
      if ('observations' in input) record.observations = assertObservations(input.observations);
      record.source ??= {};
      if ('source_url' in input) record.source.url = assertUrl(input.source_url);
      for (const key of ['author', 'captured_at', 'place', 'license']) {
        if (`source_${key}` in input) record.source[key] = assertString(input[`source_${key}`], `source_${key}`, 500);
      }
      if ('media' in input) record.media = assertMedia(input.media);
      if ('culture_text' in input) {
        const text = assertString(input.culture_text, 'culture_text', LIMITS.short);
        record.culture = text ? { text, attribution: record.culture?.attribution || 'user' } : null;
      }
      record.updated_at = new Date().toISOString();
      record.revision = (record.revision || 1) + 1;
      persist(next);
      return structuredClone(record);
    },

    attachMedia(id, mediaItem) {
      const next = structuredClone(db);
      const record = next.records.find((r) => r.id === id);
      if (!record) return null;
      const [item] = assertMedia([mediaItem]);
      record.media = assertMedia([...record.media, item]);
      record.updated_at = new Date().toISOString();
      record.revision = (record.revision || 1) + 1;
      persist(next);
      return structuredClone(record);
    },

    listQuestions({ status = null, record_id = null } = {}) {
      return structuredClone(db.questions.filter((q) => (!status || q.status === status) && (!record_id || q.record_id === record_id))
        .map((q) => ({ ...q, needs_review: q.record_revision !== db.records.find((r) => r.id === q.record_id)?.revision })));
    },

    getQuestion(id) {
      const question = db.questions.find((q) => q.id === id);
      return question ? structuredClone({ ...question, needs_review: question.record_revision !== db.records.find((r) => r.id === question.record_id)?.revision }) : null;
    },

    createQuestion(input) {
      const fields = questionFields(input, {}, db.records);
      const now = new Date().toISOString();
      const question = { id: generateId(new Set(db.questions.map((q) => q.id))).replace('WW-L-', 'WW-Q-'), ...fields, revision: 1, created_at: now, updated_at: now };
      const next = structuredClone(db);
      next.questions.push(question);
      persist(next);
      return structuredClone(question);
    },

    patchQuestion(id, input) {
      const previous = db.questions.find((q) => q.id === id);
      if (!previous) return null;
      const question = { ...previous, ...questionFields(input, previous, db.records), revision: (previous.revision || 1) + 1, updated_at: new Date().toISOString() };
      const next = structuredClone(db);
      next.questions[next.questions.findIndex((q) => q.id === id)] = question;
      persist(next);
      return structuredClone(question);
    },

    gameExport() {
      const approved = db.questions.filter((q) => q.status === 'approved');
      const questions = approved.filter((q) => q.record_revision === db.records.find((r) => r.id === q.record_id)?.revision);
      const recordIds = new Set(questions.map((q) => q.record_id));
      return structuredClone({
        schema: 'ww-wiki-game-content-v1', exported_at: new Date().toISOString(),
        questions,
        records: db.records.filter((r) => recordIds.has(r.id)).map((r) => ({ id: r.id, revision: r.revision, title: r.title, collection_id: r.collection_id, source: r.source })),
        excluded: { draft: db.questions.length - approved.length, stale: approved.length - questions.length },
      });
    },

    exportDump() {
      return structuredClone(db);
    },
  };
}
