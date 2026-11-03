// 资料库列表布局的纯函数部分：套装分组与缩略图媒体挑选。
// 不依赖 DOM 与网络，供 app.js 渲染使用，也供 node --test 直接验证。

// 列表缩略图只使用原始证据（role === 'source'）媒体；
// 生成概念图不得冒充原图出现在缩略位，无原始证据时返回 null 由调用方显示占位。
export function pickThumbMedia(media) {
  if (!Array.isArray(media)) return null;
  return media.find((m) => m && m.role === 'source') || null;
}

// 将检索匹配的摘要记录整理为列表条目。
// 折叠规则：仅当套装（record_type === 'ensemble'）本身出现在匹配结果中、
// 且未启用类别筛选时，才把它的部件折叠进套装条目；否则各匹配记录独立展示。
// 只有 record_type === 'component' 的子记录参与折叠；
// 关联的独立单件（如手工对象鞋垫）保持顶层显示，不并入套装部件。
// childrenOf(ensembleId) 返回该套装的完整子记录摘要（来自详情接口），
// 使未命中关键词的部件也能随套装展示；折叠进的部件不再单独出现，保证无遗漏无重复。
export function buildArchiveEntries(records, { childrenOf, categoryFilterActive = false } = {}) {
  const list = Array.isArray(records) ? records : [];
  if (categoryFilterActive) {
    return list.map((record) => ({ kind: 'record', record }));
  }
  const getChildren = typeof childrenOf === 'function' ? childrenOf : () => [];
  const matchedIds = new Set(list.map((r) => r && r.id));
  const componentsByEnsemble = new Map();
  const foldedIds = new Set();
  for (const record of list) {
    if (!record || record.record_type !== 'ensemble') continue;
    const seen = new Set();
    const components = [];
    for (const child of getChildren(record.id) || []) {
      if (!child || child.record_type !== 'component' || seen.has(child.id)) continue;
      seen.add(child.id);
      components.push(child);
      if (matchedIds.has(child.id)) foldedIds.add(child.id);
    }
    componentsByEnsemble.set(record.id, components);
  }
  const entries = [];
  for (const record of list) {
    if (foldedIds.has(record.id)) continue;
    if (record.record_type === 'ensemble') {
      const components = componentsByEnsemble.get(record.id) || [];
      // 无部件的套装没有可组合的内容，退化为普通卡片。
      entries.push(components.length > 0
        ? { kind: 'ensemble', record, components }
        : { kind: 'record', record });
    } else {
      entries.push({ kind: 'record', record });
    }
  }
  return entries;
}
