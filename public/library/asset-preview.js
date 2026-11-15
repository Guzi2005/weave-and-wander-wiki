import {lineIcon} from './line-icons.js';
import {mountImageView} from './image-view.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const assetHref=id=>`#/asset/${encodeURIComponent(id)}`;
const labels={all:'全部',models:'模型',images:'影像',drawings:'UV 图纸',motifs:'纹样与配方',nodes:'节点样式',files:'资料文件',books:'图鉴画册'};
const patternAliases = {'古钱纹':'钱纹', '八宝纹':'八吉祥纹', '饕餮纹':'兽面纹'};
const image=(src,alt,extra='')=>!src?'<span class="lr-file-cover">资料文件</span>':`<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy" decoding="async" ${extra}>`;
const expandIcon=kind=>`<button class="ap-expand" type="button" data-expand-media="${kind}" aria-label="${kind==='model'?'全屏查看三维模型':'全屏查看图片'}" title="放大"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>`;
export async function loadAssetData(){const response=await fetch('/api/library/bootstrap');if(!response.ok)throw new Error('资产资料加载失败');return (await response.json()).data;}
export function createAssetItems(data){
  const items=[];
  for(const record of data.records){
    const asset=data.assets[record.id];
    if(record.category==='书目')items.push({id:record.id,kind:'books',title:record.title,cover:record.media?.[0]?.path||null,record});
    if(record.category!=='书目'&&!asset&&!record.media?.length&&record._files?.length)items.push({id:record.id,kind:'files',title:record.title,cover:null,record});
    if(asset)items.push({id:record.id,kind:'models',title:record.title,cover:record._previewCover||asset.cover,record,asset});
    if(record.category!=='书目'&&(record.record_type==='ensemble'||record.collection_id==='mosuo_video_002'||(!asset&&record.media?.length)))items.push({id:'images-'+record.id,kind:'images',title:record.record_type==='ensemble'?record.title+' · 参考影像':record.title,cover:record.media.find(m=>m.role==='source')?.path,record,asset});
    if(asset?.drawing)items.push({id:'drawing-'+record.id,kind:'drawings',title:record.title+' · UV',cover:asset.drawing,record,asset});
  }
  for(const entry of data.motifs)items.push({id:'motif-'+entry.id,kind:'motifs',title:entry.label,cover:entry.image,entry,record:data.records.find(r=>r.id===entry.record_id)});
  for(const entry of data.nodes)items.push({id:'node-'+entry.id,kind:'nodes',title:entry.label.replace(/^\d+\s*/,''),cover:entry.image,entry});
  return items;
}
export function createAssetPreview(data){
  let items=createAssetItems(data),byId=new Map(items.map(item=>[item.id,item]));
  let filter='all',current=null,mode='',mediaIndex=0,viewer=null,fullscreenViewer=null,serial=0,events=null;
  let stopImageView = null;
  const stopViewers=()=>{serial++;viewer?.cleanup();viewer=null;fullscreenViewer?.cleanup();fullscreenViewer=null;stopImageView?.();stopImageView=null;globalThis.document?.documentElement.classList.remove('has-media-lightbox');};
  const cleanup=()=>{stopViewers();events?.abort();events=null;};
  function card(item){
    const cover = item.record?.media?.find(entry => entry.path === item.cover);
    const size = Number.isSafeInteger(cover?.width) && Number.isSafeInteger(cover?.height)
      ? `width="${cover.width}" height="${cover.height}"` : '';
    return `<a class="ap-card ap-kind-${item.kind}" href="${assetHref(item.id)}"><div class="ap-card-image">${image(item.cover,item.title,size)}<span class="ap-format">${labels[item.kind]}</span></div><div class="ap-card-caption"><span>${escape(item.title)}</span><span aria-hidden="true">↗</span></div></a>`;
  }
  function bookshelf(books){
    const spines=(variant,fill=false)=>`<div class="ap-decorative-spines ap-spines-${variant}${fill?' ap-spines-fill':''}" aria-hidden="true">${'<span></span>'.repeat(fill?3:variant===2?1:2)}</div>`;
    const book=item=>`<a class="ap-book" href="${assetHref(item.id)}" aria-label="查看书目：${escape(item.title)}" title="${escape(item.title)}"><span class="ap-book-cover">${item.cover?image(item.cover,item.title):`<span class="ap-book-placeholder">${escape(item.title)}</span>`}</span></a>`;
    const rows=[];
    for(let offset=0;offset<books.length;offset+=3){
      const rowIndex=offset/3,slots=[];
      for(let slot=0;slot<3;slot++){
        if(slot)slots.push(spines((rowIndex+slot-1)%3));
        slots.push(books[offset+slot]?book(books[offset+slot]):spines((rowIndex+slot)%3,true));
      }
      rows.push(`<div class="ap-bookshelf-row">${slots.join('')}</div>`);
    }
    return `<div class="ap-bookshelf" aria-label="图鉴画册书架">${rows.join('')}</div>`;
  }
  function ensemble(item){
    const children=items.filter(row=>row.kind==='models'&&row.record.parent_id===item.id&&row.record.record_type==='component');
    return `<section class="ap-ensemble"><header><a href="${assetHref(item.id)}">${escape(item.title)} ↗</a><span>${children.length} 个部件</span></header><div class="ap-ensemble-body"><a class="ap-ensemble-whole" href="${assetHref(item.id)}">${image(item.cover,item.title)}<span>套装整体 ↗</span></a><div class="ap-ensemble-parts">${children.map(card).join('')}</div></div></section>`;
  }
  function gallery(){
    const gridClass = kind => kind === 'images' ? 'lr-masonry' : 'ap-card-grid';
    const group=(title,rows,kind,limit,showAll=true)=>`<section class="ap-section"><header><h2>${title}</h2>${showAll?`<button data-asset-filter="${kind}">查看全部 →</button>`:''}</header><div class="${gridClass(kind)}">${rows.slice(0,limit).map(card).join('')}</div></section>`;
    const models=items.filter(item=>item.kind==='models'),ensembles=models.filter(item=>item.record.record_type==='ensemble');
    const books=items.filter(item=>item.kind==='books'),files=items.filter(item=>item.kind==='files');
    const bookSection=books.length?`<section class="ap-section ap-book-section"><header><h2>${filter==='all'?'资料文件':'图鉴画册'}</h2>${filter==='all'?'<button data-asset-filter="files">查看全部 →</button>':''}</header>${filter==='all'?'<h3>图鉴画册</h3>':''}${bookshelf(books)}</section>`:'';
    const fileSection=files.length?group(books.length?'其他资料文件':'资料文件',files,'files',filter==='all'?6:files.length,filter==='all'):'';
    const body=filter==='all'?`<div class="ap-ensembles">${ensembles.map(ensemble).join('')}</div>${group('服装与配件',models.filter(item=>item.record.record_type!=='ensemble'&&item.record.collection_id==='ww_game_basics'),'models',6)}${group('参考影像',items.filter(item=>item.kind==='images'),'images',3)}${bookSection}${fileSection}${group('UV 图纸',items.filter(item=>item.kind==='drawings'),'drawings',3)}${group('纹样与配方',items.filter(item=>item.kind==='motifs'),'motifs',2)}${group('节点样式',items.filter(item=>item.kind==='nodes'),'nodes',3)}`:filter==='files'?`${bookSection}${fileSection}`:`<div class="${gridClass(filter)} ap-filter-results">${items.filter(item=>item.kind===filter).map(card).join('')}</div>`;
    return `<div class="rm-eyebrow">Asset archive</div><h1>服饰资料库</h1><p class="ap-intro">浏览套装、部件、参考影像与创作素材。</p><div class="ap-filters" role="group" aria-label="资料形式">${Object.entries(labels).filter(([key])=>key!=='books').map(([key,label])=>`<button data-asset-filter="${key}" aria-pressed="${key===filter}">${lineIcon(key)}<span>${label}</span></button>`).join('')}</div>${body}`;
  }
  const media=item=>item.record?.media||[];
  function mediaCaption(item, entry) {
    const label = entry?.label?.trim() ?? '';
    const title = item.record?.title || item.title;
    if (label === title || label === `《${title}》封面`) return '';
    if (/^(?:纹样概览|(?:参考|概念|资料|原始)?(?:影像|照片|截图|图片|图例|图)|封面)\s*\d*$/u.test(label)) return '';
    return label;
  }
  function modes(item){
    const choices=[];
    if(item.asset?.cover)choices.push(['model','模型图']);
    if(media(item).length)choices.push(['images',item.kind==='books'?'封面':'参考影像']);
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
    if(item.record?.category==='书目')return `<section class="ap-detail-section"><h2>关联纹样</h2><p><a href="#/culture/topic-patterns">查看本书收录的纹样条目 →</a></p></section>`;
    const parentId=item.record?.record_type==='ensemble'?item.record.id:item.record?.parent_id;
    const rows=items.filter(row=>row.kind==='models'&&(parentId?row.record.parent_id===parentId:item.record?.collection_id&&row.record.collection_id===item.record.collection_id));
    return rows.length?`<section class="ap-detail-section"><h2>${item.record.record_type==='ensemble'?'套装部件':'同组资产'}</h2><div class="ap-card-grid">${rows.filter(row=>row.id!==item.id).map(card).join('')}</div></section>`:'';
  }
  function sourceFooter(item){
    const source=item.record?.source;
    const links=[];if(source?.url&&/^https?:\/\//i.test(source.url))links.push(`<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title||source.author||'原始来源')}</a>`);
    if (source?.contents_url && /^https?:\/\//i.test(source.contents_url)) {
      links.push(`<a href="${escape(source.contents_url)}" target="_blank" rel="noreferrer">页码依据 · 公开目录 ↗</a>`);
    }
    if(source?.record_id)links.push(`<a href="${assetHref(source.record_id)}">查看书目条目 ↗</a>`);
    if(item.entry?.recipe)links.push(`<a href="${escape(item.entry.recipe)}" download>Godot 配方 .tres</a>`);
    if(item.asset?.modelAvailable)links.push(`<a href="/assets/models/${escape(item.asset.model)}.glb" download>模型文件 .glb</a>`);
    if(item.asset?.drawing)links.push(`<a href="${escape(item.asset.drawing)}" target="_blank" rel="noreferrer">UV 图纸</a>`);
    return `<footer class="rm-reference-footer"><details class="rm-sources"><summary>文件与来源</summary><p>${item.record?`档案编号：${escape(item.record.id)}`:'项目发型节点样式库'}</p>${links.map(link=>`<p>${link}</p>`).join('')}${source?.title?`<p>资料来源：${escape(source.author||'')}《${escape(source.title)}》${source.year?`（${escape(source.year)}）`:''}</p>`:source?.author?`<p>${escape(source.author)}</p>`:''}</details></footer>`;
  }
  function patternText(record) {
    if (!record?.pattern_text?.length) return '';
    const targets = new Map();
    for (const item of items) {
      if (item.record?.category === '纹样' && item.record.title &&
          (item.id === item.record.id || item.id === `images-${item.record.id}`)) {
        targets.set(item.record.title, item.record.id);
      }
    }
    for (const [alias, title] of Object.entries(patternAliases)) {
      if (!targets.has(alias) && targets.has(title)) targets.set(alias, targets.get(title));
    }
    const names = [...targets.keys()].sort((a, b) => b.length - a.length);
    const matcher = names.length ? new RegExp(names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu') : null;
    function linkMentions(text) {
      if (!matcher) return escape(text);
      let html = '';
      let start = 0;
      for (const {0: name, index} of text.matchAll(matcher)) {
        const id = targets.get(name);
        html += escape(text.slice(start, index));
        html += id === record.id ? escape(name) : `<a class="wiki-link" href="${assetHref(id)}">${escape(name)}</a>`;
        start = index + name.length;
      }
      return html + escape(text.slice(start));
    }
    const {author, title, year, record_id: bookId, pages} = record.source;
    const pageRange = pages?.length === 2 ? `，第 ${escape(pages[0])}–${escape(pages[1])} 页（目录页码）` : '';
    const citation = `${escape(author)}《${escape(title)}》（${escape(year)}），〈${escape(record.title)}〉${pageRange}`;
    const sections = record.pattern_text.map(({heading, paragraphs}) =>
      `<section class="ap-pattern-section"><h3>${escape(heading)}</h3>${paragraphs.map(text => `<p>${linkMentions(text)}</p>`).join('')}</section>`
    ).join('');
    return `<section class="ap-detail-section ap-pattern-text"><h2>纹样说明</h2><p class="ap-pattern-citation">原书正文 · <a href="${assetHref(bookId)}">${citation}</a></p>${sections}</section>`;
  }
  function detail(item){
    if(item.kind==='files')return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a><span>/</span><span>资料文件</span></nav><header class="ap-detail-heading"><h1>${escape(item.title)}</h1></header><div class="ap-file-list">${item.record._files.map(file=>`<section>${file.type?.startsWith('video/')?`<video controls playsinline preload="metadata" src="${escape(file.path)}"></video>`:''}<h2>${escape(file.name)}</h2><p>${escape(file.type||'资料文件')} · ${(file.size/1048576).toFixed(2)} MB</p><a href="${escape(file.path)}" download="${escape(file.name)}">下载文件 ↓</a></section>`).join('')}</div>${sourceFooter(item)}`;

    const images = mode === 'images' ? media(item) : [];
    const caption = mediaCaption(item, images[mediaIndex]);
    const hasThumbnails = images.length > 1;
    const thumbnails = hasThumbnails ? `<div class="ap-thumbnails" role="group" aria-label="切换图片">${images.map((entry, index) => {
      const description = mediaCaption(item, entry);
      const name = `查看第 ${index + 1} 张图片${description ? ' · ' + description : ''}`;
      return `<button type="button" data-media-index="${index}" aria-label="${escape(name)}" aria-pressed="${index === mediaIndex}">${image(entry.path, '')}</button>`;
    }).join('')}</div>` : '';
    const parent=item.record?.parent_id&&byId.get(item.record.parent_id);
    const detailLabel = item.record?.category === '纹样' ? '纹样' : labels[item.kind];
    const diagram = item.record?.category === '纹样'
      ? media(item).find(entry => entry.label === '纹样概览' && /^\/assets\/patterns\/pattern-\d+-01\./.test(entry.path))
      : null;
    const isModel=mode==='model'&&item.asset?.modelAvailable;
    const stageMedia=isModel?`${image(item.cover,item.title,'loading="eager"')}<span class="ap-model-loading" role="status">正在加载三维预览…</span>`:`<div class="ap-main-image">${image(selectedFile(item),caption || item.title,'loading="eager"')}</div>`;
    return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a>${parent?`<span>/</span><a href="${assetHref(parent.id)}">${escape(parent.title)}</a>`:''}<span>/</span><span>${detailLabel}</span></nav>
      <header class="ap-detail-heading${diagram ? ' has-pattern-diagram' : ''}">
        <div><div class="rm-eyebrow">${detailLabel}</div><h1>${escape(item.title)}</h1></div>
        ${diagram ? `<img class="ap-pattern-diagram" src="${escape(diagram.path)}" alt="${escape(item.title)}示意图" decoding="async">` : ''}
        <div class="ap-downloads">${item.entry?.recipe?`<a href="${escape(item.entry.recipe)}" download>下载配方 ↓</a>`:''}${item.asset?.modelAvailable?`<a href="/assets/models/${escape(item.asset.model)}.glb" download>下载模型 ↓</a>`:''}</div>
      </header>
      ${patternText(item.record)}
      <figure class="ap-detail-media${hasThumbnails?' has-thumbnails':''}"${item.record?.pattern_text?.length?' data-toc-title="图例"':''}>
        <div class="ap-image-gallery">${thumbnails}<div class="ap-stage${mode==='drawing'?' is-drawing':''}" aria-label="资料主展示">${stageMedia}${expandIcon(isModel?'model':'image')}</div></div>
        ${images.length ? `<figcaption class="ap-caption" data-image-caption${caption ? '' : ' hidden'}>${escape(caption)}</figcaption>` : ''}
      </figure>
      <div class="ap-viewer-controls" hidden><label>动作<select id="motion-mode"><option value="idle">待机</option><option value="walk">行走</option><option value="spin">转圈</option></select></label><button id="pause-motion">暂停动作</button><button id="reset-view">复位视角</button><span id="motion-status" role="status"></span></div><div class="ap-media-modes" role="group" aria-label="展示形式">${modes(item).map(([key,label])=>`<button data-view-mode="${key}" aria-pressed="${mode===key}">${lineIcon(key==='model'?'models':key==='drawing'?'drawings':key==='image'?item.kind:key)}<span>${label}</span></button>`).join('')}</div>
      ${parameters(item)}${related(item)}${sourceFooter(item)}
      <dialog class="ap-lightbox" aria-label="媒体全屏查看"><div class="ap-lightbox-shell"><button class="ap-lightbox-close" type="button" data-close-lightbox aria-label="关闭全屏查看"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button><div class="ap-lightbox-stage" data-lightbox-stage></div>
          <div class="ap-image-controls" role="group" aria-label="图片缩放"><button type="button" data-image-zoom="out" aria-label="缩小图片">−</button><button type="button" data-image-zoom="reset">适应窗口</button><button type="button" data-image-zoom="in" aria-label="放大图片">+</button><span>滚轮缩放 · 拖拽移动</span></div>
          <div class="ap-lightbox-controls" data-lightbox-controls hidden><label>动作<select id="motion-mode"><option value="idle">待机</option><option value="walk">行走</option><option value="spin">转圈</option></select></label><button id="pause-motion">暂停动作</button><button id="reset-view">复位视角</button><span id="motion-status" role="status"></span><p>拖动旋转 · 滚轮或双指缩放 · 转动与动作会驱动物理效果</p></div></div></dialog>`;
  }
  function render(id){
    items=createAssetItems(data);byId=new Map(items.map(item=>[item.id,item]));
    cleanup();
    if(id==='assets'){current=null;return gallery();}
    if(!id.startsWith('asset:')){current=null;return null;}
    current=byId.get(id.slice(6))||byId.get('images-'+id.slice(6));if(!current)return '<h1>资料入口</h1><a href="#/assets">浏览资料库 →</a>';
    mediaIndex=0;mode=current.kind==='images'||current.kind==='books'?'images':current.kind==='drawings'?'drawing':current.asset?'model':'image';
    return detail(current);
  }
  function mount(root){
    if(!current&&!root.querySelector('.ap-filters'))return;
    events=new AbortController();
    const addExpand=(stage,kind)=>stage.insertAdjacentHTML('beforeend',expandIcon(kind));
    const bindDialog=()=>{const dialog=root.querySelector('.ap-lightbox');if(!dialog)return;dialog.addEventListener('close',()=>{stopImageView?.();stopImageView=null;serial++;fullscreenViewer?.cleanup();fullscreenViewer=null;document.documentElement.classList.remove('has-media-lightbox');if(mode==='model'&&current?.asset?.modelAvailable)startViewer(true);},{signal:events.signal});};
    const update=()=>{stopViewers();root.innerHTML=current?detail(current):gallery();bindDialog();startViewer();};
    const startViewer=async focusExpand=>{if(mode!=='model'||!current?.asset?.modelAvailable)return;const token=++serial,stage=root.querySelector('.ap-stage');if(!stage)return;try{const {mountViewer}=await import('/viewer.js');if(token!==serial||!stage.isConnected)return;viewer=mountViewer(stage,{root,allowStatic:true,modelUrl:'/assets/models/'+current.asset.model+'.glb',onError:()=>{if(token!==serial||!stage.isConnected)return;viewer?.cleanup();viewer=null;stage.innerHTML=`${image(current.cover,current.title)}<button type="button" data-start-viewer>重试三维预览</button>${expandIcon('model')}`;root.querySelector('.ap-viewer-controls').hidden=true;}});addExpand(stage,'model');root.querySelector('.ap-viewer-controls').hidden=false;root.querySelector('[data-view-mode="model"] span').textContent='三维模型';if(focusExpand)stage.querySelector('.ap-expand')?.focus();}catch{if(token===serial&&stage.isConnected)stage.innerHTML=`${image(current.cover,current.title)}<button type="button" data-start-viewer>重试三维预览</button>${expandIcon('model')}`;}};
    const openImage = dialog => {
      const file = selectedFile(current);
      if (!file) return;
      const stage = dialog.querySelector('[data-lightbox-stage]');
      const img = document.createElement('img');
      img.src = file;
      img.alt = (mode === 'images' && mediaCaption(current, media(current)[mediaIndex])) || current.title;
      img.draggable = false;
      stage.replaceChildren(img);
      dialog.querySelector('[data-lightbox-controls]').hidden = true;
      dialog.dataset.mode = 'image';
      stage.tabIndex = 0;
      stage.setAttribute('aria-label', '图片视图，放大后可拖拽或使用方向键移动');
      dialog.showModal();
      document.documentElement.classList.add('has-media-lightbox');
      stopImageView = mountImageView(stage, img, dialog.querySelector('.ap-image-controls'));
    };
    const openModel=async dialog=>{serial++;viewer?.cleanup();viewer=null;const token=serial,stage=dialog.querySelector('[data-lightbox-stage]'),controls=dialog.querySelector('[data-lightbox-controls]');stage.innerHTML='<span class="ap-model-loading" role="status">正在加载三维预览…</span>';controls.hidden=false;dialog.dataset.mode='model';stage.removeAttribute('tabindex');stage.removeAttribute('aria-label');dialog.showModal();document.documentElement.classList.add('has-media-lightbox');await new Promise(requestAnimationFrame);try{const {mountViewer}=await import('/viewer.js');if(token!==serial||!dialog.open)return;fullscreenViewer=mountViewer(stage,{root:dialog,allowStatic:true,modelUrl:'/assets/models/'+current.asset.model+'.glb',onError:()=>{if(token!==serial||!stage.isConnected)return;fullscreenViewer?.cleanup();fullscreenViewer=null;stage.innerHTML=`${image(current.cover,current.title)}<p class="ap-lightbox-error">三维模型加载失败</p>`;}});}catch{if(token===serial&&stage.isConnected)stage.innerHTML=`${image(current.cover,current.title)}<p class="ap-lightbox-error">三维模型加载失败</p>`;}};
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.assetFilter){current=null;filter=button.dataset.assetFilter;update();window.scrollTo({top:0,behavior:'instant'});return;}
      if(button.dataset.viewMode){mode=button.dataset.viewMode;update();return;}
      if (button.dataset.mediaIndex !== undefined) {
        const nextIndex = Number(button.dataset.mediaIndex);
        const entry = media(current)[nextIndex];
        const mainImage = root.querySelector('.ap-main-image img');
        if (!entry?.path || !mainImage || nextIndex === mediaIndex) return;
        mediaIndex = nextIndex;
        const caption = mediaCaption(current, entry);
        root.querySelector('.ap-thumbnails [aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-pressed', 'true');
        mainImage.src = entry.path;
        mainImage.alt = caption || current.title;
        const captionNode = root.querySelector('[data-image-caption]');
        captionNode.textContent = caption;
        captionNode.hidden = !caption;
        return;
      }
      if(button.dataset.expandMedia){const dialog=root.querySelector('.ap-lightbox');if(button.dataset.expandMedia==='model')await openModel(dialog);else openImage(dialog);return;}
      if(button.hasAttribute('data-close-lightbox')){button.closest('dialog')?.close();return;}
      if(button.hasAttribute('data-start-viewer'))startViewer();
    },{signal:events.signal});
    root.addEventListener('click',event=>{if(event.target.matches?.('.ap-lightbox'))event.target.close();},{signal:events.signal});
    bindDialog();
    startViewer();
  }
  return {render,mount,cleanup,items};
}
