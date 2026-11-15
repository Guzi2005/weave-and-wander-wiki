import {routeTopic,topicRoute} from './library-store.js';
import {descendants} from './contribution-trees.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assetHref=r=>'#/asset/'+encodeURIComponent(r.id);
export function createLibraryReading(store,knowledge){
  let events;
  const cover=r=>r._previewCover||store.data.assets[r.id]?.cover||r.media?.[0]?.path;
  const image = record => {
    const path = cover(record);
    if (!path) return '<span class="lr-file-cover">资料</span>';
    const entry = record.media?.find(media => media.path === path);
    const size = Number.isSafeInteger(entry?.width) && Number.isSafeInteger(entry?.height)
      ? ` width="${entry.width}" height="${entry.height}"` : '';
    return `<img loading="lazy" src="${esc(path)}" alt="${esc(record.title)}"${size}>`;
  };
  function topicCard(record, inlineTags) {
    const title = esc(record.title);
    const tags = `<div class="mp-card-tags">${store.labels(record).map(label => `<span>${esc(label)}</span>`).join('')}</div>`;
    const caption = inlineTags
      ? `<div class="mp-card-byline"><h3 title="${title}">${title}</h3>${tags}</div>`
      : `<h3>${title}</h3>${tags}`;
    return `<a class="mp-card" href="${assetHref(record)}"><div>${image(record)}</div>${caption}</a>`;
  }
  const link=(id,name)=>`<a href="${topicRoute(id)}">${esc(name)} ↗</a>`;
  function render(id,options={}){
    events?.abort();const topic=store.topic(routeTopic(id));if(!topic)return null;
    const all=store.records(topic.id),nodes=store.snapshot.nodes.filter(n=>!n.topicId||n.topicId===topic.id),params=options.params||new URLSearchParams(location.hash.split('?')[1]||'');
    const chosen=[...params].filter(([key,value])=>key.startsWith('tag:')&&nodes.some(n=>n.id===value)).map(([key,value])=>({key,value}));
    const matches=(record,selection)=>selection.every(p=>record._tagIds?.includes(p.value));
    const rows=all.filter(r=>matches(r,chosen));
    const isPatternTopic = topic.id === 'topic-patterns';
    const groups=nodes.filter(n=>!n.parentId&&n.id!=='tree-entries').map(parent=>{
      const ids=new Set(descendants(nodes,parent.id));const leaves=nodes.filter(n=>ids.has(n.id)&&n.id!==parent.id&&!nodes.some(child=>child.parentId===n.id));
      const key='tag:'+parent.id,others=chosen.filter(p=>p.key!==key);
      return {parent,key,options:leaves.map(node=>({node,count:all.filter(r=>matches(r,others)&&r._tagIds?.includes(node.id)).length})).filter(o=>o.count)};
    }).filter(g=>g.options.length);
    const relations=(label,ids,map,kind)=>`<div class="mp-topic-links"><span>${label}</span>${(ids||[]).map(id=>`<a href="#/${kind}/${esc(id)}">${esc(map.get(id)?.name||id)} ↗</a>`).join('')||'<span>待补充</span>'}</div>`;
    const intro=topic.note&&topic.note!=='云南摩梭人关联纳西族；四川左所摩梭人关联蒙古族。'?topic.note:topic.id==='culture-mosuo'?'泸沽湖连接云南宁蒗与四川盐源，摩梭人的生活与文化在湖畔村落间延续。这里整理服饰、部件与手作资料。':'';
    return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a><span>/</span><span>${esc(topic.name)}</span></nav><div class="rm-eyebrow">${topic.id==='topic-patterns'?'Patterns × entries':'Culture × objects'}</div><h1>${esc(topic.name)}</h1>${intro?`<p class="mp-topic-lead">${esc(intro)}</p>`:''}${topic.id==='topic-patterns'?'<p class="mp-topic-lead"><a href="#/asset/WW-BIB-HQS-2021">查看书目条目 ↗</a></p>':''}${topic.regions?.length?relations('关联地域',topic.regions,knowledge.provinceMap,'region'):''}${topic.ethnicities?.length?relations('关联民族',topic.ethnicities,knowledge.ethnicMap,'ethnic'):''}<section class="mp-browse-tags" data-toc-title="标签浏览"><p class="mp-filter-help">点选标签筛选资料，再次点选即可取消。</p>${groups.map(({parent,key,options})=>`<div class="mp-tree-branch"><span>${esc(parent.label)}</span>${options.map(({node,count})=>`<button type="button" data-live-tag="${esc(node.id)}" data-live-group="${esc(key)}" aria-pressed="${params.get(key)===node.id}">${esc(node.label)}<small>${count}</small></button>`).join('')}</div>`).join('')}</section><div class="mp-filter-summary"><span>${rows.length} 条资料</span>${chosen.length?'<button type="button" data-live-clear>查看全部</button>':''}</div><div class="mp-results${isPatternTopic?' lr-masonry':''}" data-toc-title="专题资料">${rows.map(record=>topicCard(record,isPatternTopic)).join('')||'<p>等待添加资料。</p>'}</div>${topic.id==='culture-mosuo'?'<footer class="rm-reference-footer"><details><summary>专题来源与关联</summary><p><a href="https://www.yncaw.gov.cn/html/2023/jjcz_0625/108598.html" target="_blank" rel="noreferrer">云南长安网 · 泸沽湖文化背景</a></p><p><a href="https://ethno.ihp.sinica.edu.tw/page/D-NX/D_main-2-NX-1.htm" target="_blank" rel="noreferrer">中央研究院历史语言研究所 · 纳西族群与地域</a></p></details></footer>':''}`;
  }
  function mount(id,root,options={}){
    const topic=store.topic(routeTopic(id));
    if(topic){events=new AbortController();root.addEventListener('click',e=>{const button=e.target.closest('[data-live-tag],[data-live-clear]');if(!button)return;const query=new URLSearchParams(options.params||location.hash.split('?')[1]||'');if(button.hasAttribute('data-live-clear'))for(const key of [...query.keys()])if(key.startsWith('tag:'))query.delete(key);if(button.dataset.liveTag){const key=button.dataset.liveGroup;if(query.get(key)===button.dataset.liveTag)query.delete(key);else query.set(key,button.dataset.liveTag);}if(options.onFilter)options.onFilter(query);else location.hash=topicRoute(topic.id).slice(1)+(query.size?'?'+query:'');},{signal:events.signal});return;}
    if(id==='assets'){
      const intro=root.querySelector('.ap-intro');intro?.insertAdjacentHTML('afterend',`<div class="lr-topics">${store.snapshot.topics.filter(t=>t.id!=='topic-unassigned').map(t=>link(t.id,t.name)).join('')}</div>`);return;
    }
    if(id.startsWith('asset:')){
      const recordId=id.slice(6).replace(/^images-|^drawing-/,'');const record=store.data.records.find(r=>r.id===recordId);if(!record)return;
      const topics=store.snapshot.topics.filter(topic=>store.records(topic.id).some(row=>row.id===recordId));
      const badges=new Map();
      for(const topic of topics){
        const name=topic.name.trim();
        if(name&&!badges.has(name))badges.set(name,link(topic.id,name));
      }
      for(const label of store.labels(record)){
        const name=label.trim();
        if(name&&!badges.has(name))badges.set(name,`<span>${esc(name)}</span>`);
      }
      const links=badges.size?`<div class="mp-asset-links">${[...badges.values()].join('')}</div>`:'';
      const note=record.note?`<p class="lr-record-note">${esc(record.note)}</p>`:'';
      root.querySelector('.ap-detail-heading')?.insertAdjacentHTML('afterend',links+note);
      return;
    }
    const topics=store.topicsFor(id);if(!topics.length)return;
    const previews=topics.map(t=>{const rows=store.records(t.id).slice(0,3);return `<section class="mp-topic-preview rm-knowledge-section" data-toc-title="${esc(t.name)}"><div class="mp-preview-heading"><div><h2>文化专题</h2><h3>${esc(t.name)}</h3></div><a href="${topicRoute(t.id)}">展开专题 ↗</a></div>${t.note?`<p>${esc(t.note)}</p>`:''}${rows.length?`<div class="mp-preview-cards">${rows.map(r=>`<div class="mp-preview-item"><div>${image(r)}</div><span>${esc(r.title)}</span></div>`).join('')}</div>`:'<p>等待添加资料。</p>'}</section>`;}).join('');
    const footer=root.querySelector('.rm-actions')||root.querySelector('.rm-reference-footer');if(footer)footer.insertAdjacentHTML('beforebegin',previews);else root.insertAdjacentHTML('beforeend',previews);
  }
  return {render,mount,cleanup:()=>events?.abort()};
}
