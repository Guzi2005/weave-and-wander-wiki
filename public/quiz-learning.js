import {createQuizChallenge} from './quiz-challenge.js';
import {createLearningStore,topicKey} from './quiz-learning-store.js';
import {toChallengeBank,validateTopic} from './quiz-topics.js';
const $=(tag,attrs={},children=[])=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else if(k==='disabled')e.disabled=!!v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,String(v));}e.append(...children);return e;};
const date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未挑战';
export function createQuizLearning({container,onOpenRecord,storage=localStorage,fetchImpl=fetch}){
 const root=$('section',{class:'ww-quiz-challenge','aria-label':'服饰文化知识闯关'}),content=$('div',{class:'wwq-content'}),notice=$('p',{class:'wwq-learning-notice',role:'status','aria-live':'polite'});
 root.append(content,notice);container.append(root);
 let destroyed=false,bootstrap=null,store=null,child=null,currentAttempt=null,selectedTags=[],busy=false,revision=0;
 const requests=new Set(),downloads=new Set();
 function message(text){notice.textContent=text;}
 const button=(text,fn,{disabled=false,kind=''}={})=>$('button',{type:'button',class:'wwq-button '+kind,text,disabled,onclick:()=>{try{Promise.resolve(fn()).catch(e=>message(e.message));}catch(e){message(e.message);}}});
 const actions=items=>$('div',{class:'wwq-actions'},items);
 function heading(title,description=''){const h=$('h2',{class:'wwq-heading',tabindex:'-1',text:title});content.append(h);if(description)content.append($('p',{class:'wwq-intro',text:description}));h.focus({preventScroll:true});}
 async function request(path,options={}){
  const controller=new AbortController();requests.add(controller);
  try{const r=await fetchImpl(path,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options.headers}});let data;try{data=await r.json();}catch{throw new Error('服务响应格式无效，请重试');}if(!r.ok)throw new Error(data.error||'请求失败');return data;}finally{requests.delete(controller);}
 }
 function endAttempt(){if(currentAttempt){const id=currentAttempt;currentAttempt=null;store.finish(id,'abandoned');}}
 function clear(){revision++;endAttempt();child?.destroy();child=null;content.replaceChildren();message('');}
 function label(id){return bootstrap.tags.find(t=>t.id===id)?.label||id;}
 function summaryText(t){const s=store.summary(topicKey(t));return '历史最佳 '+s.bestAccuracy+'% · 挑战 '+s.attemptCount+' 次 · 最近 '+date(s.lastAttemptAt);}
 function card(topic,definition,index){
  const key=topic&&topicKey(topic),s=key&&store.summary(key),unlocked=store.unlocked(definition.id),prepared=!!topic,latest=definition.topic,updateAvailable=prepared&&latest&&latest.version>topic.version;
  return $('article',{class:'wwq-stage-card'+(!unlocked?' is-locked':''),'data-complete':String(!!s?.passed)},[
   $('div',{class:'wwq-card-top'},[$('span',{class:'wwq-stage-number',text:String(index+1).padStart(2,'0')}),$('span',{class:'wwq-badge'+(s?.passed?' is-complete':''),text:!prepared?'准备中':s.passed?'✓ 已完成':unlocked?'已解锁':'未解锁'})]),
   $('h3',{text:definition.title}),$('p',{text:definition.description||topic?.description||'从真实服饰档案出发。'}),
   $('p',{class:'wwq-meta',text:prepared?'5 道普通题 · '+definition.passRate+'% 通过':'资料与题库正在准备，校验通过后开放。'}),
   ...(prepared?[$('p',{class:'wwq-meta',text:summaryText(topic)})]:[]),
   ...(updateAvailable?[$('p',{class:'wwq-note',text:'新版 '+latest.version+' 已修订题意与中文选项。旧版题目和历史完整保留。'}),button('切换至新版题库（保留旧记录）',()=>{clear();store.switchFixedVersion(topic.id,topicKey(latest));home();message('已切换至版本 '+latest.version+'，旧版历史可在专题详情中查看。');})]:[]),
   button(!prepared?'准备中':!unlocked?'完成前一专题后解锁':s.attemptCount?'查看专题与记录':'开始挑战',()=>openTopic(key),{disabled:!unlocked||!prepared})
  ]);
 }
 function exportRecords(){const url=URL.createObjectURL(new Blob([store.exportData()],{type:'application/json'}));downloads.add(url);const a=$('a',{href:url,download:'ww-learning-records.json'});root.append(a);a.click();a.remove();URL.revokeObjectURL(url);downloads.delete(url);}
 function home(){if(destroyed)return;clear();heading(bootstrap.title,'两个固定服饰文化专题，循序解锁。题目以资料库为依据；个人记录仅保存在本浏览器，可随时导出备份。');
  content.append(actions([button('导出个人学习记录 JSON',exportRecords),button('导入个人记录',importRecords),button('刷新正式题库状态',refresh),button('固定题库管理',admin)]));
  const grid=$('div',{class:'wwq-stage-grid'});
  bootstrap.fixed.forEach((def,i)=>grid.append(card(store.fixedTopic(def.id),def,i)));
  grid.append($('article',{class:'wwq-stage-card'+(store.unlocked('more')?'':' is-locked')},[$('div',{class:'wwq-card-top'},[$('span',{class:'wwq-stage-number',text:String(bootstrap.fixed.length+1).padStart(2,'0')}),$('span',{class:'wwq-badge',text:store.unlocked('more')?'已解锁':'未解锁'})]),$('h3',{text:'更多挑战'}),$('p',{text:'选择资料库真实标签，生成并永久保存自己的五题专题。'}),$('p',{class:'wwq-meta',text:store.generated().length+' 个个人专题 · 通过前两关后开放'}),button('进入更多挑战',more,{disabled:!store.unlocked('more')})]));
  content.append(grid,$('p',{class:'wwq-footnote',text:'固定题库仅在五道题全部通过程序校验后发布。通关资格永久保留；个人最佳按五道题分别是否曾答对计算，不会被重试的错误答案覆盖。旧样本题库的分数不混入新专题。'}));
 }
 function importRecords(){clear();heading('导入个人学习记录','只合并不覆盖已有版本或历史；格式或冲突校验失败时保持原记录。');const input=$('textarea',{class:'wwq-json',rows:8,'aria-label':'个人记录 JSON'});const file=$('input',{type:'file',accept:'.json,application/json','aria-label':'个人学习记录文件'});file.onchange=async()=>{const f=file.files[0];if(!f)return;if(f.size>20*1024*1024){message('文件过大');return;}input.value=await f.text();};content.append(input,file,actions([button('校验并合并记录',()=>{store.importData(input.value);home();message('已合并个人记录');}),button('返回专题列表',home)]));}
 function openTopic(key){const t=store.topic(key);if(!t)return;const s=store.summary(key);if(!s.attemptCount){play(key);return;}detail(key);}
 function detail(key){clear();const t=store.topic(key),s=store.summary(key);heading(t.title,t.description);content.append($('p',{text:summaryText(t)}),$('p',{text:'版本 '+t.version+' · '+(store.qualified(t.id)||s.passed?'通关资格已永久保留':'尚未通关')+' · '+(t.type==='generated'?'AI 生成、程序校验，非人工审定':'固定公开题库，已程序校验，非人工审定')}));
  content.append($('ol',{class:'wwq-review-list'},t.questions.map((q,i)=>$('li',{},[$('strong',{text:'第 '+(i+1)+' 题 · '+(s.questionBestRecords[q.id]?'曾答对 ✓':'尚未答对')}),$('p',{text:q.question})]))));
  content.append(actions([button('重新挑战',()=>play(key),{kind:'wwq-primary'}),button('返回专题列表',t.type==='generated'?more:home)]));
  const history=$('details',{class:'wwq-history'},[$('summary',{text:'查看历史记录（'+s.attemptCount+' 次）'})]);
  for(const a of [...s.attempts].reverse()){history.append($('article',{class:'wwq-feedback'},[$('h3',{text:date(a.startedAt)+' · '+({completed:'已完成',abandoned:'已退出',interrupted:'刷新中断',active:'进行中'}[a.status])}),$('p',{text:a.correct+'/5 正确 · 本次 '+a.accuracy+'% · '+(a.passed?'通过':'未通过')}),$('p',{text:'开始 '+date(a.startedAt)+' / 结束 '+date(a.finishedAt)}),$('ol',{},a.answers.map(row=>{const q=t.questions.find(q=>q.id===row.questionId);return $('li',{text:q.question+' — 我的答案：'+q.options.find(o=>o.id===row.answer)?.text+' · '+(row.correct?'正确':'错误')});}))]));}content.append(history);
  if(t.type==='fixed'){
   const versions=store.getData().topics.filter(x=>x.id===t.id&&x.type==='fixed').sort((a,b)=>b.version-a.version);
   if(versions.length>1)content.append($('h3',{text:'题库版本与历史'}),actions(versions.map(v=>button('查看版本 '+v.version+' 的题目与记录',()=>detail(topicKey(v))))));
  }
 }
 function play(key){clear();const t=store.topic(key);if(t.type==='fixed'&&t.review.status!=='published')throw new Error('固定题库尚未发布');const host=$('div',{class:'wwq-session'});content.append(actions([button('专题详情与历史',()=>detail(key)),button('返回专题列表',t.type==='generated'?more:home)]),host);
  const available=new Set(bootstrap.availableRecordIds);
  child=createQuizChallenge({container:host,questionBank:toChallengeBank(t),hosted:true,autoStart:true,
   onStart(){endAttempt();currentAttempt=store.start(key).id;},
   onAnswer(q,answer){store.answer(currentAttempt,q.id,answer);},
   onFinish(){store.finish(currentAttempt,'completed');currentAttempt=null;},
   onOpenRecord(id){if(available.has(id))onOpenRecord?.(id);},
   availableRecordIds:available,
   onExit(){detail(key);}
  });
 }
 function more(){if(!store.unlocked('more')){message('请先通过两个固定专题');return;}clear();heading('更多挑战','不同维度采用 AND，同维度采用 OR；民族只能单选。生成需调用硅基流动并消耗账户余额，已有题目不会被替换。');
  content.append(actions([button('返回固定专题',home)]));const form=$('div',{class:'wwq-tag-grid'}),groups=new Map();for(const tag of bootstrap.tags){if(!groups.has(tag.dimension))groups.set(tag.dimension,[]);groups.get(tag.dimension).push(tag);}
  const names={topic:'资料库专题',region:'省级行政区',ethnicity:'民族（只能单选）','object-kind':'对象类别','object-type':'对象类型',feature:'外观与结构',structure:'资料类型','record-type':'档案类型',custom:'自定义标签'};
  for(const [dimension,tags]of groups){const field=$('fieldset',{class:'wwq-tag-group'},[$('legend',{text:names[dimension]||dimension})]),list=$('div',{class:'wwq-tag-list'});
   if(dimension==='ethnicity'){const select=$('select',{'aria-label':'民族（只能单选）'},[$('option',{value:'',text:'不限民族'}),...tags.map(t=>$('option',{value:t.id,text:t.label}))]);select.value=tags.find(t=>selectedTags.includes(t.id))?.id||'';select.onchange=()=>{selectedTags=selectedTags.filter(id=>!tags.some(t=>t.id===id));if(select.value)selectedTags.push(select.value);};list.append(select);}
   else for(const tag of tags){const input=$('input',{type:'checkbox',value:tag.id});input.checked=selectedTags.includes(tag.id);input.onchange=()=>{selectedTags=selectedTags.filter(x=>x!==tag.id);if(input.checked)selectedTags.push(tag.id);};list.append($('label',{},[input,$('span',{text:tag.label})]));}
   field.append(list);form.append(field);
  }
  const duplicate=$('div',{role:'status'});async function generate(force=false){
   if(busy)return;if(!selectedTags.length){message('请选择至少一个资料库标签');return;}
   const duplicates=store.duplicates(selectedTags);if(duplicates.length&&!force){duplicate.replaceChildren($('p',{text:'你已经创建过这个标签组合的专题。'}),actions([...duplicates.map(t=>button('继续挑战已有专题：'+t.title,()=>openTopic(topicKey(t)))),button('重新生成一个独立的新专题',()=>generate(true))]));return;}
   const tags=[...selectedTags],token=revision;busy=true;generateButton.disabled=true;message('正在检索档案并生成五道题，请勿重复提交…');
   try{const t=validateTopic(await request('/api/quiz/generate',{method:'POST',body:JSON.stringify({selectedTags:tags})}));if(destroyed)return;const key=store.register(t);if(token===revision){detail(key);message('新专题已固定保存，尚未开始答题。');}}
   catch(e){if(!destroyed&&token===revision)message(e.message);}finally{busy=false;generateButton.disabled=false;}
  }
  const generateButton=button('根据所选档案生成五题',()=>generate(),{disabled:busy||!bootstrap.ai.configured,kind:'wwq-primary'});
  content.append(form,actions([generateButton]),duplicate);
  if(!bootstrap.ai.configured)content.append($('p',{text:'出题服务尚未配置，现有专题和记录不受影响。'}));
  content.append($('h3',{class:'wwq-section-title',text:'我的动态专题'}),$('div',{class:'wwq-stage-grid'},store.generated().map(t=>{const s=store.summary(topicKey(t));return $('article',{class:'wwq-stage-card'},[$('h3',{text:t.title}),$('p',{text:t.selectedTags.map(label).join(' · ')}),$('p',{text:'5 道题 · '+(s.completed?'已完成':'尚未完成')}),$('p',{class:'wwq-meta',text:summaryText(t)}),button(s.attemptCount?'查看专题':'开始挑战',()=>openTopic(topicKey(t)))]);})));
 }
 async function admin(){clear();heading('固定题库管理','默认读取已发布版本，不会重新生成或覆盖。仅在明确点击“生成新版本”时再次调用模型；五道题全部校验通过后直接发布，无需人工审核。管理员令牌是独立的本机管理凭据，不是模型 API Key。');
  const token=$('input',{type:'password',autocomplete:'off','aria-label':'管理员令牌'}),area=$('div'),credentials=()=>({Authorization:'Bearer '+token.value});
  async function load(){const repo=await request('/api/quiz/admin/drafts',{headers:credentials()});area.replaceChildren(...repo.published.map(t=>$('article',{class:'wwq-feedback'},[$('h3',{text:t.title+' · 版本 '+t.version}),$('p',{text:'五道题 · 程序校验 · '+date(t.createdAt)}),...t.questions.map(q=>$('details',{},[$('summary',{text:q.question}),$('p',{text:'答案 '+q.answer+'；'+q.explanation}),...q.evidence.map(e=>$('p',{text:e.recordId+'：'+e.quote}))]))])));}
  content.append($('label',{class:'wwq-field'},[$('span',{text:'管理员令牌（非 API Key）'}),token]),actions([button('读取正式题库',load),button('验证模型连接',async()=>{await request('/api/quiz/admin/check-model',{method:'POST',headers:credentials(),body:'{}'});message('模型连接可用');}),button('返回专题列表',refresh)]));
  content.append($('div',{class:'wwq-stage-grid'},bootstrap.fixed.map(d=>{const revise=$('input',{type:'checkbox'});return $('article',{class:'wwq-stage-card'},[$('h3',{text:d.title}),$('p',{text:d.issue||'依据该资料库专题出题；校验成功直接开放。'}),$('label',{},[revise,$('span',{text:'明确生成新版本（旧版本及记录保留）'})]),button('生成或读取固定题库',async()=>{if(busy)return;busy=true;message('正在处理固定题库…');try{await request('/api/quiz/admin/generate',{method:'POST',headers:credentials(),body:JSON.stringify({fixedId:d.id,revise:revise.checked})});await load();message('正式题库已就绪，返回列表即可查看。');}finally{busy=false;}})]);})),area);
 }
 async function refresh(){const token=++revision;message('正在读取正式题库与资料标签…');try{const b=await request('/api/quiz/bootstrap');if(destroyed||token!==revision)return;bootstrap=b;if(!store)store=createLearningStore({storage});store.syncFixed(b.fixed);home();}catch(e){if(!destroyed){message('');content.replaceChildren();heading('学习系统暂不可用',e.message==='未知的 API 路径'?'本地预览服务仍在运行旧版后端，请重启服务后再试。':e.message);content.append(button('重试加载',refresh));}}}
 const onStorage=e=>{if(e.key==='ww-quiz-learning-v1'&&!destroyed){message('其他标签页更新了学习记录，请刷新本页后继续，避免覆盖。');}};
 window.addEventListener('storage',onStorage);
 refresh();
 return{getState:()=>store?.getData(),destroy(){if(destroyed)return;try{endAttempt();}catch{}destroyed=true;revision++;child?.destroy();for(const r of requests)r.abort();requests.clear();downloads.forEach(URL.revokeObjectURL);window.removeEventListener('storage',onStorage);root.remove();}};
}
