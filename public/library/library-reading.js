import {routeTopic,topicRoute} from './library-store.js';
import {descendants} from './contribution-trees.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assetHref=r=>'#/asset/'+encodeURIComponent(r.id);
export function createLibraryReading(store,knowledge){
  let events;
  const cover=r=>r._previewCover||store.data.assets[r.id]?.cover||r.media?.[0]?.path;
  const image=r=>cover(r)?`<img loading="lazy" src="${esc(cover(r))}" alt="${esc(r.title)}">`:'<span class="lr-file-cover">资料</span>';
  const link=(id,name)=>`<a href="${topicRoute(id)}">${esc(name)} ↗</a>`;
  function render(id,options={}){
    events?.abort();const topic=store.topic(routeTopic(id));if(!topic)return null;
    const all=store.records(topic.id),nodes=store.snapshot.nodes.filter(n=>!n.topicId||n.topicId===topic.id),params=options.params||new URLSearchParams(location.hash.split('?')[1]||'');
    const chosen=[...params].filter(([key,value])=>key.startsWith('tag:')&&nodes.some(n=>n.id===value)).map(([key,value])=>({key,value}));
    const matches=(record,selection)=>selection.every(p=>record._tagIds?.includes(p.value));
    const rows=all.filter(r=>matches(r,chosen));
    const groups=nodes.filter(n=>!n.parentId&&n.id!=='tree-entries').map(parent=>{
      const ids=new Set(descendants(nodes,parent.id));const leaves=nodes.filter(n=>ids.has(n.id)&&n.id!==parent.id&&!nodes.some(child=>child.parentId===n.id));
      const key='tag:'+parent.id,others=chosen.filter(p=>p.key!==key);
      return {parent,key,options:leaves.map(node=>({node,count:all.filter(r=>matches(r,others)&&r._tagIds?.includes(node.id)).length})).filter(o=>o.count)};
    }).filter(g=>g.options.length);
    const relations=(label,ids,map,kind)=>`<div class="mp-topic-links"><span>${label}</span>${(ids||[]).map(id=>`<a href="#/${kind}/${esc(id)}">${esc(map.get(id)?.name||id)} ↗</a>`).join('')||'<span>待补充</span>'}</div>`;
    const intro=topic.note&&topic.note!=='云南摩梭人关联纳西族；四川左所摩梭人关联蒙古族。'?topic.note:topic.id==='culture-mosuo'?'泸沽湖连接云南宁蒗与四川盐源，摩梭人的生活与文化在湖畔村落间延续。这里整理服饰、部件与手作资料。':'';
    return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a><span>/</span><span>${esc(topic.name)}</span></nav><div class="rm-eyebrow">Culture × objects</div><h1>${esc(topic.name)}</h1>${intro?`<p class="mp-topic-lead">${esc(intro)}</p>`:''}${relations('关联地域',topic.regions,knowledge.provinceMap,'region')}${relations('关联民族',topic.ethnicities,knowledge.ethnicMap,'ethnic')}<section class="mp-browse-tags" data-toc-title="标签浏览"><p class="mp-filter-help">点选标签筛选资料，再次点选即可取消。</p>${groups.map(({parent,key,options})=>`<div class="mp-tree-branch"><span>${esc(parent.label)}</span>${options.map(({node,count})=>`<button type="button" data-live-tag="${esc(node.id)}" data-live-group="${esc(key)}" aria-pressed="${params.get(key)===node.id}">${esc(node.label)}<small>${count}</small></button>`).join('')}</div>`).join('')}</section><div class="mp-filter-summary"><span>${rows.length} 条资料</span>${chosen.length?'<button type="button" data-live-clear>查看全部</button>':''}</div><div class="mp-results" data-toc-title="专题资料">${rows.map(r=>`<a class="mp-card" href="${assetHref(r)}"><div>${image(r)}</div><h3>${esc(r.title)}</h3><div class="mp-card-tags">${store.labels(r).map(label=>`<span>${esc(label)}</span>`).join('')}</div></a>`).join('')||'<p>等待添加资料。</p>'}</div>${topic.id==='culture-mosuo'?'<footer class="rm-reference-footer"><details><summary>专题来源与关联</summary><p><a href="https://www.yncaw.gov.cn/html/2023/jjcz_0625/108598.html" target="_blank" rel="noreferrer">云南长安网 · 泸沽湖文化背景</a></p><p><a href="https://ethno.ihp.sinica.edu.tw/page/D-NX/D_main-2-NX-1.htm" target="_blank" rel="noreferrer">中央研究院历史语言研究所 · 纳西族群与地域</a></p></details></footer>':''}`;
  }
  function mount(id,root,options={}){
    const topic=store.topic(routeTopic(id));
    if(topic){events=new AbortController();root.addEventListener('click',e=>{const button=e.target.closest('[data-live-tag],[data-live-clear]');if(!button)return;const query=new URLSearchParams(options.params||location.hash.split('?')[1]||'');if(button.hasAttribute('data-live-clear'))for(const key of [...query.keys()])if(key.startsWith('tag:'))query.delete(key);if(button.dataset.liveTag){const key=button.dataset.liveGroup;if(query.get(key)===button.dataset.liveTag)query.delete(key);else query.set(key,button.dataset.liveTag);}if(options.onFilter)options.onFilter(query);else location.hash=topicRoute(topic.id).slice(1)+(query.size?'?'+query:'');},{signal:events.signal});return;}
    if(id==='assets'){
      const intro=root.querySelector('.ap-intro');intro?.insertAdjacentHTML('afterend',`<div class="lr-topics">${store.snapshot.topics.filter(t=>t.id!=='topic-unassigned').map(t=>link(t.id,t.name)).join('')}</div>`);return;
    }
    if(id.startsWith('asset:')){
      const recordId=id.slice(6).replace(/^images-|^drawing-/,'');const record=store.data.records.find(r=>r.id===recordId);if(!record)return;
      root.querySelector('.ap-detail-heading')?.insertAdjacentHTML('afterend',`<div class="mp-asset-links">${store.snapshot.topics.filter(t=>store.records(t.id).some(r=>r.id===recordId)).map(t=>link(t.id,t.name)).join('')}${store.labels(record).map(label=>`<span>${esc(label)}</span>`).join('')}</div>${record.note?`<p class="lr-record-note">${esc(record.note)}</p>`:''}`);return;
    }
    const topics=store.topicsFor(id);if(!topics.length)return;
    const previews=topics.map(t=>{const rows=store.records(t.id).slice(0,3);return `<section class="mp-topic-preview rm-knowledge-section" data-toc-title="${esc(t.name)}"><div class="mp-preview-heading"><div><h2>文化专题</h2><h3>${esc(t.name)}</h3></div><a href="${topicRoute(t.id)}">展开专题 ↗</a></div>${t.note?`<p>${esc(t.note)}</p>`:''}${rows.length?`<div class="mp-preview-cards">${rows.map(r=>`<div class="mp-preview-item"><div>${image(r)}</div><span>${esc(r.title)}</span></div>`).join('')}</div>`:'<p>等待添加资料。</p>'}</section>`;}).join('');
    const footer=root.querySelector('.rm-actions')||root.querySelector('.rm-reference-footer');if(footer)footer.insertAdjacentHTML('beforebegin',previews);else root.insertAdjacentHTML('beforeend',previews);
  }
  return {render,mount,cleanup:()=>events?.abort()};
}
