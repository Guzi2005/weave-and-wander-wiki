import {createQuizChallenge} from './quiz-challenge.js';
import {createLearningStore,topicKey} from './quiz-learning-store.js';
import {toChallengeBank,validateTopic} from './quiz-topics.js';
const $=(tag,attrs={},children=[])=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='text')e.textContent=v;else if(k==='innerHTML')e.innerHTML=v;else if(k==='class')e.className=v;else if(k==='disabled')e.disabled=!!v;else if(k==='hidden')e.hidden=!!v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,String(v));}e.append(...children);return e;};
const date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未挑战';
const statusNames={completed:'已完成',abandoned:'已退出',interrupted:'刷新中断',active:'进行中'};
// 「查看相关资料」会跳到资料库详情页；离开前把答题位置存进 sessionStorage，详情页据此提供「返回答题」入口。
export const QUIZ_RETURN_KEY='wwq-return-v1';
const RETURN_TTL=30*60*1000;
function readReturn(){
 try{const raw=sessionStorage.getItem(QUIZ_RETURN_KEY);if(!raw)return null;const s=JSON.parse(raw);
  if(!s||typeof s.topicKey!=='string'||typeof s.stageId!=='string')return null;
  if(Date.now()-(s.at||0)>RETURN_TTL)return null;return s;}
 catch{return null;}
}
function writeReturn(s){try{sessionStorage.setItem(QUIZ_RETURN_KEY,JSON.stringify({...s,at:Date.now()}));}catch{}}
function clearReturn(){try{sessionStorage.removeItem(QUIZ_RETURN_KEY);}catch{}}
export function createQuizLearning({container,onOpenRecord,storage=localStorage,fetchImpl=fetch}){
 const root=$('section',{class:'ww-quiz-challenge','aria-label':'服饰文化知识闯关'}),content=$('div',{class:'wwq-content'}),notice=$('p',{class:'wwq-learning-notice',role:'status','aria-live':'polite'});
 root.append(content,notice);container.append(root);
 let destroyed=false,bootstrap=null,store=null,child=null,currentAttempt=null,selectedTags=[],busy=false,revision=0;
 const requests=new Set(),listeners=new AbortController();
 // 练习模块挂载期间统一收起页脚与浏览历史条（见 styles.css 的 body.wwq-active 规则）。
 document.body.classList.add('wwq-active');
 // 点击搜索框外时收起搜索建议。
 document.addEventListener('click',e=>{if(destroyed)return;const box=content.querySelector('.wwq-suggest');if(box&&!box.hidden){const wrap=box.closest('.wwq-search');if(wrap&&!wrap.contains(e.target))box.hidden=true;}},{signal:listeners.signal});
 function message(text){notice.textContent=text;}
 const button=(text,fn,{disabled=false,kind=''}={})=>$('button',{type:'button',class:'wwq-button '+kind,text,disabled,onclick:()=>{try{Promise.resolve(fn()).catch(e=>message(e.message));}catch(e){message(e.message);}}});
 const actions=items=>$('div',{class:'wwq-actions'},items);
 function heading(title){const h=$('h2',{class:'wwq-heading',tabindex:'-1',text:title});content.append(h);h.focus({preventScroll:true});}
 // 只让答题视图占满一屏：按当前可视高度计算；页脚与历史条在练习期间由 styles.css 收起，不再预留高度。
 function fit(){
  if(destroyed)return;
  const top=root.getBoundingClientRect().top+window.scrollY;
  const landscape=isLandscape();
  const bottom=landscape?10:18;
  const avail=Math.round(window.innerHeight-top-bottom);
  root.style.setProperty('--wwq-h',Math.max(landscape?190:300,avail)+'px');
  root.dataset.compact=avail<(landscape?190:460)?'true':'false';
 }
 function isLandscape(){const w=window.innerWidth,h=window.innerHeight;return w>h&&h<=560&&w>=560&&w<=1000;}
 window.addEventListener('resize',fit,{signal:listeners.signal});
 window.addEventListener('orientationchange',fit,{signal:listeners.signal});
 async function request(path,options={}){
  const controller=new AbortController();requests.add(controller);
  try{const r=await fetchImpl(path,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options.headers}});let data;try{data=await r.json();}catch{throw new Error('服务响应格式无效，请重试');}if(!r.ok)throw new Error(data.error||'请求失败');return data;}finally{requests.delete(controller);}
 }
 function endAttempt(){if(currentAttempt){const id=currentAttempt;currentAttempt=null;store.finish(id,'abandoned');}}
 function clear(){revision++;endAttempt();child?.destroy();child=null;content.replaceChildren();message('');document.body.classList.remove('wwq-playing','wwq-home');}
 function allTopics(){
  const list=bootstrap.fixed.map(def=>({def,topic:store.fixedTopic(def.id)})).filter(x=>x.topic);
  for(const t of store.generated())list.push({def:{id:t.id,title:t.title,passRate:t.passRate},topic:t});
  return list.map(x=>({...x,key:topicKey(x.topic)}));
 }
 function lastTs(key){const s=store.summary(key);const a=s.attempts[s.attempts.length-1];return a?Date.parse(a.startedAt)||0:0;}
 // 继续作答：优先跳到最近有动态且尚未通关的题库；全部通关则回到第一个题库。
 function resumeKey(){
  const list=allTopics().filter(x=>x.topic.type!=='fixed'||store.unlocked(x.topic.id));if(!list.length)return null;
  const unfinished=list.filter(x=>!store.summary(x.key).passed);
  const pool=(unfinished.length?unfinished:list).slice().sort((a,b)=>lastTs(b.key)-lastTs(a.key));
  return pool[0].key;
 }
 function resume(){const key=resumeKey();if(!key){message('题库还是空的，先用「生成题目」创建一个专题吧。');return;}play(key);}
 // 专题封面插画：按题库名称散列取配色与母题，扁平旅行海报风（纯内联 SVG，无外部资源）。
 function topicArt(seed){
  let h=0;for(const c of String(seed))h=(h*31+c.charCodeAt(0))>>>0;
  const palettes=[
   {sky1:'#ffe9cd',sky2:'#ffd6ab',sun:'#f2915a',hillA:'#7ea98b',hillB:'#5e8f73',dot:'#e8703a',b1:'#f2b53a',b2:'#41528f'},
   {sky1:'#d5e9ff',sky2:'#b7d8f4',sun:'#f4c95d',hillA:'#93b3d8',hillB:'#7292bd',dot:'#e88b4a',b1:'#f2b53a',b2:'#e8703a'},
   {sky1:'#efe7ff',sky2:'#dcd0f4',sun:'#f2b53a',hillA:'#9db4a0',hillB:'#77957e',dot:'#c26bd4',b1:'#f2915a',b2:'#7a6b96'}
  ];
  const p=palettes[h%palettes.length],m=h%3;
  const balloon=(x,y,s,c1,c2)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 C-16 -14 -16 -40 0 -46 C16 -40 16 -14 0 0 Z" fill="${c1}"/><path d="M0 -46 C6 -40 6 -14 0 0 C-6 -14 -6 -40 0 -46 Z" fill="${c2}"/><rect x="-7" y="2" width="14" height="9" rx="3" fill="#8a5a3b"/><path d="M-9 -2 L-5 3 M9 -2 L5 3" stroke="#8a5a3b" stroke-width="1.4"/></g>`;
  const tree=(x,y,s,c)=>`<g transform="translate(${x} ${y}) scale(${s})"><rect x="-2" y="-6" width="4" height="12" rx="2" fill="#6b4f3a"/><circle cy="-14" r="10" fill="${c}"/></g>`;
  let motif='';
  if(m===0)motif=`<circle cx="238" cy="86" r="34" fill="${p.sun}"/><circle cx="60" cy="60" r="12" fill="#ffffffaa"/><ellipse cx="118" cy="36" rx="30" ry="9" fill="#ffffff99"/>${balloon(180,74,1,p.b1,p.b2)}${balloon(58,96,.72,p.b2,p.b1)}${tree(40,208,1,p.dot)}${tree(288,212,.85,p.hillA)}`;
  else if(m===1)motif=`<circle cx="250" cy="70" r="30" fill="${p.sun}"/><path d="M28 96 q10 -10 20 0 q10 10 20 0" stroke="#ffffffaa" stroke-width="3" fill="none"/><path d="M212 130 q10 -10 20 0 q10 10 20 0" stroke="#ffffff88" stroke-width="3" fill="none"/>${balloon(120,70,.9,p.b1,p.b2)}${tree(52,206,1,p.dot)}${tree(270,214,.8,p.hillA)}`;
  else motif=`<circle cx="72" cy="64" r="30" fill="${p.sun}"/><ellipse cx="230" cy="52" rx="34" ry="10" fill="#ffffff99"/><ellipse cx="150" cy="88" rx="22" ry="7" fill="#ffffff88"/>${balloon(236,110,.85,p.b1,p.b2)}${balloon(96,120,.6,p.b2,p.b1)}${tree(280,210,.9,p.dot)}`;
  const gid='sk'+(h%9973);
  return `<svg viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky1}"/><stop offset="1" stop-color="${p.sky2}"/></linearGradient></defs><rect width="320" height="220" fill="url(#${gid})"/>${motif}<path d="M0 176 Q80 132 160 168 Q240 204 320 160 L320 220 L0 220 Z" fill="${p.hillA}"/><path d="M0 198 Q90 162 180 192 Q250 214 320 190 L320 220 L0 220 Z" fill="${p.hillB}"/></svg>`;
 }
 // 单题预览标题：从题干提炼精炼短语——去掉资料出处与问句套话，保留核心考点；
 // 没有命中任何已知问法时做一次泛化清扫，再截断兜底。
 function questionBrief(raw){
  let t=String(raw||'').replace(/\s+/g,'').replace(/[？?！!。.]+$/,'');
  t=t.replace(/^(?:根据|按|依据)[该此]档案[中]?，?/,'');
  t=t.replace(/^(?:根据|依据)?《[^》]*》(?:的档案记录)?，?/,'');
  const rules=[
   [/^分件([A-Z]\d+)(?=[^$])/,'$1'],
   [/使用什么配方/,'配方'],
   [/对应哪个模型/,'对应模型'],
   [/的制作决定是什么/,'制作决定'],
   [/的用户说明与画面观察是什么/,'说明与观察'],
   [/.*将母亲称为什么/,'母亲的称呼'],
   [/手持的是什么/,'手持物'],
   [/持续?垂落的是什么/,'垂落物'],
   [/可见什么/,'可见细节'],
   [/穿着什么/,'穿着'],
   [/包含哪种颜色的(.+)$/,'$1颜色'],
   [/具有哪些颜色的(.+)$/,'$1颜色'],
   [/哪种颜色的(.+)$/,'$1颜色'],
   [/具有哪些(.+)$/,'$1'],
   [/的主体颜色是什么/,'主体颜色'],
   [/的底色是什么/,'底色'],
   [/的颜色是什么/,'颜色'],
   [/的规格是什么/,'规格'],
   [/的描述是什么/,'的描述'],
   [/由什么固定/,'固定方式'],
   [/指的是什么/,'的含义'],
   [/是什么/,'']
  ];
  for(const [re,rep] of rules)t=t.replace(re,rep);
  t=t.replace(/^(?:画面中央|原照片中央|关于|这件|该)/,'');
  t=t.replace(/^(.{2,3})中(?=[一-龥]{2,})/,'$1');
  t=t.replace(/佩戴的/,'');
  t=t.replace(/^从/,'');
  t=t.replace(/的(?=(条纹|颜色|配方|底色|描述|规格|制作|组成|流苏))/g,'');
  if(/[什么哪些哪种如何]/.test(t))t=t.replace(/通常|一般|在什么|什么|哪些|哪种|如何/g,'').replace(/^在/,'').replace(/的$/,'');
  if(!t)t='（暂无题干）';
  if(t.length>14)t=t.slice(0,14)+'…';
  return t;
 }
 function destCard(entry){
  const s=store.summary(entry.key),locked=entry.topic.type==='fixed'&&!store.unlocked(entry.topic.id);
  // 卡片外层不再是按钮：主区域负责「进入题库」，右上角「展开」负责预览单题，互不嵌套。
  const card=$('div',{class:'wwq-dest'+(entry.def.cover?' has-photo':'')+(locked?' is-locked':'')});
  const main=$('button',{type:'button',class:'wwq-dest-main','aria-label':(locked?'题库（未解锁）：':'进入题库：')+entry.def.title,disabled:locked,onclick:()=>{try{play(entry.key);}catch(e){message(e.message);}}});
  // 有档案照片就用真实资料图（一张），没有再退回插画。
  main.innerHTML=entry.def.cover
   ?`<img class="wwq-dest-img" src="${entry.def.cover}" alt="" loading="lazy">`
   :topicArt(entry.def.id+entry.def.title);
  main.innerHTML+='<span class="wwq-dest-cap"><strong class="wwq-dest-title"></strong><span class="wwq-dest-sub"></span></span>';
  main.querySelector('.wwq-dest-title').textContent=entry.def.title;
  main.querySelector('.wwq-dest-sub').textContent=locked?'🔒 完成前一专题后解锁':`${entry.topic.questions.length} 道题 · 通关 ${entry.def.passRate}%`+(s.attemptCount?` · 最佳 ${Math.round(s.bestAccuracy)}%`:'');
  card.append(main);
  // 展开预览：底部出现单题小卡片（一屏内放不下时在卡片内部滚动，卡片整体不变大）。
  const questions=locked?[]:(entry.topic.questions||[]);
  if(questions.length){
   const panel=$('div',{class:'wwq-dest-panel',hidden:true,'aria-label':entry.def.title+' 题目预览'});
   // 小卡片标题：优先用题目自带的知识点总结（简短完整），没有再从题干提炼；点击直接进入该题。
   panel.replaceChildren(...questions.map((q,i)=>{
    const point=typeof q.knowledgePoint==='string'&&q.knowledgePoint.trim()?q.knowledgePoint.trim():questionBrief(q.question);
    return $('button',{type:'button',class:'wwq-dest-q','aria-label':'进入第'+(i+1)+'题：'+point,text:(i+1)+'. '+point,onclick:()=>{try{play(entry.key,{stageId:entry.topic.id,index:i,answers:[],attemptId:null});}catch(e){message(e.message);}}});
   }));
   const toggle=$('button',{type:'button',class:'wwq-dest-toggle','aria-expanded':'false','aria-label':'展开题目预览',onclick:()=>{
    const open=panel.hidden;panel.hidden=!open;
    toggle.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'收起题目预览':'展开题目预览');
    card.classList.toggle('is-expanded',open);
    toggle.querySelector('span').textContent=open?'收起':'展开';
   },innerHTML:'<span>展开</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'});
   card.append(panel,toggle);
  }
  return card;
 }
 function renderSuggest(q){
  const box=content.querySelector('.wwq-suggest');if(!box)return;
  const text=q.trim().toLowerCase();
  if(!text){box.hidden=true;box.replaceChildren();return;}
  const hits=allTopics().filter(x=>x.def.title.toLowerCase().includes(text)).slice(0,8);
  box.replaceChildren(...(hits.length?hits.map(x=>button(x.def.title,()=>{box.hidden=true;const inp=content.querySelector('.wwq-search-input');if(inp)inp.value='';openTopic(x.key);},{kind:'wwq-suggest-item'})):[$('p',{class:'wwq-note',text:'没有匹配的题库'})]));
  box.hidden=false;
 }
 function searchJump(){const inp=content.querySelector('.wwq-search-input');if(!inp)return;const text=inp.value.trim().toLowerCase();const hit=text?allTopics().find(x=>x.def.title.toLowerCase().includes(text)):null;if(hit){const box=content.querySelector('.wwq-suggest');if(box)box.hidden=true;inp.value='';openTopic(hit.key);}else message(text?'没有匹配的题库':'请输入要搜索的题库标题');}
 function home(){if(destroyed)return;clear();root.dataset.view='home';document.body.classList.add('wwq-home');
  content.append($('header',{class:'wwq-hero'},[$('h1',{class:'wwq-hero-title',text:bootstrap.title})]));
  const input=$('input',{class:'wwq-search-input',type:'search',placeholder:'搜索题库标题…','aria-label':'搜索题库标题',onkeydown:e=>{if(e.key==='Enter')searchJump();else if(e.key==='Escape'){const box=content.querySelector('.wwq-suggest');if(box)box.hidden=true;}}});
  input.addEventListener('input',()=>renderSuggest(input.value));
  const suggest=$('div',{class:'wwq-suggest',role:'listbox',hidden:true});
  const searchBox=$('div',{class:'wwq-search'},[input,suggest,$('button',{type:'button',class:'wwq-search-btn','aria-label':'搜索',onclick:searchJump,innerHTML:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="#fff" stroke-width="2.4"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>'})]);
  const quickBtn=(label,cls,svg,fn)=>$('button',{type:'button',class:'wwq-quick-btn '+cls,onclick:fn},[$('span',{class:'wwq-quick-ico',innerHTML:svg}),$('span',{class:'wwq-quick-label',text:label})]);
  const quick=$('div',{class:'wwq-quick'},[
   quickBtn('继续作答','is-resume','<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="3" width="21" height="26" rx="6" fill="#6b9bd1"/><path d="M14 10.5v11l9.5-5.5z" fill="#fff"/><circle cx="9.5" cy="24.5" r="6" fill="#3c6ea5"/><path d="M7 24.5l1.9 1.9 3.2-3.6" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',resume),
   quickBtn('生成题目','is-generate','<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3.5" y="7" width="19" height="14" rx="5" fill="#f2a541"/><path d="M8.5 20.5v5.5l6.5-5.5z" fill="#f2a541"/><circle cx="9.5" cy="14" r="1.8" fill="#fff"/><circle cx="13" cy="14" r="1.8" fill="#fff"/><circle cx="16.5" cy="14" r="1.8" fill="#fff"/><rect x="19.5" y="3.5" width="9.5" height="9.5" rx="3.2" fill="#f6c26b"/><path d="M24.2 5.8v5M21.8 8.3h4.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>',()=>more()),
   quickBtn('我的题库','is-library','<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 4h11a2.6 2.6 0 012.6 2.6V29l-8.1-5-8.1 5V6.6A2.6 2.6 0 0113 4z" fill="#a9c79b"/><path d="M8.5 8h11a2.6 2.6 0 012.6 2.6V31l-8.1-5-8.1 5V10.6A2.6 2.6 0 018.5 8z" fill="#5e8f73"/><path d="M10.5 12.5h7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',()=>library()),
   quickBtn('编辑题目','is-edit','<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4.5" y="4.5" width="17" height="23" rx="5" fill="#b08ad2"/><path d="M21.5 4.5h3A2.9 2.9 0 0127.4 7.4V28l-5.9-4.2z" fill="#8f6cc0"/><path d="M10.8 21.9l1.2-3.9 7.3-7.3 2.7 2.7-7.3 7.3z" fill="#fff"/><path d="M19.3 10.7l2.7 2.7" stroke="#b08ad2" stroke-width="1.4" stroke-linecap="round"/></svg>',()=>edit())
  ]);
  const cards=$('div',{class:'wwq-dest-row'});
  const entries=allTopics();
  content.append(searchBox,quick,$('h2',{class:'wwq-subheading',text:'当前题库'}));
  if(entries.length)cards.append(...entries.map(destCard));else cards.append($('p',{class:'wwq-note',text:'题库为空，先用「生成题目」创建一个专题。'}));
  content.append(cards);fit();
 }
 function library(){if(destroyed)return;clear();root.dataset.view='library';heading('我的题库');
  content.append(actions([button('返回首页',home)]));
  const list=$('div',{class:'wwq-topic-list'});
  const entries=allTopics();
  if(!entries.length)list.append($('p',{class:'wwq-note',text:'题库为空，先用「生成题目」创建一个专题。'}));
  for(const x of entries){const s=store.summary(x.key);
   list.append($('article',{class:'wwq-topic'},[$('div',{},[$('h3',{text:x.def.title}),$('p',{class:'wwq-note',text:s.attemptCount?`已挑战 ${s.attemptCount} 次 · 最佳 ${Math.round(s.bestAccuracy)}%${s.passed?' · 已通关':''}`:'尚未挑战'})]),button(s.attemptCount?'查看':'开始',()=>openTopic(x.key))]));
  }
  content.append(list);fit();
 }
 function openTopic(key){const t=key?store.topic(key):null;if(!t)return;if(t.type==='fixed'&&!store.unlocked(t.id)){message('完成前一专题后解锁');return;}if(!store.summary(key).attemptCount){play(key);return;}detail(key);}
 // —— 编辑题目：编辑/覆盖/另存新题，以及新建题目与新题库。改动通过 store 的版本化方法落地。——
 function edit(){
  clear();root.dataset.view='edit';heading('编辑题目');
  const entries=allTopics();
  if(!entries.length){content.append($('p',{class:'wwq-note',text:'题库为空，先用「生成题目」创建一个专题。'}),actions([button('返回首页',home)]));fit();return;}
  const titles=bootstrap.recordTitles||{};
  const recordPairs=bootstrap.availableRecordIds.map(id=>[id,titles[id]||id]);
  const state={mode:'edit',key:entries[0].key,qid:null,record:''};
  // 统一选择行组件：卡片式行 + 右端三角按钮展开全部选项；searchable 时支持输入关键词过滤。
  function searchSelect(pairs,value,change,{searchable=true,placeholder='输入关键词筛选'}={}){
   const wrap=$('div',{class:'wwq-edit-select'});
   const inp=$('input',{class:'wwq-edit-select-input',type:'text',placeholder:searchable?placeholder:'',autocomplete:'off'});
   if(!searchable){inp.readOnly=true;inp.tabIndex=-1;}
   const caret=$('button',{type:'button',class:'wwq-edit-caret','aria-label':'展开选项'},[$('span',{class:'wwq-caret-tri','aria-hidden':'true'})]);
   const list=$('div',{class:'wwq-edit-select-list',hidden:true});
   const sync=()=>{const cur=pairs.find(p=>p[0]===value);inp.value=cur?cur[1]:'';};
   const render=q=>{const query=(q||'').trim().toLowerCase();const rows=searchable?pairs.filter(([v,t])=>!query||t.toLowerCase().includes(query)||String(v).toLowerCase().includes(query)):pairs;
    list.replaceChildren(...(rows.length?rows.map(([v,t])=>$('button',{type:'button',class:'wwq-edit-select-opt'+(v===value?' is-active':''),text:t,onclick:e=>{e.stopPropagation();value=v;sync();close();inp.classList.remove('is-invalid');wrap.classList.remove('is-invalid');change(v);}})):$('p',{class:'wwq-note',text:'无匹配选项'})));};
   const open=()=>{render(searchable?inp.value:'');list.hidden=false;wrap.classList.add('is-open');};
   const close=()=>{list.hidden=true;sync();wrap.classList.remove('is-open');};
   inp.addEventListener('focus',()=>{if(searchable)open();});
   inp.addEventListener('input',()=>{render(inp.value);list.hidden=false;});
   inp.addEventListener('blur',()=>setTimeout(close,150));
   caret.addEventListener('mousedown',e=>e.preventDefault());
   caret.addEventListener('click',e=>{e.stopPropagation();list.hidden?open():close();});
   wrap.addEventListener('click',()=>{if(list.hidden)open();});
   wrap.append(inp,caret,list);sync();
   return{root:wrap,get value(){return value;},set invalid(b){wrap.classList.toggle('is-invalid',b);}};
  }
  const field=(label,control)=>$('label',{class:'wwq-edit-field'},[$('span',{class:'wwq-edit-label',text:label}),control.root||control]);
  const modeSel=searchSelect([['edit','编辑现有题目'],['new','新建题目'],['create','新建题库']],state.mode,v=>{state.mode=v;draw();},{searchable:false});
  const topicSel=searchSelect(entries.map(x=>[x.key,x.def.title]),state.key,v=>{state.key=v;state.qid=null;draw();});
  const titleInput=$('input',{class:'wwq-edit-input',type:'text',placeholder:'新题库名称，如：苗族银饰','aria-label':'新题库名称'});
  const form=$('div',{class:'wwq-edit-form'});
  function buildQuestion(inputs){
   const question=inputs.question.value.trim(),opts=inputs.options.map((inp,i)=>({id:'ABCD'[i],text:inp.value.trim()})).filter(o=>o.text);
   const explanation=inputs.explanation.value.trim(),recordId=inputs.record;
   if(!question)throw new Error('请填写题干');
   if(opts.length<2)throw new Error('至少填写两个选项');
   if(!opts.some(o=>o.id===inputs.answer.value))throw new Error('正确答案必须是已填写的选项');
   if(!explanation)throw new Error('请填写解析');
   return{id:'',type:'single',question,options:opts,answer:inputs.answer.value,explanation,hint:'',sourceRecordIds:[recordId],evidence:[{recordId,quote:explanation.slice(0,300)||'人工编辑题目'}],knowledgePoint:''};
  }
  function confirmOverwrite(q){
   const dlg=$('dialog',{class:'wwq-edit-dialog','aria-label':'是否覆盖当前题目'},[
    $('p',{class:'wwq-edit-dialog-title',text:'是否覆盖当前题目？'}),
    $('p',{class:'wwq-note',text:'选择「覆盖此题」将替换原题并生成题库新版本；选择「另存为新题」则保留原题，把编辑内容追加为新题目。'}),
    actions([button('覆盖此题',()=>{try{store.replaceQuestion(state.key,state.qid,q);dlg.close();home();message('已覆盖，题库已更新为新版本。');}catch(e){message(e.message);}}),
     button('另存为新题',()=>{try{store.addQuestion(state.key,q);dlg.close();home();message('已新建一道题并加入题库。');}catch(e){message(e.message);}}),
     button('取消',()=>dlg.close(),{kind:'wwq-quiet'})])]);
   root.append(dlg);dlg.showModal();
  }
  function draw(){
   const t=store.topic(state.key),questions=t?.questions||[];
   if(!state.qid||!questions.some(q=>q.id===state.qid))state.qid=questions[0]?.id||null;
   form.replaceChildren();
   form.append(field('操作',modeSel));
   if(state.mode==='create')form.append(field('新题库名称',titleInput));
   else form.append(field('选择题库',topicSel));
   if(state.mode==='edit'){
    if(!questions.length)form.append($('p',{class:'wwq-note',text:'该题库暂无题目，可切换「新建题目」添加。'}));
    else form.append(field('选择题目',searchSelect(questions.map((q,i)=>[q.id,(i+1)+'. '+q.question.slice(0,30)]),state.qid,v=>{state.qid=v;draw();})));
   }
   const initial=state.mode==='edit'&&state.qid?questions.find(q=>q.id===state.qid):null;
   state.record=initial?.sourceRecordIds?.[0]||'';
   const questionInput=$('textarea',{class:'wwq-edit-input',rows:2,'aria-label':'题干',placeholder:'题干，如：摩梭人的传统服饰中，百褶裙象征什么？'});questionInput.value=initial?.question||'';
   const optionInputs=[0,1,2,3].map(i=>{const inp=$('input',{class:'wwq-edit-input',type:'text','aria-label':'选项 '+'ABCD'[i],placeholder:'选项 '+'ABCD'[i]});inp.value=initial?.options?.[i]?.text||'';return inp;});
   const answerSel=searchSelect(['A','B','C','D'].map(id=>[id,'选项 '+id]),initial?.answer||'A',()=>{},{searchable:false});
   const explanationInput=$('textarea',{class:'wwq-edit-input',rows:3,'aria-label':'解析',placeholder:'解析：说明正确答案的依据，会展示在答题结算面板中。'});explanationInput.value=initial?.explanation||'';
   const recordSel=searchSelect(recordPairs,state.record,v=>{state.record=v;});
   for(const el of [questionInput,...optionInputs,explanationInput,titleInput])el.addEventListener('input',()=>el.classList.remove('is-invalid'));
   form.append(field('题干',questionInput),
    ...optionInputs.map((inp,i)=>field('选项 '+'ABCD'[i],inp)),
    field('正确答案',answerSel),
    field('解析',explanationInput),
    field('关联资料',recordSel));
   form.append(actions([
    button(state.mode==='edit'?'确认修改':state.mode==='new'?'确认新建题目':'创建题库',()=>{
     const bad=[];
     const check=(el,name)=>{const empty=!el.value.trim();el.classList.toggle('is-invalid',empty);if(empty)bad.push(name);};
     check(questionInput,'题干');check(optionInputs[0],'选项 A');check(optionInputs[1],'选项 B');check(explanationInput,'解析');
     if(state.mode==='create')check(titleInput,'新题库名称');
     const noRecord=!state.record;recordSel.invalid=noRecord;if(noRecord)bad.push('关联资料');
     if(bad.length){message('请先填写：'+bad.join('、')+'，填写完整后才能继续。');return;}
     try{
      const q=buildQuestion({question:questionInput,options:optionInputs,answer:answerSel,explanation:explanationInput,record:state.record});
      if(state.mode==='edit'){if(!state.qid){message('该题库暂无可编辑的题目');return;}confirmOverwrite(q);}
      else if(state.mode==='new'){store.addQuestion(state.key,q);home();message('新题目已加入「'+t.title+'」。');}
      else{store.createTopic({title:titleInput.value,question:q});home();message('新题库已创建，可在「当前题库」中查看。');}
     }catch(e){message(e.message);}
    },{kind:'wwq-primary'}),
    button('返回首页',home,{kind:'wwq-quiet'})]));
   fit();
  }
  content.append(form);draw();
 }
 function detail(key){
  clear();root.dataset.view='detail';const t=store.topic(key);if(!t){home();return;}const s=store.summary(key);
  heading(t.title);
  const history=$('div',{class:'wwq-history',hidden:true});
  const toggle=button('查看历史记录',()=>{const open=history.hidden;history.hidden=!open;toggle.textContent=open?'收起历史记录':'查看历史记录';});
  content.append(actions([button('重新挑战',()=>play(key),{kind:'wwq-primary'}),button('返回专题列表',t.type==='generated'?more:home),toggle]));
  for(const a of [...s.attempts].reverse()){
   const item=$('div',{class:'wwq-attempt'},[$('div',{class:'wwq-attempt-head'},[$('span',{text:date(a.startedAt)}),$('span',{text:a.correct+'/5 · 正确率 '+Math.round(a.accuracy)+'% · '+(statusNames[a.status]||a.status)})])]);
   if(a.answers.length)item.append($('ol',{class:'wwq-attempt-answers'},a.answers.map(row=>{const q=t.questions.find(q=>q.id===row.questionId);return $('li',{text:(q?q.question:'')+' — '+(q?.options.find(o=>o.id===row.answer)?.text||'未作答')+' · '+(row.correct?'正确':'错误')});})));
   history.append(item);
  }
  content.append(history);fit();
 }
 function play(key,resume=null){
  clear();const t=store.topic(key);if(!t){home();return;}
  if(t.type==='fixed'&&t.review.status!=='published')throw new Error('固定题库尚未发布');
  // 主动重新开始时丢掉上次「查看相关资料」留下的续答位置；带 resume 时用完即清。
  if(!resume)clearReturn();
  root.dataset.view='play';document.body.classList.add('wwq-playing');const host=$('div',{class:'wwq-session'});content.append(host);fit();
  const available=new Set(bootstrap.availableRecordIds);
  // 续答恢复：优先把离开前的进行中尝试恢复为 active；尝试不存在（如换浏览器）时
  // 带种子答案新开一个尝试，保证提交时 store 与状态机位置一致，否则会报「本次挑战已结束」。
  if(resume){endAttempt();currentAttempt=store.revive(resume.attemptId)?resume.attemptId:store.start(key,resume.answers).id;}
  child=createQuizChallenge({container:host,questionBank:toChallengeBank(t),hosted:true,autoStart:true,resume,
   onStart(){endAttempt();currentAttempt=store.start(key).id;},
   onAnswer(q,answer){store.answer(currentAttempt,q.id,answer);},
   onFinish(){store.finish(currentAttempt,'completed');currentAttempt=null;clearReturn();},
   onOpenRecord(id){
    // 记录当前题号、作答轨迹与尝试 id，资料详情页据此显示「返回答题」。
    const state=child?.getState(),attempt=state?.attempt;
    if(available.has(id)&&attempt)writeReturn({topicKey:key,stageId:attempt.stageId,index:attempt.index,attemptId:currentAttempt,answers:attempt.answers.map(a=>({questionId:a.questionId,answer:a.answer}))});
    if(available.has(id))onOpenRecord?.(id);
   },
   availableRecordIds:available,
   onExit(){clearReturn();home();}
  });
 }
 function more(){clear();root.dataset.view='more';heading('生成题目');
  const groups=new Map();for(const tag of bootstrap.tags){if(!groups.has(tag.dimension))groups.set(tag.dimension,[]);groups.get(tag.dimension).push(tag);}
  // 只保留省级行政区与民族两类标签，民族与省份一样多选，并支持按名称搜索。
  const names={region:'省级行政区',ethnicity:'民族'};
  const searchInput=$('input',{class:'wwq-search-input wwq-gen-input',type:'search',placeholder:'搜索省份或民族…','aria-label':'搜索省份或民族'});
  const form=$('div',{class:'wwq-tag-grid'});
  function drawForm(){
   const term=searchInput.value.trim().toLowerCase();form.replaceChildren();
   for(const dimension of ['region','ethnicity']){
    const tags=(groups.get(dimension)||[]).filter(t=>!term||t.label.toLowerCase().includes(term));
    if(!tags.length)continue;
    const list=$('div',{class:'wwq-tag-list'});
    for(const tag of tags){const input=$('input',{type:'checkbox',value:tag.id});input.checked=selectedTags.includes(tag.id);input.onchange=()=>{selectedTags=selectedTags.filter(x=>x!==tag.id);if(input.checked)selectedTags.push(tag.id);};list.append($('label',{},[input,$('span',{text:tag.label})]));}
    form.append($('fieldset',{class:'wwq-tag-group'},[$('legend',{text:names[dimension]}),list]));
   }
   if(!form.children.length)form.append($('p',{class:'wwq-note',text:'没有匹配的省份或民族'}));
  }
  searchInput.addEventListener('input',drawForm);drawForm();
  const duplicate=$('div',{role:'status'});async function generate(force=false){
   if(busy)return;if(!selectedTags.length){message('请选择至少一个资料库标签');return;}
   const duplicates=store.duplicates(selectedTags);if(duplicates.length&&!force){duplicate.replaceChildren($('p',{text:'你已经创建过这个标签组合的专题。'}),actions([...duplicates.map(t=>button('继续挑战已有专题：'+t.title,()=>openTopic(topicKey(t)))),button('重新生成一个独立的新专题',()=>generate(true))]));return;}
   const tags=[...selectedTags],token=revision;busy=true;generateButton.disabled=true;message('正在检索档案并生成五道题，请勿重复提交…');
   try{const t=validateTopic(await request('/api/quiz/generate',{method:'POST',body:JSON.stringify({selectedTags:tags})}));if(destroyed)return;const key=store.register(t);if(token===revision){detail(key);message('新专题已固定保存，尚未开始答题。');}}
   catch(e){if(!destroyed&&token===revision)message(e.message);}finally{busy=false;generateButton.disabled=false;}
  }
  const generateButton=button('生成题目',()=>generate(),{disabled:busy||!bootstrap.ai.configured,kind:'wwq-primary'});
  // 返回首页放在生成按钮右侧，节省纵向空间。
  content.append(searchInput,form,actions([generateButton,button('返回首页',home)]),duplicate);
  if(!bootstrap.ai.configured)content.append($('p',{class:'wwq-note',text:'出题服务尚未配置，现有专题和记录不受影响。'}));
  const mine=store.generated();
  if(mine.length)content.append($('h3',{class:'wwq-subheading',text:'我的动态专题'}),$('div',{class:'wwq-topic-list'},mine.map(t=>$('article',{class:'wwq-topic'},[$('h3',{text:t.title}),button(store.summary(topicKey(t)).attemptCount?'查看':'开始',()=>openTopic(topicKey(t)))]))));
  fit();
 }
 async function load(){const token=++revision;message('正在读取正式题库与资料标签…');try{const b=await request('/api/quiz/bootstrap');if(destroyed||token!==revision)return;bootstrap=b;if(!store)store=createLearningStore({storage});store.syncFixed(b.fixed);
  // 从资料详情页「返回答题」回来时，直接回到刚才那一题。
  const pending=readReturn();
  if(pending&&store.topic(pending.topicKey)){clearReturn();try{play(pending.topicKey,pending);return;}catch{}}
  home();}catch(e){if(!destroyed){message('');content.replaceChildren();root.dataset.view='error';heading('学习系统暂不可用');content.append($('p',{class:'wwq-note',text:e.message==='未知的 API 路径'?'本地预览服务仍在运行旧版后端，请重启服务后再试。':e.message}),actions([button('重试加载',load)]));}}}
 const onStorage=e=>{if(e.key==='ww-quiz-learning-v1'&&!destroyed){message('其他标签页更新了学习记录，请刷新本页后继续，避免覆盖。');}};
 window.addEventListener('storage',onStorage);
 load();
 return{getState:()=>store?.getData(),destroy(){if(destroyed)return;try{endAttempt();}catch{}destroyed=true;revision++;child?.destroy();for(const r of requests)r.abort();requests.clear();listeners.abort();window.removeEventListener('storage',onStorage);document.body.classList.remove('wwq-playing','wwq-home','wwq-active');root.remove();}};
}
