const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const tagHref=id=>id==='china'?'#/regions':id==='ethnic-index'?'#/ethnic':id.startsWith('ethnic-')?`#/ethnic/${encodeURIComponent(id)}`:`#/region/${encodeURIComponent(id)}`;
export function readTagRoute(hash){
  if(/^#\/regions\/?$/.test(hash))return 'china';
  if(/^#\/ethnic\/?$/.test(hash))return 'ethnic-index';
  return /^#\/(?:region|ethnic)\/([a-z0-9-]+)$/.exec(hash)?.[1]||'china';
}
function sourceUrl(url){const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw new Error('不支持的来源地址');return escape(parsed.href);}
export function validateKnowledge({ethnicities,provinces}){
  if(ethnicities.length!==56||new Set(ethnicities.map(row=>row.id)).size!==56||new Set(ethnicities.map(row=>row.name)).size!==56)throw new Error('民族词表应包含56个唯一条目');
  if(provinces.length!==34||new Set(provinces.map(row=>row.id)).size!==34)throw new Error('地域词表应包含34个省级条目');
  const regionIds=new Set(provinces.map(row=>row.id));
  for(const row of [...ethnicities,...provinces]){
    if(!row.name||!row.sources?.length)throw new Error(`${row.id} 缺少名称或来源`);
    const sourceIds=new Set(row.sources.map(source=>source.id));
    for(const source of row.sources){sourceUrl(source.url);if(!source.title||!source.publisher)throw new Error(`${row.id} 来源说明不完整`);}
    const fields=row.id.startsWith('ethnic-')?['summary','culture','clothing','distribution']:['geography','clothing'];
    for(const field of fields){
      if(field!=='distribution'&&!row[field])throw new Error(`${row.id} 缺少 ${field}`);
      if(!row.fieldSources?.[field]?.length||row.fieldSources[field].some(id=>!sourceIds.has(id)))throw new Error(`${row.id} ${field} 缺少有效来源引用`);
    }
    if(row.distribution){
      if(new Set(row.distribution.map(edge=>edge.region)).size!==row.distribution.length)throw new Error(`${row.id} 包含重复地域`);
      for(const edge of row.distribution)if(!regionIds.has(edge.region)||!edge.note)throw new Error(`${row.id} 分布关系缺少地域或依据`);
    }
  }
  return {ethnicities,provinces,ethnicMap:new Map(ethnicities.map(row=>[row.id,row])),provinceMap:new Map(provinces.map(row=>[row.id,row]))};
}
export async function loadKnowledgeBase(){
  const read=async name=>{const response=await fetch(new URL(`./research/${name}`,import.meta.url));if(!response.ok)throw new Error(`资料加载失败：${name}`);return response.json();};
  const [a,b,provinces]=await Promise.all([read('ethnic-a.json'),read('ethnic-b.json'),read('provinces.json')]);
  return validateKnowledge({ethnicities:[...a,...b].sort((x,y)=>x.id.localeCompare(y.id)),provinces});
}
export function regionEthnicities(knowledge,regionId){return knowledge.ethnicities.filter(row=>row.distribution.some(edge=>edge.region===regionId));}
const link=(id,name,className='rm-topic-link')=>`<a class="${className}" href="${tagHref(id)}" data-region="${escape(id)}">${escape(name)} <span aria-hidden="true">↗</span></a>`;
const section=(title,body)=>`<section class="rm-knowledge-section"><h2>${title}</h2>${body}</section>`;
const fieldNames={geography:'地理简介',summary:'概况',culture:'文化与生活',clothing:'传统服饰',distribution:'地域分布'};
export function recommendEthnicities(knowledge,id,regions,limit=5){
  if(!knowledge)return [];
  const current=knowledge.ethnicMap.get(id),province=knowledge.provinceMap.get(id);
  if(!current&&!province)return [];
  const memberships=new Map(knowledge.provinces.map(row=>[row.id,regionEthnicities(knowledge,row.id).length]));
  const centre=code=>{const r=regions.find(region=>region.id===code);return r?.feature.properties.centroid||r?.feature.properties.center;};
  const distance=(a,b)=>{const c=centre(a),d=centre(b);if(!c||!d)return Infinity;const rad=n=>n*Math.PI/180;return Math.sin(rad(d[1]-c[1])/2)**2+Math.cos(rad(c[1]))*Math.cos(rad(d[1]))*Math.sin(rad(d[0]-c[0])/2)**2;};
  const selected=new Set(current?.distribution.map(edge=>edge.region)||[id]);
  return knowledge.ethnicities.filter(row=>row.id!==id&&row.id!=='ethnic-01').map(row=>{
    const shared=row.distribution.filter(edge=>selected.has(edge.region)).map(edge=>edge.region);
    let score;
    if(current){
      const weight=code=>1/Math.log(2+(memberships.get(code)||0));
      const union=new Set([...selected,...row.distribution.map(edge=>edge.region)]);
      score=shared.reduce((sum,code)=>sum+weight(code),0)/[...union].reduce((sum,code)=>sum+weight(code),0);
    }else{
      const nearest=Math.min(...row.distribution.map(edge=>distance(id,edge.region)));
      score=shared.length?2+1/row.distribution.length:1/(1+nearest*300);
    }
    const reason=shared.length?`关联地域：${shared.map(code=>knowledge.provinceMap.get(code).name).join('、')}`:'邻近地域分布';
    return {row,score,reason};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.row.id.localeCompare(b.row.id)).slice(0,limit);
}
function references(row,related=[],notes=[]){
  const sources=new Map();
  function add(source,label){
    if(!sources.has(source.url))sources.set(source.url,{source,labels:new Set()});
    if(label)sources.get(source.url).labels.add(label);
  }
  for(const source of row.sources){
    const labels=Object.entries(row.fieldSources||{}).filter(([,ids])=>ids.includes(source.id)).map(([field])=>fieldNames[field]);
    add(source,labels.filter(Boolean).join('、'));
  }
  for(const ethnic of related)for(const id of ethnic.fieldSources.distribution){
    const source=ethnic.sources.find(s=>s.id===id);if(source)add(source,`${ethnic.name}·地域分布`);
  }
  const annotations=notes.filter(note=>note.text&&!/不表示|不是|不能|不应|不宜|不代表|不等于|不构成|不意味着|不等同|不作为|并非|非逐省|非完整/.test(note.text));
  return `<footer class="rm-reference-footer"><details class="rm-sources"><summary>参考资料与注释</summary><ol>${[...sources.values()].map(({source,labels})=>`<li><a href="${sourceUrl(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)}</a><span>${escape([...labels].join('；'))} · ${escape(source.publisher)} · 查阅于 ${escape(source.accessed||'2026-11-12')}${source.verification==='search-excerpt'?' · 官方检索正文核对':''}</span></li>`).join('')}</ol>${annotations.length?`<ul class="rm-reference-notes">${annotations.map(note=>`<li>${escape(note.label)}：${escape(note.text)}</li>`).join('')}</ul>`:''}</details></footer>`;
}
function catalogEntry(row){return `<a class="rm-ethnic-entry${row.id==='ethnic-01'?' rm-han-entry':''}" href="${tagHref(row.id)}" data-region="${row.id}" data-name="${escape(row.name)}">${escape(row.name)}<span aria-hidden="true">→</span></a>`;}
export function renderKnowledgeArticle(id,knowledge){
  if(!knowledge)return null;
  if(id==='china'){
    return `<div class="rm-eyebrow">Geographic index</div><h1>地域索引</h1><p class="rm-lead">从地图或地域名称出发，查阅地方文化与服饰。</p><div class="rm-region-catalog">${knowledge.provinces.map(row=>`<a href="${tagHref(row.id)}" data-region="${row.id}">${escape(row.name)}<span aria-hidden="true">→</span></a>`).join('')}</div><div class="rm-actions">${link('ethnic-index','民族索引')}</div>`;
  }
  if(id==='ethnic-index'){
    const indexSource={sources:[{id:'index',title:'中华民族各民族',url:'https://www.neac.gov.cn/seac/ztzl/zgmzjs/index.shtml',publisher:'国家民族事务委员会',accessed:'2026-11-12'}],fieldSources:{}};
    return `<nav class="rm-breadcrumb" aria-label="词条路径">${link('china','地域索引')}<span>/</span><span>民族索引</span></nav><div class="rm-eyebrow">Ethnic group index</div><h1>民族索引</h1><p class="rm-lead">查阅民族文化与服饰，沿相关词条继续探索。</p><label class="rm-catalog-label">查找民族<input type="search" class="rm-ethnic-catalog-search rm-search" placeholder="例如：土家族、苗族、汉族"></label><div class="rm-han-overview">${catalogEntry(knowledge.ethnicMap.get('ethnic-01'))}</div><h2 class="rm-catalog-heading">少数民族</h2><div class="rm-ethnic-catalog">${knowledge.ethnicities.filter(row=>row.id!=='ethnic-01').map(catalogEntry).join('')}</div>${references(indexSource)}`;
  }
  const ethnic=knowledge.ethnicMap.get(id);
  if(ethnic){
    const han=id==='ethnic-01';
    const distribution=han?`<p>广泛分布于全国各地。</p>${link('china','浏览地域索引')}`:`<div class="rm-distribution-links">${ethnic.distribution.map(edge=>`<div>${link(edge.region,knowledge.provinceMap.get(edge.region).name)}</div>`).join('')}</div>`;
    const notes=han?[]:ethnic.distribution.map(edge=>({label:knowledge.provinceMap.get(edge.region).name,text:edge.note}));
    return `<nav class="rm-breadcrumb" aria-label="词条路径">${link('ethnic-index','民族索引')}<span>/</span><span>${escape(ethnic.name)}</span></nav><div class="rm-eyebrow">Ethnic group entry</div><h1>${escape(ethnic.name)}</h1><p class="rm-lead">${escape(ethnic.summary)}</p>${section('文化与生活',`<p>${escape(ethnic.culture)}</p>`)}${section('传统服饰',`<p>${escape(ethnic.clothing)}</p>`)}${section('地域分布',distribution)}<div class="rm-actions">${link('ethnic-index','民族索引')}${link('china','地域索引')}</div>${references(ethnic,[],notes)}`;
  }
  const province=knowledge.provinceMap.get(id);if(!province)return null;
  const ethnics=regionEthnicities(knowledge,id);
  const notes=ethnics.map(row=>({label:row.name,text:row.distribution.find(edge=>edge.region===id).note}));
  return `<nav class="rm-breadcrumb" aria-label="词条路径">${link('china','地域索引')}<span>/</span><span>${escape(province.name)}</span></nav><div class="rm-eyebrow">Region entry</div><h1>${escape(province.name)}</h1><p class="rm-lead">${escape(province.geography)}</p>${section('地域与服饰',`<p>${escape(province.clothing)}</p>`)}${section('民族与文化',`<div class="rm-ethnic-chips">${ethnics.map(row=>link(row.id,row.name)).join('')}</div>`)}<div class="rm-actions">${link('china','地域索引')}${link('ethnic-index','民族索引')}</div>${references(province,ethnics,notes)}`;
}
