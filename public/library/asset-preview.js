const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const assetHref=id=>`#/asset/${encodeURIComponent(id)}`;
const labels={all:'全部',models:'模型',images:'影像',drawings:'UV 图纸',motifs:'纹样与配方',nodes:'节点样式',files:'资料文件'};
const image=(src,alt,extra='')=>!src?'<span class="lr-file-cover">资料文件</span>':`<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy" decoding="async" ${extra}>`;
export async function loadAssetData(){const response=await fetch('/api/library/bootstrap');if(!response.ok)throw new Error('资产资料加载失败');return (await response.json()).data;}
export function createAssetItems(data){
  const items=[];
  for(const record of data.records){
    const asset=data.assets[record.id];
    if(!asset&&!record.media?.length&&record._files?.length)items.push({id:record.id,kind:'files',title:record.title,cover:null,record});
    if(asset)items.push({id:record.id,kind:'models',title:record.title,cover:record._previewCover||asset.cover,record,asset});
    if(record.record_type==='ensemble'||record.collection_id==='mosuo_video_002'||(!asset&&record.media?.length))items.push({id:'images-'+record.id,kind:'images',title:record.record_type==='ensemble'?record.title+' · 参考影像':record.title,cover:record.media.find(m=>m.role==='source')?.path,record,asset});
    if(asset?.drawing)items.push({id:'drawing-'+record.id,kind:'drawings',title:record.title+' · UV',cover:asset.drawing,record,asset});
  }
  for(const entry of data.motifs)items.push({id:'motif-'+entry.id,kind:'motifs',title:entry.label,cover:entry.image,entry,record:data.records.find(r=>r.id===entry.record_id)});
  for(const entry of data.nodes)items.push({id:'node-'+entry.id,kind:'nodes',title:entry.label.replace(/^\d+\s*/,''),cover:entry.image,entry});
  return items;
}
export function createAssetPreview(data){
  let items=createAssetItems(data),byId=new Map(items.map(item=>[item.id,item]));
  let filter='all',current=null,mode='',mediaIndex=0,viewer=null,serial=0,events=null;
  const cleanup=()=>{serial++;viewer?.cleanup();viewer=null;events?.abort();events=null;};
  function card(item){return `<a class="ap-card ap-kind-${item.kind}" href="${assetHref(item.id)}"><div class="ap-card-image">${image(item.cover,item.title)}<span class="ap-format">${labels[item.kind]}</span></div><div class="ap-card-caption"><span>${escape(item.title)}</span><span aria-hidden="true">↗</span></div></a>`;}
  function ensemble(item){
    const children=items.filter(row=>row.kind==='models'&&row.record.parent_id===item.id&&row.record.record_type==='component');
    return `<section class="ap-ensemble"><header><a href="${assetHref(item.id)}">${escape(item.title)} ↗</a><span>${children.length} 个部件</span></header><div class="ap-ensemble-body"><a class="ap-ensemble-whole" href="${assetHref(item.id)}">${image(item.cover,item.title)}<span>套装整体 ↗</span></a><div class="ap-ensemble-parts">${children.map(card).join('')}</div></div></section>`;
  }
  function gallery(){
    const group=(title,rows,kind,limit)=>`<section class="ap-section"><header><h2>${title}</h2><button data-asset-filter="${kind}">查看全部 →</button></header><div class="ap-card-grid">${rows.slice(0,limit).map(card).join('')}</div></section>`;
    const models=items.filter(item=>item.kind==='models'),ensembles=models.filter(item=>item.record.record_type==='ensemble');
    const body=filter==='all'?`<div class="ap-ensembles">${ensembles.map(ensemble).join('')}</div>${group('服装与配件',models.filter(item=>item.record.record_type!=='ensemble'&&item.record.collection_id==='ww_game_basics'),'models',6)}${group('参考影像',items.filter(item=>item.kind==='images'),'images',3)}${items.some(item=>item.kind==='files')?group('资料文件',items.filter(item=>item.kind==='files'),'files',6):''}${group('UV 图纸',items.filter(item=>item.kind==='drawings'),'drawings',3)}${group('纹样与配方',items.filter(item=>item.kind==='motifs'),'motifs',2)}${group('节点样式',items.filter(item=>item.kind==='nodes'),'nodes',3)}`:`<div class="ap-card-grid ap-filter-results">${items.filter(item=>item.kind===filter).map(card).join('')}</div>`;
    return `<div class="rm-eyebrow">Asset archive</div><h1>服饰资料库</h1><p class="ap-intro">浏览套装、部件、参考影像与创作素材。</p><div class="ap-filters" role="group" aria-label="资料形式">${Object.entries(labels).map(([key,label])=>`<button data-asset-filter="${key}" aria-pressed="${key===filter}">${label}</button>`).join('')}</div>${body}`;
  }
  const media=item=>item.record?.media||[];
  function modes(item){
    const choices=[];
    if(item.asset?.cover)choices.push(['model','模型图']);
    if(media(item).length)choices.push(['images','参考影像']);
    if(item.asset?.drawing)choices.push(['drawing','UV 图纸']);
    if(item.kind==='motifs'||item.kind==='nodes')choices.push(['image',item.kind==='motifs'?'纹样效果':'节点效果']);
    return choices;
  }
  function selectedFile(item){return mode==='images'?media(item)[mediaIndex]?.path:mode==='drawing'?item.asset.drawing:item.cover;}
  function parameters(item){
    if(!item.entry)return '';
    const names={base_color:'底色',repeat_count:'重复单元',length:'长度 / 模型米',puff_count:'末端绒球数',puff_radius:'绒球半径 / 模型米',seed:'随机种子',spread:'散开程度',strand_count:'线股数',strand_radius:'线股半径 / 模型米'};
    const rows=Object.entries(item.entry.parameters).filter(([key,value])=>key!=='motif'&&key!=='sequence'&&typeof value!=='object');
    return `<section class="ap-detail-section"><h2>配方参数</h2><dl class="ap-parameters">${rows.map(([key,value])=>`<div><dt>${escape(names[key]||key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl></section>`;
  }
  function related(item){
    if(item.entry&&item.kind==='nodes')return `<section class="ap-detail-section"><h2>其他节点样式</h2><div class="ap-card-grid">${items.filter(row=>row.kind==='nodes'&&row.id!==item.id).map(card).join('')}</div></section>`;
    const parentId=item.record?.record_type==='ensemble'?item.record.id:item.record?.parent_id;
    const rows=items.filter(row=>row.kind==='models'&&(parentId?row.record.parent_id===parentId:item.record?.collection_id&&row.record.collection_id===item.record.collection_id));
    return rows.length?`<section class="ap-detail-section"><h2>${item.record.record_type==='ensemble'?'套装部件':'同组资产'}</h2><div class="ap-card-grid">${rows.filter(row=>row.id!==item.id).map(card).join('')}</div></section>`:'';
  }
  function sourceFooter(item){
    const source=item.record?.source;
    const links=[];if(source?.url&&/^https?:\/\//i.test(source.url))links.push(`<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title||source.author||'原始来源')}</a>`);
    if(item.entry?.recipe)links.push(`<a href="${escape(item.entry.recipe)}" download>Godot 配方 .tres</a>`);
    if(item.asset?.modelAvailable)links.push(`<a href="/assets/models/${escape(item.asset.model)}.glb" download>模型文件 .glb</a>`);
    if(item.asset?.drawing)links.push(`<a href="${escape(item.asset.drawing)}" target="_blank" rel="noreferrer">UV 图纸</a>`);
    return `<footer class="rm-reference-footer"><details class="rm-sources"><summary>文件与来源</summary><p>${item.record?`档案编号：${escape(item.record.id)}`:'项目发型节点样式库'}</p>${links.map(link=>`<p>${link}</p>`).join('')}${source?.author?`<p>${escape(source.author)}</p>`:''}</details></footer>`;
  }
  function detail(item){
    if(item.kind==='files')return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a><span>/</span><span>资料文件</span></nav><header class="ap-detail-heading"><h1>${escape(item.title)}</h1></header><div class="ap-file-list">${item.record._files.map(file=>`<section>${file.type?.startsWith('video/')?`<video controls playsinline preload="metadata" src="${escape(file.path)}"></video>`:''}<h2>${escape(file.name)}</h2><p>${escape(file.type||'资料文件')} · ${(file.size/1048576).toFixed(2)} MB</p><a href="${escape(file.path)}" download="${escape(file.name)}">下载文件 ↓</a></section>`).join('')}</div>${sourceFooter(item)}`;

    const currentMedia=media(item)[mediaIndex],parent=item.record?.parent_id&&byId.get(item.record.parent_id);
    return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a>${parent?`<span>/</span><a href="${assetHref(parent.id)}">${escape(parent.title)}</a>`:''}<span>/</span><span>${labels[item.kind]}</span></nav><header class="ap-detail-heading"><div><div class="rm-eyebrow">${labels[item.kind]}</div><h1>${escape(item.title)}</h1></div><div class="ap-downloads">${item.entry?.recipe?`<a href="${escape(item.entry.recipe)}" download>下载配方 ↓</a>`:''}${item.asset?.modelAvailable?`<a href="/assets/models/${escape(item.asset.model)}.glb" download>下载模型 ↓</a>`:''}</div></header><div class="ap-stage${mode==='drawing'?' is-drawing':''}" aria-label="资料主展示"><button class="ap-main-image" data-open-image="${escape(selectedFile(item))}" aria-label="放大查看图片">${image(selectedFile(item),item.title,'loading="eager"')}</button>${mode==='model'&&item.asset?.modelAvailable?'<span class="ap-model-loading" role="status">正在加载三维预览…</span>':''}</div><div class="ap-viewer-controls" hidden><label>动作<select id="motion-mode"><option value="idle">待机</option><option value="walk">行走</option><option value="spin">转圈</option></select></label><button id="pause-motion">暂停动作</button><button id="reset-view">复位视角</button><span id="motion-status" role="status"></span></div><div class="ap-media-modes" role="group" aria-label="展示形式">${modes(item).map(([key,label])=>`<button data-view-mode="${key}" aria-pressed="${mode===key}">${label}</button>`).join('')}<a href="${escape(selectedFile(item))}" target="_blank" rel="noreferrer">打开完整图片 ↗</a></div>${mode==='images'?`<div class="ap-thumbnails">${media(item).map((m,index)=>{const time=m.label.match(/\d+:\d+/)?.[0];return `<button data-media-index="${index}" aria-pressed="${index===mediaIndex}">${image(m.path,'参考影像 '+(index+1))}<span>${time|| (m.role==='source'?'参考图':'概念图')+' '+(index+1)}</span></button>`;}).join('')}</div><p class="ap-caption">${currentMedia?.role==='source'?'参考影像':'概念图'}${currentMedia?.label.match(/\d+:\d+/)?.[0]?' · '+currentMedia.label.match(/\d+:\d+/)[0]:''}</p>`:''}${parameters(item)}${related(item)}${sourceFooter(item)}<dialog class="ap-lightbox"><button data-close-lightbox aria-label="关闭大图">关闭 ×</button><img alt="完整资料图片"></dialog>`;
  }
  function render(id){
    items=createAssetItems(data);byId=new Map(items.map(item=>[item.id,item]));
    cleanup();
    if(id==='assets'){current=null;return gallery();}
    if(!id.startsWith('asset:')){current=null;return null;}
    current=byId.get(id.slice(6))||byId.get('images-'+id.slice(6));if(!current)return '<h1>资料入口</h1><a href="#/assets">浏览资料库 →</a>';
    mediaIndex=0;mode=current.kind==='images'?'images':current.kind==='drawings'?'drawing':current.asset?'model':'image';
    return detail(current);
  }
  function mount(root){
    if(!current&&!root.querySelector('.ap-filters'))return;
    events=new AbortController();
    const update=()=>{serial++;viewer?.cleanup();viewer=null;root.innerHTML=current?detail(current):gallery();startViewer();};
    const startViewer=async()=>{if(mode!=='model'||!current?.asset?.modelAvailable)return;const token=++serial,stage=root.querySelector('.ap-stage');if(!stage)return;try{const {mountViewer}=await import('/viewer.js');if(token!==serial||!stage.isConnected)return;viewer=mountViewer(stage,{root,allowStatic:true,modelUrl:'/assets/models/'+current.asset.model+'.glb',onError:()=>{if(token!==serial||!stage.isConnected)return;viewer?.cleanup();viewer=null;stage.innerHTML=`${image(current.cover,current.title)}<button type="button" data-start-viewer>重试三维预览</button>`;root.querySelector('.ap-viewer-controls').hidden=true;}});root.querySelector('.ap-viewer-controls').hidden=false;root.querySelector('[data-view-mode="model"]').textContent='三维模型';}catch{if(token===serial&&stage.isConnected)stage.innerHTML=`${image(current.cover,current.title)}<button type="button" data-start-viewer>重试三维预览</button>`;}};
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.assetFilter){current=null;filter=button.dataset.assetFilter;update();window.scrollTo({top:0,behavior:'instant'});return;}
      if(button.dataset.viewMode){mode=button.dataset.viewMode;update();return;}
      if(button.dataset.mediaIndex!==undefined){mediaIndex=Number(button.dataset.mediaIndex);update();return;}
      if(button.dataset.openImage){const dialog=root.querySelector('dialog');dialog.querySelector('img').src=button.dataset.openImage;dialog.showModal();return;}
      if(button.hasAttribute('data-close-lightbox')){root.querySelector('dialog').close();return;}
      if(button.hasAttribute('data-start-viewer'))startViewer();
    },{signal:events.signal});
    startViewer();
  }
  return {render,mount,cleanup,items};
}
