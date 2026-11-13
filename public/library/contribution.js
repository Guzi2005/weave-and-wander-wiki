import {connectForest} from './curved-forest.js';
import {baseMedia,fileMediaId,orderMedia,moveMedia} from './record-media.js';
import {createLibraryReading} from './library-reading.js';
import {seedUploadTrees,descendants,expandSelection,nodeUsage,removeEmptyNode} from './contribution-trees.js';
import {INITIAL_TOPICS,recordsForTopic,entryNodes} from './library-management.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEYS={trees:'ww-contribution-trees-v1',topics:'ww-contribution-topics-v1',records:'ww-contribution-record-edits-v1'};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
export function createContribution(data,knowledge,{tags,readDrafts,saveDraft,inferFileKind,store}){
  const sourceData=data;
  const persistence=store?.persistence||localStorage;
  const read=(key,fallback)=>{try{return JSON.parse(persistence.getItem(key))||fallback;}catch{return fallback;}};
  const reading=store?createLibraryReading(store,knowledge):null;
  let previewParams=new URLSearchParams(),unsubscribe=null,mediaOrder=[],activeMediaId=null,inspectedNodeId=null,contextMenu=null,uploadDialog=null,returnState=null;
  let root,controller,topics,nodes,overrides,drafts=[],state,selected=new Set(),files=[],urls=[],expanded=new Set(),timer=null,storageQueue=Promise.resolve();
  const fileMap=new Map();
  let disconnectCurves=()=>{},fileWrites=0;
  const cleanup=()=>{disconnectCurves();if(root?.isConnected)flushSave();clearTimeout(timer);unsubscribe?.();unsubscribe=null;reading?.cleanup();contextMenu?.remove();contextMenu=null;uploadDialog?.remove();uploadDialog=null;controller?.abort();urls.forEach(url=>URL.revokeObjectURL(url));urls=[];};
  const $=selector=>uploadDialog?.querySelector(selector)||root.querySelector(selector);
  const status=text=>{const el=$('.cm-status');if(el)el.textContent=text;};
  const topic=()=>topics.find(t=>t.id===state.topicId);
  const records=()=>recordsForTopic(data,topics,state.topicId,overrides);
  const visibleNodes=()=>nodes.filter(n=>!n.recordId&&n.id!=='tree-entries'&&(!n.topicId||n.topicId===state.topicId));
  const persistNodes=()=>(persistence.setItem(KEYS.trees,JSON.stringify(nodes.filter(n=>!n.recordId).map(n=>({...n,recordIds:[]})))),store?.changed());
  const persistTopics=()=>persistence.setItem(KEYS.topics,JSON.stringify(topics));
  const choices=(name,title,rows,values=[])=>`<details class="cu-choice"><summary>${title}<span>${values.map(id=>rows.find(r=>r.id===id)?.name).filter(Boolean).map(esc).join('、')||'选择'}</span></summary><input type="search" data-choice-search="${name}" placeholder="查找${title}" aria-label="查找${title}"><div class="cu-choice-list">${rows.map(r=>`<label><input type="checkbox" name="${name}" value="${esc(r.id)}" ${values.includes(r.id)?'checked':''}><span>${esc(r.name)}</span></label>`).join('')}</div></details>`;
  function render(){return `<nav class="rm-breadcrumb"><a href="#/assets">资料库</a><span>/</span><a href="#/contribute">参与共创</a><span>/</span><span>资料库管理</span></nav><header class="cm-header"><div><div class="rm-eyebrow">Library workspace</div><h1>专题资料库</h1><p>选择专题或树节点，整理资料与文件。</p></div><button type="button" data-action="new-topic">＋ 新建专题</button></header><div class="cm-workspace"><aside class="cm-library"><div class="cm-library-heading"><h2>资料库</h2><span>${data.records.length} 条资料</span></div><label class="cm-search">查找专题与资料<input type="search" data-library-search placeholder="名称或编号"></label><div class="cm-library-tree"></div></aside><div class="cm-editor"></div></div><p class="cm-status" role="status"></p>`;}
  function renderLibrary(){
    $('.cm-library-heading>span').textContent=data.records.length+' 条资料';
    const query=$('[data-library-search]')?.value.trim().toLowerCase()||'';
    const row=(record,topicId,seen=new Set())=>{if(seen.has(record.id))return '';seen=new Set([...seen,record.id]);const children=recordsForTopic(data,topics,topicId,overrides).filter(r=>r.parent_id===record.id);return `<li><div class="cm-library-row"><button type="button" data-action="record" data-topic="${esc(topicId)}" data-id="${esc(record.id)}" ${state.mode==='record'&&state.recordId===record.id?'aria-current="true"':''}><span>${record.record_type==='ensemble'?'▤':'·'}</span>${esc(record.title)}</button></div>${children.length?`<ul>${children.map(r=>row(r,topicId,seen)).join('')}</ul>`:''}</li>`;};
    $('.cm-library-tree').innerHTML=topics.map(t=>{const all=recordsForTopic(data,topics,t.id,overrides),matched=all.filter(r=>(r.title+' '+r.id).toLowerCase().includes(query));if(query&&!t.name.toLowerCase().includes(query)&&!matched.length)return '';const list=query?matched:all.filter(r=>!all.some(p=>p.id===r.parent_id));return `<details data-topic-branch="${esc(t.id)}" ${expanded.has(t.id)||query?'open':''}><summary><button type="button" class="cm-topic-preview-link" data-action="topic-preview" data-topic="${esc(t.id)}">${esc(t.name)}</button><small>${all.length} 条</small></summary><div class="cm-topic-tools"><button type="button" data-action="topic" data-topic="${esc(t.id)}">编辑专题</button></div><ul>${list.map(r=>query?`<li><button type="button" data-action="record" data-topic="${esc(t.id)}" data-id="${esc(r.id)}">${esc(r.title)}</button></li>`:row(r,t.id)).join('')}${!list.length?'<li class="cm-muted">从专题下添加第一条资料</li>':''}</ul></details>`;}).join('')||'<p class="cm-muted">暂无匹配资料</p>';
    root.querySelectorAll('[data-topic-branch]').forEach(el=>el.addEventListener('toggle',()=>{el.open?expanded.add(el.dataset.topicBranch):expanded.delete(el.dataset.topicBranch);},{signal:controller.signal}));
  }
  function panelHeader(title){return `<div class="cm-panel-heading"><h2>${esc(title)}</h2><span>${esc(topic()?.name||'新建专题')}${state.nodeId?' / '+esc(nodes.find(n=>n.id===state.nodeId)?.label||''):''}${state.recordId?' / '+esc(data.records.find(r=>r.id===state.recordId)?.title||''):''}</span><small class="cm-autosave-hint">编辑后自动保存</small></div>`;}
  function paintEditor(values=null){
    disconnectCurves();
    urls.forEach(url=>URL.revokeObjectURL(url));urls=[];
    const panel=uploadDialog?.querySelector('.cm-dialog-content')||$('.cm-editor');
    if(state.mode==='overview'){panel.innerHTML=`<div class="cm-overview"><h2>从资料库开始</h2><p>展开左侧专题查看套装、条目与部件；选择专题可编辑介绍及关联信息。</p></div>`;return;}
    if(state.mode==='preview'&&reading){
      const id=state.topicId==='culture-mosuo'?'culture:mosuo':'culture:'+state.topicId;
      panel.innerHTML=reading.render(id,{params:previewParams});
      panel.querySelector('.rm-breadcrumb')?.remove();
      panel.querySelectorAll('a').forEach(anchor=>{const replacement=document.createElement(anchor.classList.contains('mp-card')?'div':'span');replacement.className=anchor.className;replacement.innerHTML=anchor.innerHTML.replace(/ ↗| →/g,'');anchor.replaceWith(replacement);});
      const title=panel.querySelector('h1');if(title){const heading=document.createElement('h2');heading.className='cm-preview-title';heading.textContent=title.textContent;title.replaceWith(heading);}
      reading.mount(id,panel,{params:previewParams,onFilter:query=>{const scrollY=window.scrollY;previewParams=query;paintEditor();window.scrollTo({top:scrollY,behavior:'instant'});}});return;
    }
    if(state.mode==='topic'){
      const t=values||topic()||{name:'',regions:[],ethnicities:[],note:''};
      panel.innerHTML=`${panelHeader(state.topicId?'编辑专题':'新建专题')}<form class="cm-topic-form cu-form"><label>专题名称<input name="title" required maxlength="120" value="${esc(t.name||t.title)}"></label><label>专题简介<textarea name="note" rows="3" maxlength="2000">${esc(t.note)}</textarea></label><div class="cu-associations">${choices('regions','关联地域',knowledge.provinces,t.regions)}${choices('ethnicities','关联民族',knowledge.ethnicities,t.ethnicities)}</div></form>${state.topicId?'<section class="cm-topic-trees cu-form"><h3>标签树</h3><div class="cu-trees cm-managed-trees"></div><div class="cu-new-tree"><input name="newTreeTitle" aria-label="新树名称" placeholder="新树名称" maxlength="60"><button type="button" data-action="add-tree">＋ 新增树</button></div></section>':''}`;
      if(state.topicId)paintTrees(false);
      return;
    }
    if(state.mode==='tags'||state.mode==='node'){
      panel.innerHTML=`${panelHeader('编辑标签树')}<p class="cu-help">在对应节点添加资料，或新增子节点。</p><div class="cu-form"><div class="cu-trees cm-managed-trees"></div><div class="cu-new-tree"><input name="newTreeTitle" aria-label="新树名称" placeholder="新树名称" maxlength="60"><button type="button" data-action="add-tree">＋ 新增树</button></div></div>`;paintTrees(false);return;
    }
    const record=state.mode==='record'?{...data.records.find(r=>r.id===state.recordId),...overrides[state.recordId]}:null;
    panel.innerHTML=`${panelHeader(record?'编辑资料':'添加资料')}<div class="cm-upload-layout"><form class="cm-upload-form cu-form"><section><h3>添加资料</h3><label class="mp-file-drop">选择或拖入文件<input name="files" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.glb,.tres,.json,.pdf,.mp4,.webm,.mov"><span>图片 · 模型 · 图纸 · 配方 · 视频　／　50 MB以内</span></label><div class="cu-files"></div><label>资料名称<input name="title" required maxlength="120" value="${esc(values?.title||record?.title||'')}" placeholder="为资料命名"></label></section>${state.mode==='upload'&&state.nodeId?'':'<section><h3>标签树</h3><div class="cu-trees"></div></section>'}<section><h3>补充来源</h3><label>作者或机构<input name="author" maxlength="200" value="${esc(values?.author||record?.source?.author||'')}"></label><label>来源网址<input name="sourceUrl" type="url" value="${esc(values?.sourceUrl||record?.source?.url||'')}" placeholder="https://…"></label><label>说明<textarea name="note" rows="3" maxlength="2000">${esc(values?.note||record?.note||'')}</textarea></label></section></form><aside class="cu-preview"><h3>资料预览</h3><div class="cu-preview-content"></div></aside></div>`;
    if(!(state.mode==='upload'&&state.nodeId))paintTrees(true);updateFiles();
  }
  function paintTrees(selectable){
    const visible=visibleNodes();const activeRecords=new Set(records().map(r=>r.id));const scopedNodes=nodes.map(n=>({...n,recordIds:(n.recordIds||[]).filter(id=>activeRecords.has(id))}));const paint=node=>{const ids=descendants(visible,node.id),leaves=ids.filter(id=>!visible.some(n=>n.parentId===id)),count=leaves.filter(id=>selected.has(id)).length,usage=nodeUsage(nodes,node.id,[...drafts,...Object.entries(overrides).map(([id,r])=>({id:'edit:'+id,recordId:id,status:'autosaved',assignments:{tagIds:r.tagIds||[]}}))]),children=visible.filter(n=>n.parentId===node.id);return `<li class="cu-node"><div class="cu-node-row">${selectable&&(children.length||!node.parentId)?`<span class="cm-branch-label ${count?'has-selection':''}">${esc(node.label)}</span>`:selectable?`<button type="button" class="cm-tag-choice ${count===leaves.length?'is-selected':count?'is-partial':''}" data-action="select-tag" data-id="${esc(node.id)}" aria-pressed="${count===leaves.length}"><span>${esc(node.label)}</span>${count&&count<leaves.length?'<small>部分</small>':''}</button>`:`<button type="button" class="cm-node-name ${inspectedNodeId===node.id?'is-current':''}" data-action="node" data-topic="${esc(state.topicId)}" data-id="${esc(node.id)}">${esc(node.label)}</button>`}<small>${nodeUsage(scopedNodes,node.id,drafts.filter(d=>d.topicId===state.topicId))} 条</small>${!selectable?`<button type="button" class="cm-context-trigger" data-action="node-menu" data-id="${esc(node.id)}" aria-label="${esc(node.label)}的操作菜单" aria-haspopup="menu">⋯</button>`:''}</div>${children.length?(true?`<div class="cm-mind-children"><ul>${children.map(paint).join('')}</ul></div>`:`<details open><summary>${node.id==='tree-entries'?'展开套装与条目':'子节点'} · ${children.length}</summary><ul>${children.map(paint).join('')}</ul></details>`):''}</li>`;};
    disconnectCurves();
    $('.cu-trees').innerHTML=visible.filter(n=>!n.parentId).map(n=>`<ul class="cu-tree" aria-label="${esc(n.label)}标签树">${paint(n)}</ul>`).join('');
    disconnectCurves=connectForest($('.cu-trees'));
  }
  function currentFields(){const form=$('.cm-upload-form')||$('.cm-topic-form');return form?Object.fromEntries(new FormData(form)):{};}
  function updateFiles(){const target=$('.cu-files');if(!target)return;urls.forEach(url=>URL.revokeObjectURL(url));urls=files.map(f=>URL.createObjectURL(f));target.innerHTML=files.map((file,index)=>`<div><span>${esc(file.name)}</span><small>${inferFileKind(file.name)}</small><button type="button" data-action="remove-file" data-id="${index}">×</button></div>`).join('');const input=$('[name=title]');if(input&&!input.value&&files.length)input.value=files[0].name.replace(/\.[^.]+$/,'');preview();}
  function currentMedia(){
    const record=state.recordId&&data.records.find(r=>r.id===state.recordId),items=baseMedia(record,data.assets[record?.id]);
    files.forEach((file,index)=>items.push({id:fileMediaId(file),path:urls[index],label:file.name,type:inferFileKind(file.name)==='图片'?'image':inferFileKind(file.name)==='视频'?'video':'file'}));
    return orderMedia(items,mediaOrder);
  }
  function preview(){
    const target=$('.cu-preview-content');if(!target)return;
    const fields=currentFields(),items=currentMedia();let active=items.find(item=>item.id===activeMediaId)||items[0];activeMediaId=active?.id||null;
    let media='<span>添加文件后预览</span>';
    if(active?.type==='image')media=`<img src="${esc(active.path)}" alt="${esc(active.label)}">`;
    else if(active?.type==='video')media=`<video src="${esc(active.path)}" controls preload="metadata" playsinline></video>`;
    else if(active)media=`<div class="cm-file-placeholder"><span>${esc(active.label)}</span></div>`;
    const index=items.indexOf(active);
    target.innerHTML=`<div class="mp-preview-image">${media}</div>${items.length>1?`<div class="cm-media-navigation"><button type="button" data-action="media-prev" ${index===0?'disabled':''} aria-label="上一张">←</button><span>${index+1} / ${items.length}</span><button type="button" data-action="media-next" ${index===items.length-1?'disabled':''} aria-label="下一张">→</button></div><div class="cm-media-thumbs" aria-label="图片顺序">${items.map((item,i)=>`<div class="cm-media-thumb" draggable="true" data-media-drag="${esc(item.id)}"><button type="button" data-action="media-select" data-id="${esc(item.id)}" aria-pressed="${item.id===activeMediaId}" aria-label="查看${esc(item.label)}">${item.type==='image'?`<img src="${esc(item.path)}" alt="">`:`<span>${item.type==='video'?'视频':'文件'}</span>`}<small>${i+1}</small></button><div><button type="button" data-action="media-up" data-id="${esc(item.id)}" ${i===0?'disabled':''} aria-label="前移${esc(item.label)}">↑</button><button type="button" data-action="media-down" data-id="${esc(item.id)}" ${i===items.length-1?'disabled':''} aria-label="后移${esc(item.label)}">↓</button></div></div>`).join('')}</div><p class="cm-media-help">拖动缩略图或用箭头调整顺序</p>`:''}<h3>${esc(fields.title||'资料名称')}</h3><p>${esc(topic()?.name)}</p><div class="mp-card-tags">${nodes.filter(n=>selected.has(n.id)&&!n.recordId&&n.id!=='tree-entries').map(n=>`<span>${esc(n.label)}</span>`).join('')}</div>`;
    target.querySelector('img,video')?.addEventListener('error',()=>{const box=target.querySelector('.mp-preview-image');box.textContent=active?.label||'预览暂不可用';},{once:true});
  }
  function checked(name){return [...root.querySelectorAll(`[name="${name}"]:checked`)].map(input=>input.value);}
  function scheduleSave(){clearTimeout(timer);status('正在保存…');timer=setTimeout(flushSave,400);}
  function flushSave(){
    clearTimeout(timer);timer=null;
    const form=$('.cm-upload-form')||$('.cm-topic-form');if(!form)return;
    const fields=currentFields();delete fields.files;
    if(!fields.title?.trim()){status('填写名称后自动保存');return;}
    const url=form.elements.sourceUrl;if(url&&!url.validity.valid){status('来源网址填写完整后自动保存');return;}
    try{
      if(state.mode==='topic'){
        const id=state.topicId||'topic-'+crypto.randomUUID(),old=topics.find(t=>t.id===id);
        const next={...old,id,name:fields.title,note:fields.note,regions:checked('regions'),ethnicities:checked('ethnicities')};
        const updated=old?topics.map(t=>t.id===id?next:t):[...topics,next];
        persistence.setItem(KEYS.topics,JSON.stringify(updated));store?.changed();topics=updated;
        const created=!state.topicId;state.topicId=id;expanded.add(id);renderLibrary();
        if(created){const section=document.createElement('section');section.className='cm-topic-trees cu-form';section.innerHTML='<h3>标签树</h3><div class="cu-trees cm-managed-trees"></div><div class="cu-new-tree"><input name="newTreeTitle" aria-label="新树名称" placeholder="新树名称" maxlength="60"><button type="button" data-action="add-tree">＋ 新增树</button></div>';$('.cm-editor').append(section);paintTrees(false);}
        status('已更新，正在保存到项目');return;
      }
      if(!['upload','record'].includes(state.mode))return;
      if(state.mode==='upload'&&!files.length){status('添加文件后自动保存');return;}
      const id=state.mode==='record'?state.recordId:state.newRecordId||'local-'+crypto.randomUUID();state.newRecordId=id;
      const tagIds=expandSelection(nodes,[...selected]);
      const previous=data.records.find(r=>r.id===id);
      const edit={...overrides[id],mediaOrder:[...mediaOrder],title:fields.title,note:fields.note,topicId:state.topicId,tagIds,source:{...previous?.source,author:fields.author,url:fields.sourceUrl}};
      const nextOverrides={...overrides,[id]:edit};persistence.setItem(KEYS.records,JSON.stringify(nextOverrides));store?.changed();overrides=nextOverrides;
      if(!previous)data.records.push({id,title:fields.title,parent_id:state.recordId||null,collection_id:null,category:nodes.find(n=>n.dimension==='object-kind'&&tagIds.includes(n.id))?.label||'其他',record_type:'item',media:[]});
      if(!nodes.some(n=>n.recordId===id))nodes.push({id:'entry:'+id,label:fields.title,dimension:'record',recordId:id,parentId:state.recordId?'entry:'+state.recordId:'tree-entries',topicId:state.topicId,recordIds:[id]});
      fileMap.set(id,[...files]);
      renderLibrary();
      const t=topic(),payload={id:'autosave:'+id,schema:'ww-library-autosave-v1',recordId:id,topicId:state.topicId,fields,files:[...files],selectedNodeIds:[...selected],regions:t?.regions||[],ethnicities:t?.ethnicities||[],record:{...data.records.find(r=>r.id===id),...edit},assignments:{tagIds},status:'autosaved',updatedAt:new Date().toISOString()};
      const lifecycle=controller,recordState=state;fileWrites++;status('正在保存…');
      storageQueue=storageQueue.catch(()=>{}).then(()=>saveDraft(payload)).then(()=>{store?.changed({files:true});fileWrites--;if(!controller.signal.aborted&&!timer&&!fileWrites)status('已保存到项目');}).catch(()=>{fileWrites--;if(!lifecycle.signal.aborted&&state===recordState)status('文件保存未完成，请保留此页并重试编辑。');});
    }catch{status('自动保存未完成，请保留此页并重试编辑。');}
  }
  function navigate(next,values=null){flushSave();state={topicId:null,nodeId:null,recordId:null,...next};mediaOrder=[...(overrides[state.recordId]?.mediaOrder||[])];activeMediaId=null;selected=new Set();files=state.mode==='record'?[...(fileMap.get(state.recordId)||[])]:[];if(state.nodeId)selected=new Set(nodes.some(n=>n.parentId===state.nodeId)?[]:[state.nodeId]);if(state.recordId&&state.mode==='record')selected=new Set((overrides[state.recordId]?.tagIds||nodes.filter(n=>n.recordIds?.includes(state.recordId)&&!n.recordId).map(n=>n.id)).filter(id=>id!=='tree-entries'&&!id.startsWith('entry:')&&!nodes.some(n=>n.parentId===id)));if(state.mode==='record')for(const node of nodes)if((node.dimension==='record-type'||node.id==='structure-ensemble')&&node.recordIds?.includes(state.recordId))selected.add(node.id);if(state.topicId)expanded.add(state.topicId);renderLibrary();paintEditor(values);status('');}
  function showNodeRecords(id){
    const ids=new Set(descendants(nodes,id));const related=records().filter(r=>(overrides[r.id]?.tagIds||r._tagIds||[]).some(tag=>ids.has(tag))||nodes.some(n=>ids.has(n.id)&&n.recordIds?.includes(r.id)));
    $('.cm-node-records')?.remove();const section=document.createElement('section');section.className='cm-node-records';
    section.innerHTML=`<h3>${esc(nodes.find(n=>n.id===id)?.label)} · ${related.length} 条资料</h3><div class="cm-node-preview-grid">${related.map(r=>`<button type="button" data-action="record" data-topic="${esc(state.topicId)}" data-id="${esc(r.id)}">${(r._previewCover||data.assets[r.id]?.cover||r.media?.[0]?.path)?`<img src="${esc(r._previewCover||data.assets[r.id]?.cover||r.media?.[0]?.path)}" alt="">`:''}<span>${esc(r.title)}</span></button>`).join('')||'<p class="cm-muted">此节点暂无资料，可通过右键菜单添加。</p>'}</div>`;
    const tree=$('.cm-topic-trees');if(tree)tree.before(section);else $('.cm-editor').append(section);section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'nearest'});
  }
  function openNodeMenu(id,x,y){
    contextMenu?.remove();const node=nodes.find(n=>n.id===id);if(!node)return;const leaf=!!node.parentId&&!visibleNodes().some(n=>n.parentId===id),used=nodeUsage(nodes,id,[...drafts,...Object.entries(overrides).map(([recordId,r])=>({id:'edit:'+recordId,recordId,status:'autosaved',assignments:{tagIds:r.tagIds||[]}}))]);
    contextMenu=document.createElement('div');contextMenu.className='cm-node-menu';contextMenu.setAttribute('role','menu');
    contextMenu.innerHTML=`<strong>${esc(node.label)}</strong><button role="menuitem" type="button" data-action="upload" data-node-id="${esc(id)}" ${leaf?'':'disabled'}>添加资料</button><button role="menuitem" type="button" data-action="add-node" data-id="${esc(id)}">新增子节点</button><button role="menuitem" type="button" data-action="rename-node" data-id="${esc(id)}">重命名</button><button role="menuitem" type="button" data-action="delete-node" data-id="${esc(id)}" ${leaf&&!used?'':'disabled'}>${used?'删除（有关联资料）':'删除空节点'}</button>`;
    root.append(contextMenu);const rect=contextMenu.getBoundingClientRect();contextMenu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';contextMenu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';contextMenu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function openUpload(id){
    flushSave();returnState={state:{...state},selected:new Set(selected),files:[...files],mediaOrder:[...mediaOrder],activeMediaId};
    state={mode:'upload',topicId:state.topicId,nodeId:id,recordId:null};selected=new Set([id]);files=[];mediaOrder=[];activeMediaId=null;
    uploadDialog=document.createElement('dialog');uploadDialog.className='cm-upload-dialog';uploadDialog.innerHTML='<button type="button" class="cm-dialog-close" aria-label="关闭添加资料">×</button><div class="cm-dialog-content"></div>';
    root.append(uploadDialog);paintEditor();uploadDialog.showModal();
    const close=()=>{flushSave();clearTimeout(timer);uploadDialog?.remove();uploadDialog=null;state=returnState.state;selected=returnState.selected;files=returnState.files;mediaOrder=returnState.mediaOrder;activeMediaId=returnState.activeMediaId;returnState=null;renderLibrary();paintTrees(false);};
    uploadDialog.querySelector('.cm-dialog-close').onclick=close;uploadDialog.addEventListener('cancel',e=>{e.preventDefault();close();},{signal:controller.signal});
  }
  function mount(article){
    cleanup();root=article;controller=new AbortController();const opts={signal:controller.signal};state={mode:'preview',topicId:'culture-mosuo'};expanded=new Set(['culture-mosuo']);selected=new Set();files=[];drafts=[];data={...sourceData,records:[...sourceData.records]};fileMap.clear();overrides=read(KEYS.records,{});topics=read(KEYS.topics,INITIAL_TOPICS).map(t=>({...INITIAL_TOPICS.find(seed=>seed.id===t.id),...t}));for(const t of INITIAL_TOPICS)if(!topics.some(x=>x.id===t.id))topics.push(t);
    state.topicId=topics[0]?.id||null;
    const seeds=store?.snapshot.nodes||seedUploadTrees(tags,data);nodes=read(KEYS.trees,seeds).filter(n=>!n.recordId&&n.id!=='tree-entries').map(n=>({...n,label:n.id==='tree-structure'&&n.label==='组合形式'?'资料类型':n.label,recordIds:seeds.find(s=>s.id===n.id)?.recordIds||[]}));for(const seed of seeds)if((seed.recordIds.length||seed.id==='tree-structure'||seed.id==='structure-ensemble')&&!nodes.some(n=>n.id===seed.id))nodes.push(seed);const savedEntryRoot=read(KEYS.trees,[]).find(n=>n.id==='tree-entries');nodes.push(...entryNodes(data,topics).map(n=>n.id==='tree-entries'&&savedEntryRoot?{...n,label:savedEntryRoot.label}:n));
    renderLibrary();paintEditor();
    unsubscribe=store?.subscribe(({origin})=>{if(origin==='editor')return;topics=store.snapshot.topics;overrides=store.snapshot.edits;data={...sourceData,records:[...store.data.records]};nodes=[...store.snapshot.nodes,...entryNodes(data,topics)];renderLibrary();if(state.mode==='preview')paintEditor();});
    const lifecycle=controller;
    readDrafts().then(saved=>{if(lifecycle.signal.aborted)return;drafts=saved;for(const item of saved.filter(d=>d.status==='autosaved'&&d.record)){
      fileMap.set(item.recordId,item.files||[]);if(!data.records.some(r=>r.id===item.recordId))data.records.push(item.record);
    }nodes=nodes.filter(n=>!n.recordId);nodes.push(...entryNodes(data,topics).filter(n=>n.recordId).map(n=>({...n,topicId:overrides[n.recordId]?.topicId||n.topicId})));renderLibrary();}).catch(()=>status('文件存储暂时未能打开。'));
    root.addEventListener('input',event=>{if(event.target.matches('[data-library-search]'))renderLibrary();if(event.target.matches('[data-choice-search]')){const name=event.target.dataset.choiceSearch,query=event.target.value.trim();root.querySelectorAll(`[name="${name}"]`).forEach(input=>input.closest('label').hidden=!input.nextElementSibling.textContent.includes(query));}preview();if(event.target.closest('.cm-topic-form,.cm-upload-form')&&!event.target.matches('[data-choice-search],input[type=file]'))scheduleSave();},opts);
    root.addEventListener('change',event=>{const input=event.target;if(input.name==='files'){accept(input.files);input.value='';}if(['regions','ethnicities'].includes(input.name)){const details=input.closest('details');details.querySelector('summary span').textContent=[...details.querySelectorAll('input:checked')].map(el=>el.nextElementSibling.textContent).join('、')||'选择';scheduleSave();}},opts);
    function accept(incoming){const valid=[...incoming].filter(f=>/\.(png|jpe?g|webp|gif|svg|glb|tres|json|pdf|mp4|webm|mov)$/i.test(f.name)&&f.size<=52428800);files=[...files,...valid].filter((f,i,all)=>all.findIndex(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified)===i);if(valid.length<incoming.length)status('已添加支持的文件，单个文件上限50 MB。');updateFiles();scheduleSave();}
    root.addEventListener('dragstart',event=>{const item=event.target.closest('[data-media-drag]');if(item)event.dataTransfer.setData('text/x-ww-media',item.dataset.mediaDrag);},opts);
    root.addEventListener('dragover',event=>{if(event.target.closest('.mp-file-drop,[data-media-drag]'))event.preventDefault();},opts);root.addEventListener('drop',event=>{const item=event.target.closest('[data-media-drag]'),source=event.dataTransfer.getData('text/x-ww-media');if(item&&source){event.preventDefault();const ids=currentMedia().map(m=>m.id),from=ids.indexOf(source),to=ids.indexOf(item.dataset.mediaDrag);if(from>=0&&to>=0){ids.splice(from,1);ids.splice(to,0,source);mediaOrder=ids;preview();scheduleSave();}return;}if(event.target.closest('.mp-file-drop')){event.preventDefault();accept(event.dataTransfer.files);}},opts);
    root.addEventListener('submit',event=>{if(event.target.matches('.cm-topic-form,.cm-upload-form')){event.preventDefault();flushSave();}},opts);
    window.addEventListener('pagehide',flushSave,opts);
    if(store?.onSave){const off=store.onSave(({ok,error})=>{if(ok&&(timer||fileWrites))return;status(ok?'已保存到项目':('项目保存失败：'+error.message));});controller.signal.addEventListener('abort',off,{once:true});}
    root.addEventListener('contextmenu',event=>{const node=event.target.closest('.cm-node-name');if(!node)return;event.preventDefault();openNodeMenu(node.dataset.id,event.clientX,event.clientY);},opts);
    document.addEventListener('pointerdown',event=>{if(contextMenu&&!contextMenu.contains(event.target)&&!event.target.closest('[data-action=node-menu]')){contextMenu.remove();contextMenu=null;}},opts);
    document.addEventListener('keydown',event=>{if(contextMenu&&event.key==='Escape'){contextMenu.remove();contextMenu=null;}if(contextMenu&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=[...contextMenu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);items[(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}},opts);
    root.addEventListener('click',async event=>{const b=event.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;if(b.disabled)return;if(contextMenu?.contains(b)){contextMenu.remove();contextMenu=null;}try{
      if(action==='topic-preview'){event.preventDefault();previewParams=new URLSearchParams();navigate({mode:'preview',topicId:b.dataset.topic});}
      if(action==='new-topic')navigate({mode:'topic'});
      if(['topic','tags','record'].includes(action))navigate({mode:action,topicId:b.dataset.topic,nodeId:action==='node'?id:b.dataset.nodeId||null,recordId:action==='record'?id:b.dataset.record||null});
      if(action==='media-select'){activeMediaId=id;preview();}
      if(action==='media-prev'||action==='media-next'){const items=currentMedia(),index=items.findIndex(item=>item.id===activeMediaId);activeMediaId=items[index+(action==='media-prev'?-1:1)]?.id||activeMediaId;preview();}
      if(action==='media-up'||action==='media-down'){mediaOrder=moveMedia(currentMedia(),id,action==='media-up'?-1:1);preview();scheduleSave();}
      if(action==='node'){inspectedNodeId=id;paintTrees(false);showNodeRecords(id);}
      if(action==='node-menu'){const rect=b.getBoundingClientRect();openNodeMenu(id,rect.right,rect.bottom);}
      if(action==='upload'){const node=nodes.find(n=>n.id===b.dataset.nodeId);if(node?.parentId&&!visibleNodes().some(n=>n.parentId===node.id))openUpload(node.id);}
      if(action==='select-tag'){if(!nodes.find(n=>n.id===id)?.parentId||visibleNodes().some(n=>n.parentId===id))return;selected.has(id)?selected.delete(id):selected.add(id);paintTrees(true);preview();scheduleSave();}
      if(action==='remove-file'){files.splice(Number(id),1);updateFiles();scheduleSave();}
      if(action==='add-tree'){const input=$('[name=newTreeTitle]'),label=input.value.trim();if(!label)return;if(nodes.some(n=>!n.parentId&&n.label===label&&(!n.topicId||n.topicId===state.topicId))){status('已有同名树。');return;}nodes.push({id:'tree-'+crypto.randomUUID(),label,parentId:null,dimension:'custom',topicId:state.topicId,recordIds:[]});persistNodes();input.value='';paintTrees(false);}
      if(['add-node','rename-node'].includes(action)){
        const node=nodes.find(n=>n.id===id),renaming=action==='rename-node';
        const editor=document.createElement('form');editor.className='cm-inline-editor';
        editor.innerHTML=`<label>${renaming?'节点名称':'新节点名称'}<input required maxlength="60" value="${renaming?esc(node.label):''}"></label>${renaming?'':'<button type="submit">添加</button>'}<button type="button" data-close-inline>${renaming?'完成':'取消'}</button>`;
        $('.cm-inline-editor')?.remove();[...root.querySelectorAll('.cm-node-name')].find(el=>el.dataset.id===id)?.closest('.cu-node-row').after(editor);const input=editor.querySelector('input');input.focus();
        const rename=()=>{const label=input.value.trim();if(!label)return;if(nodes.some(n=>n.id!==id&&n.parentId===node.parentId&&n.label===label)){status('已有同名节点。');return;}const before=node.label;node.label=label;try{persistNodes();const title=editor.previousElementSibling.querySelector('.cm-node-name');if(title)title.textContent=label;status('已更新，正在保存到项目');}catch{node.label=before;status('节点名称保存未完成，请继续编辑重试。');}};
        if(renaming)input.addEventListener('input',rename,{signal:controller.signal});
        editor.querySelector('[data-close-inline]').onclick=()=>{if(renaming)rename();editor.remove();};
        editor.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();if(renaming){rename();editor.remove();return;}const label=input.value.trim();if(!label)return;if(nodes.some(n=>n.parentId===id&&n.label===label)){status('已有同名节点。');return;}nodes.push({id:'tag-'+crypto.randomUUID(),parentId:id,label,dimension:'custom',topicId:node.topicId,recordIds:[]});persistNodes();paintTrees(false);},{signal:controller.signal});
      }
      if(action==='delete-node'){const node=nodes.find(n=>n.id===id);if(!node?.parentId||visibleNodes().some(n=>n.parentId===id))return;drafts=await readDrafts();const usageDrafts=[...drafts,...Object.entries(overrides).map(([recordId,r])=>({id:'edit:'+recordId,recordId,status:'autosaved',assignments:{tagIds:r.tagIds||[]}}))];nodes=removeEmptyNode(nodes,id,usageDrafts);persistNodes();paintTrees(false);status('空节点已删除');}
    }catch(error){status(error.message==='节点已有资料关联'?'节点已有资料关联，已锁定。':'操作暂时未完成，请重试。');}},opts);
  }
  return {render,mount,cleanup};
}
