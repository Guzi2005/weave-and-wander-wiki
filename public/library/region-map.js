import {renderKnowledgeArticle,tagHref,recommendEthnicities} from './knowledge-base.js';
import {mountMapLabels} from './region-labels.js';
// Shared module: the demo owns routing; a future Wiki adapter supplies onNavigate.
const NS = 'http://www.w3.org/2000/svg';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const special = {150000:'内蒙古',450000:'广西',540000:'西藏',640000:'宁夏',650000:'新疆',230000:'黑龙江',810000:'香港',820000:'澳门'};
export function shortName(name, id) { return special[id] || name.replace(/省$|市$/g, ''); }
export function readRegionRoute(hash) {
  const match = /^#\/region\/([a-z0-9-]+)$/.exec(hash);
  return match ? match[1] : 'china';
}
export function regionHref(id) { return tagHref(id); }
export function createRegionIndex(geo) {
  if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) throw new Error('地图数据格式不正确');
  const regions = geo.features.filter(f => /^\d{6}$/.test(String(f.properties?.adcode)) && f.properties?.name)
    .map(f => ({id:String(f.properties.adcode), name:f.properties.name, short:shortName(f.properties.name,f.properties.adcode), feature:f}));
  if (regions.length !== 34 || new Set(regions.map(r=>r.id)).size !== 34) throw new Error('省级地域数据不完整');
  return regions;
}
function svgEl(tag, attrs = {}) { const el = document.createElementNS(NS,tag); for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v); return el; }
// Lightweight geographic rendering; original GeoJSON is kept locally.
export function geometryPath(geometry, project) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => polygon.map(ring => ring.map((point,i) => {
    const [x,y]=project(point); return `${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ')+'Z').join(' ')).join(' ');
}
const project = ([lon,lat]) => [(lon-73)*9,(54-lat)*10];
const insetProject = ([lon,lat]) => [465+(lon-105)*5,245+(24-lat)*6];
const position = {
 '110000':'华北','120000':'华北','130000':'华北','140000':'华北','150000':'中国北部',
 '210000':'东北','220000':'东北','230000':'东北','310000':'华东','320000':'华东','330000':'华东','340000':'华东','350000':'东南沿海','360000':'中国东南部','370000':'中国东部沿海',
 '410000':'中部','420000':'中部','430000':'中部','440000':'华南','450000':'华南','460000':'中国南部',
 '500000':'西南','510000':'西南','520000':'西南','530000':'西南','540000':'中国西南部',
 '610000':'西北','620000':'西北','630000':'中国西部','640000':'西北','650000':'中国西北部',
 '710000':'中国东南沿海的海域','810000':'珠江口东侧','820000':'珠江口西侧'
};
export function nearestRegions(regions,id,limit=5) {
  const current=regions.find(r=>r.id===id);
  const center=r=>r.feature.properties.centroid||r.feature.properties.center;
  if(!current||!center(current))return [];
  const rad=n=>n*Math.PI/180;
  const [lon,lat]=center(current).map(rad);
  function distance(r) {
    const [otherLon,otherLat]=center(r).map(rad);
    return Math.sin((otherLat-lat)/2)**2+Math.cos(lat)*Math.cos(otherLat)*Math.sin((otherLon-lon)/2)**2;
  }
  return regions.filter(r=>r.id!==id&&center(r)).sort((a,b)=>distance(a)-distance(b)||a.id.localeCompare(b.id)).slice(0,limit);
}
const typeOf = r => r.name.includes('自治区')?'自治区':r.name.includes('特别行政区')?'特别行政区':r.name.endsWith('市')?'直辖市':'省';
export async function mountRegionMap(host, {geoUrl = new URL('./china.geo.json', import.meta.url), onNavigate = id => {location.hash=tagHref(id);}, knowledge=null,renderExtraArticle=null,onArticleRendered=null,getContextRegions=null} = {}) {
  let regions=[], current='china', destroyed=false, hoveredPath=null;
  let camera={x:0,y:0,zoom:1}, drag=null, suppressClickUntil=0;
  let targetCamera={...camera}, cameraFrame=0, labelFrame=0, mapLabels=null;
  const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
  const abort = new AbortController();
  host.innerHTML = `<section class="rm-shell" aria-label="地域索引模块"><button type="button" class="rm-mobile-navigation" data-sidebar-toggle aria-controls="rm-sidebar" aria-expanded="false">地域与民族导航 ＋</button><aside class="rm-sidebar" id="rm-sidebar"><header class="rm-top"><div class="rm-eyebrow">Geographic index</div><h2>循地而览</h2><p>一方水土养一方人</p><div class="rm-tabs" role="tablist" aria-label="地图范围"><button id="rm-tab-china" class="rm-tab" role="tab" aria-selected="true" aria-controls="rm-panel-china">中国</button><button id="rm-tab-abroad" class="rm-tab" role="tab" aria-selected="false" aria-controls="rm-panel-abroad" tabindex="-1">国外</button></div></header><section id="rm-panel-china" role="tabpanel" aria-labelledby="rm-tab-china"><div class="rm-map-wrap"><div class="rm-tooltip" hidden></div><div class="rm-map-slot" aria-busy="true"><p class="rm-note">正在展开地图…</p></div></div><div class="rm-tools"><button data-zoom="reset" aria-label="复位地图缩放与位置">复位</button></div><nav class="rm-small" aria-label="附近地域" hidden></nav><nav class="rm-small rm-recommended-ethnics" aria-label="相关民族推荐" hidden></nav><details class="rm-directory"><summary>全部省级地域 <span>· 34</span></summary><input class="rm-search" type="search" placeholder="查找省、自治区、直辖市…" aria-label="搜索地域"><nav class="rm-list" aria-label="省级地域目录"></nav></details><details class="rm-directory rm-ethnic-directory"><summary>民族目录 <span>· 56</span></summary><input class="rm-search rm-ethnic-search" type="search" placeholder="查找民族…" aria-label="搜索民族"><nav class="rm-list rm-ethnic-list" aria-label="民族目录"></nav><a class="rm-all-ethnics" href="#/ethnic" data-region="ethnic-index">全部民族与服饰介绍 →</a></details></section><section id="rm-panel-abroad" role="tabpanel" aria-labelledby="rm-tab-abroad" hidden><div class="rm-foreign"><div class="rm-world-symbol" aria-hidden="true">◎</div><p>先按国家整理，逐步补充更具体的地域。</p><a href="${regionHref('abroad')}" data-region="abroad">国外概览 →</a><a href="${regionHref('ukraine')}" data-region="ukraine">乌克兰 →</a></div></section></aside><article class="rm-article" aria-live="polite" aria-atomic="true"></article></section>`;
  const $ = selector => host.querySelector(selector);
  const paths = new Map();
  function switchTab(tab) {
    hideTip();
    for(const key of ['china','abroad']) {
      const button=$(`#rm-tab-${key}`); button.setAttribute('aria-selected',String(key===tab));button.tabIndex=key===tab?0:-1;
      $(`#rm-panel-${key}`).hidden=key!==tab;
    }
  }
  function renderList() {
    const q=$('.rm-search').value.trim();
    const matches=regions.filter(r=>r.name.includes(q)||r.short.includes(q));
    $('.rm-list').innerHTML=matches.length?matches.map(r=>`<a href="${regionHref(r.id)}" data-region="${r.id}" ${current===r.id?'aria-current="page"':''}>${escape(r.short)}</a>`).join(''):'<p class="rm-empty">没有匹配的地域，请试试简称。</p>';
  }
  function article(id) {
    const extra=renderExtraArticle?.(id);
    if(extra!==null&&extra!==undefined){$('.rm-article').innerHTML=extra;return;}
    const content=renderKnowledgeArticle(id,knowledge);
    if(content){$('.rm-article').innerHTML=content;return;}
    const name=id==='abroad'?'国外':id==='ukraine'?'乌克兰':'词条入口';
    const body=id==='abroad'?`<p class="rm-lead">按国家查阅各地服饰与文化。</p>${linkFallback('ukraine','乌克兰')}`:id==='ukraine'?'<p class="rm-lead">乌克兰位于欧洲。项目收录了参考照片适配的服饰套装及相关部件。</p>':'<p class="rm-lead">从地域索引或民族索引继续浏览。</p>';
    $('.rm-article').innerHTML=`<h1>${name}</h1>${body}<div class="rm-actions">${linkFallback('china','地域索引')}${linkFallback('ethnic-index','民族索引')}</div>`;
  }
  function linkFallback(id,name){return `<a href="${tagHref(id)}" data-region="${id}">${name} →</a>`;}

  function select(id) {
    const previous=current;
    $('.rm-shell').classList.toggle('is-contribution-page',id==='contribute');
    current=id;
    $('.rm-shell').classList.toggle('is-asset-page',id==='assets'||id.startsWith('asset:')||id.startsWith('culture:')||id==='contribute');
    hideTip();
    switchTab(['abroad','ukraine'].includes(id)?'abroad':'china');
    const ethnic=knowledge?.ethnicMap.get(id);
    const contextual=getContextRegions?.(id)||[];
    const related=new Set(ethnic?.distribution.map(edge=>edge.region)||contextual);
    if(ethnic||(contextual.length&&previous!==id)){stopCamera();animateCamera({x:0,y:0,zoom:1});}
    for(const [code,path] of paths) {
      path.classList.toggle('is-related',related.has(code));
      if(code===id)path.setAttribute('aria-current','page');else path.removeAttribute('aria-current');
    }
    host.querySelectorAll('.rm-region-hit').forEach(hit=>{if(hit.dataset.region===id)hit.setAttribute('aria-current','page');else hit.removeAttribute('aria-current');});
    $('.rm-map')?.classList.toggle('is-ethnic-view',Boolean(ethnic));
    host.querySelectorAll('.rm-map-label').forEach(label=>label.classList.toggle('is-selected',label.dataset.id===id));
    renderList(); renderEthnicList(); renderNearby(); article(id);onArticleRendered?.(id,$('.rm-article'));scheduleLabels();
  }
  function renderEthnicList(){
    const query=$('.rm-ethnic-search').value.trim();
    const rows=(knowledge?.ethnicities||[]).filter(row=>row.name.includes(query));
    $('.rm-ethnic-list').innerHTML=rows.map(row=>`<a href="${tagHref(row.id)}" data-region="${row.id}" ${current===row.id?'aria-current="page"':''}>${escape(row.name)}</a>`).join('')||'<p class="rm-empty">没有匹配的民族。</p>';
    $('.rm-ethnic-directory').hidden=!knowledge;
  }
  function renderNearby() {
    const recommendations=recommendEthnicities(knowledge,current,regions);
    const ethnicNav=$('.rm-recommended-ethnics');ethnicNav.hidden=!recommendations.length;
    ethnicNav.innerHTML=recommendations.map(({row,reason})=>`<a href="${tagHref(row.id)}" data-region="${row.id}" title="${escape(reason)}">${escape(row.name)} ↗</a>`).join('');
    const nearby=nearestRegions(regions,current);
    $('.rm-small').hidden=!nearby.length;
    $('.rm-small').innerHTML=nearby.map(r=>`<a href="${regionHref(r.id)}" data-region="${r.id}">${escape(r.short)} ↗</a>`).join('');
  }
  function showTip(r,path) {
    if(drag?.moved)return;
    if(hoveredPath!==path)hoveredPath?.classList.remove('is-hovered');
    hoveredPath=path;
    $('.rm-tooltip').textContent=`${r.name} · 点击进入`;$('.rm-tooltip').hidden=false;
    path?.classList.add('is-hovered');
  }
  function hideTip(path) {
    if(path&&hoveredPath!==path)return;
    $('.rm-tooltip').hidden=true;
    hoveredPath?.classList.remove('is-hovered');
    hoveredPath=null;
  }
  function scheduleLabels(){
    if(labelFrame||destroyed)return;
    labelFrame=requestAnimationFrame(()=>{labelFrame=0;mapLabels?.layout(current);});
  }
  function stopCamera(){
    cancelAnimationFrame(cameraFrame);cameraFrame=0;targetCamera={...camera};
  }
  function animateCamera(next){
    targetCamera=constrainCamera(next);
    if(reducedMotion.matches){camera={...next};updateCamera();return;}
    if(cameraFrame)return;
    let previous=performance.now();
    function tick(now){
      const t=1-Math.exp(-Math.min(40,now-previous)/45);previous=now;
      camera.x+=(targetCamera.x-camera.x)*t;camera.y+=(targetCamera.y-camera.y)*t;
      camera.zoom+=(targetCamera.zoom-camera.zoom)*t;
      const settled=Math.abs(targetCamera.zoom-camera.zoom)<.001&&Math.abs(targetCamera.x-camera.x)<.02&&Math.abs(targetCamera.y-camera.y)<.02;
      if(settled)camera={...targetCamera};
      updateCamera();cameraFrame=settled?0:requestAnimationFrame(tick);
    }
    cameraFrame=requestAnimationFrame(tick);
  }
  function constrainCamera(value){
    const width=600/value.zoom,height=420/value.zoom;
    return {...value,x:Math.max(-width*.8,Math.min(600-width*.2,value.x)),y:Math.max(-height*.8,Math.min(420-height*.2,value.y))};
  }
  function updateCamera() {
    const svg=$('.rm-map');if(!svg)return;
    const width=600/camera.zoom,height=420/camera.zoom;
    // Keep some of the map in reach even after a long drag.
    camera=constrainCamera(camera);
    svg.setAttribute('viewBox',`${camera.x} ${camera.y} ${width} ${height}`);
    svg.style.setProperty('--rm-lift',`${-7/camera.zoom}px`);
    scheduleLabels();
  }
  function attachCamera(svg) {
    const options={signal:abort.signal};
    const slot=$('.rm-map-slot');
    slot.addEventListener('wheel',event=>{
      event.preventDefault();
      finishDrag();hideTip();
      const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      const matrix=svg.getScreenCTM();if(!matrix)return;
      const anchor=point.matrixTransform(matrix.inverse());
      const fx=(anchor.x-camera.x)/(600/camera.zoom),fy=(anchor.y-camera.y)/(420/camera.zoom);
      const unit=event.deltaMode===1?16:event.deltaMode===2?svg.clientHeight:1;
      const delta=Math.max(-120,Math.min(120,event.deltaY*unit));
      const nextZoom=Math.max(.75,Math.min(24,targetCamera.zoom*Math.exp(-delta*.006)));
      const worldX=targetCamera.x+fx*600/targetCamera.zoom,worldY=targetCamera.y+fy*420/targetCamera.zoom;
      animateCamera({x:worldX-fx*600/nextZoom,y:worldY-fy*420/nextZoom,zoom:nextZoom});
    },{...options,passive:false});
    slot.addEventListener('pointerdown',event=>{
      if(event.button!==0||!event.isPrimary)return;
      stopCamera();
      drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,camera:{...camera},moved:false};
    },options);
    window.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      if(!drag.moved){drag.moved=true;svg.setPointerCapture(event.pointerId);svg.classList.add('is-dragging');hideTip();}
      const rect=svg.getBoundingClientRect();
      camera.x=drag.camera.x-dx*600/drag.camera.zoom/rect.width;
      camera.y=drag.camera.y-dy*420/drag.camera.zoom/rect.height;
      updateCamera();
    },options);
    function finishDrag(event) {
      if(!drag||(event?.pointerId!==undefined&&event.pointerId!==drag.id))return;
      if(drag.moved){suppressClickUntil=performance.now()+250;targetCamera={...camera};}
      const pointerId=drag.id;drag=null;
      svg.classList.remove('is-dragging');
      if(svg.hasPointerCapture(pointerId))svg.releasePointerCapture(pointerId);
    }
    window.addEventListener('pointerup',finishDrag,options);
    window.addEventListener('pointercancel',finishDrag,options);
    window.addEventListener('blur',()=>{finishDrag();hideTip();},options);
    svg.addEventListener('lostpointercapture',finishDrag,options);
    slot.addEventListener('pointerleave',()=>hideTip(),options);
    svg.addEventListener('keydown',event=>{
      if(event.target!==svg)return;
      stopCamera();
      const moves={ArrowLeft:[-35,0],ArrowRight:[35,0],ArrowUp:[0,-35],ArrowDown:[0,35]};
      if(moves[event.key]){event.preventDefault();camera.x+=moves[event.key][0]/camera.zoom;camera.y+=moves[event.key][1]/camera.zoom;updateCamera();}
      if(event.key==='Home'){event.preventDefault();camera={x:0,y:0,zoom:1};updateCamera();}
    },options);
  }
  function draw(geo) {
    const svg=svgEl('svg',{class:'rm-map',viewBox:'0 0 600 420',role:'group',tabindex:0,'aria-label':'中国省级地域地图，可滚轮缩放、拖拽移动，Home 键复位'});
    const defs=svgEl('defs');
    const mainClip=svgEl('clipPath',{id:'rm-main-clip'}); mainClip.append(svgEl('rect',{x:0,y:0,width:600,height:373}));
    const insetClip=svgEl('clipPath',{id:'rm-inset-clip'});insetClip.append(svgEl('rect',{x:465,y:245,width:110,height:145}));defs.append(mainClip,insetClip);svg.append(defs);
    const main=svgEl('g',{'clip-path':'url(#rm-main-clip)'});const faces=svgEl('g',{'pointer-events':'none'}),hits=svgEl('g',{class:'rm-hit-layer'});main.append(faces,hits);svg.append(main);
    for(const r of regions) {
      const d=geometryPath(r.feature.geometry,project);
      const path=svgEl('path',{d,class:'rm-province','data-map-region':r.id,'aria-hidden':'true','fill-rule':'evenodd'});
      const hit=svgEl('path',{d,class:'rm-region-hit',tabindex:0,role:'link','aria-label':`${r.name}，查看地域词条`,'data-region':r.id,'fill-rule':'evenodd'});
      hit.addEventListener('pointerenter',()=>showTip(r,path));hit.addEventListener('pointerleave',()=>hideTip(path));
      hit.addEventListener('focus',()=>{if(hit.matches(':focus-visible')){path.classList.add('is-focused');showTip(r,path);}});
      hit.addEventListener('blur',()=>{path.classList.remove('is-focused');hideTip(path);});
      hit.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onNavigate(r.id);}});
      faces.append(path);hits.append(hit);paths.set(r.id,path);

    }
    // Offshore islands and boundary segments remain visible in their own inset.
    svg.append(svgEl('rect',{x:459,y:239,width:122,height:158,class:'rm-inset'}));
    const inset=svgEl('g',{'clip-path':'url(#rm-inset-clip)','aria-hidden':'true','pointer-events':'none'});
    for(const f of geo.features) inset.append(svgEl('path',{d:geometryPath(f.geometry,insetProject),fill:f.properties.name?'#dcebe3':'none',stroke:'#86a99a','stroke-width':.7}));
    svg.append(inset);
    const caption=svgEl('text',{x:465,y:412,class:'rm-map-caption','aria-hidden':'true'});caption.textContent='南海诸岛';svg.append(caption);
    $('.rm-map-slot').replaceChildren(svg);$('.rm-map-slot').setAttribute('aria-busy','false');
    mapLabels?.destroy();
    mapLabels=mountMapLabels({slot:$('.rm-map-slot'),svg,regions,paths,signal:abort.signal,onHover:showTip,onLeave:hideTip});
    attachCamera(svg);updateCamera();
  }
  async function load() {
    try {
      const response=await fetch(geoUrl,{signal:abort.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const geo=await response.json();regions=createRegionIndex(geo);if(destroyed)return;
      draw(geo);select(current);
    } catch(error) {
      if(error.name==='AbortError')return;
      $('.rm-map-slot').innerHTML='<div class="rm-error">地图暂时没有展开，请检查本地服务后重试。<button class="rm-retry">重新加载</button></div>';
      $('.rm-map-slot').setAttribute('aria-busy','false');$('.rm-retry').onclick=load;
    }
  }
  host.addEventListener('click',event=>{
    const toggle=event.target.closest('[data-sidebar-toggle]');
    if(toggle){const open=$('.rm-shell').classList.toggle('is-navigation-open');toggle.setAttribute('aria-expanded',String(open));toggle.textContent='地域与民族导航 '+(open?'−':'＋');}

    if(event.target.closest('.rm-map-slot')&&performance.now()<suppressClickUntil&&event.detail!==0){event.preventDefault();return;}
    const target=event.target.closest('[data-region]');
    if(target&&host.contains(target)) {
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      event.preventDefault();hideTip();onNavigate(event.mapRegionId||target.dataset.region);
    }
    const zoomButton=event.target.closest('[data-zoom]');
    if(zoomButton) {
      stopCamera();hideTip();animateCamera({x:0,y:0,zoom:1});
    }
  },{signal:abort.signal});
  for(const tab of ['china','abroad']) {
    $(`#rm-tab-${tab}`).addEventListener('click',()=>{switchTab(tab);},{signal:abort.signal});
    $(`#rm-tab-${tab}`).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const other=event.key==='Home'?'china':event.key==='End'?'abroad':tab==='china'?'abroad':'china';switchTab(other);$(`#rm-tab-${other}`).focus();}},{signal:abort.signal});
  }
  $('.rm-search').addEventListener('input',renderList,{signal:abort.signal});
  $('.rm-ethnic-search').addEventListener('input',renderEthnicList,{signal:abort.signal});
  host.addEventListener('input',event=>{if(event.target.matches('.rm-ethnic-catalog-search')){const q=event.target.value.trim();host.querySelectorAll('.rm-ethnic-entry').forEach(entry=>entry.hidden=!entry.dataset.name.includes(q));}},{signal:abort.signal});
  const resizeObserver=new ResizeObserver(scheduleLabels);resizeObserver.observe($('.rm-map-slot'));
  document.fonts?.ready.then(scheduleLabels);
  await load();
  return {select,destroy(){destroyed=true;stopCamera();cancelAnimationFrame(labelFrame);resizeObserver.disconnect();mapLabels?.destroy();abort.abort();host.replaceChildren();}};
}
