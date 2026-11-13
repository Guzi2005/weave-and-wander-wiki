import {createDefaultQuestionBank,normalizeQuestionBank,importQuestionBank,exportQuestionBank,isPlayableQuestion} from './quiz-question-bank.js';
import {createChallengeState} from './quiz-challenge-state.js';
let instanceNumber=0;
const typeNames={single:'单选题',boolean:'判断题',knowledge:'知识拓展'};
const percent=n=>`${Number(n.toFixed(1))}%`;
function node(tag,attrs={},children=[]){
 const e=document.createElement(tag);
 for(const [k,v] of Object.entries(attrs)){
  if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);
  else if(k==='disabled'||k==='checked')e[k]=!!v;else e.setAttribute(k,String(v));
 }
 e.append(...children.filter(v=>v!==null&&v!==undefined));return e;
}
export function createQuizChallenge({container,questionBank=createDefaultQuestionBank(),onOpenRecord,onProgress,onComplete}={}){
 if(!(container instanceof HTMLElement))throw new Error('需要有效的组件容器');
 let bank=normalizeQuestionBank(questionBank),machine=createChallengeState(bank),destroyed=false,selected=null,editor=null,transitionTimer=null,toastTimer=null,frame=0,completedNotified=false;
 const uid=`wwq-${++instanceNumber}`,events=new AbortController(),timers=new Set(),urls=new Set();
 const root=node('section',{class:'ww-quiz-challenge','aria-label':'服饰文化样本闯关'});
 const canvas=node('canvas',{class:'wwq-particles','aria-hidden':'true'}),content=node('div',{class:'wwq-content'}),toastBox=node('div',{class:'wwq-toast',role:'status','aria-live':'polite',hidden:''});
 root.append(canvas,content,toastBox);container.append(root);
 const later=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);if(!destroyed)fn();},ms);timers.add(t);return t;};
 const cancel=t=>{clearTimeout(t);timers.delete(t);};
 const notify=()=>onProgress?.(machine.getState());
 function toast(message){cancel(toastTimer);toastBox.textContent=message;toastBox.hidden=false;toastTimer=later(()=>{toastBox.hidden=true;},3500);}
 function button(label,fn,{kind='',disabled=false,...attrs}={}){return node('button',{type:'button',class:`wwq-button ${kind}`,disabled,onclick:fn,...attrs,text:label});}
 const eyebrow=text=>node('p',{class:'wwq-eyebrow',text});
 const heading=(text,tag='h2')=>node(tag,{class:'wwq-heading',tabindex:'-1','data-focus':'',text});
 const actions=children=>node('div',{class:'wwq-actions'},children);
 function currentStage(){return bank.stages.find(s=>s.id===machine.getState().attempt?.stageId);}
 function start(id){cancel(transitionTimer);machine.start(id);selected=null;render();notify();transitionTimer=later(()=>{machine.begin();render();},2000);}
 function home(){cancel(transitionTimer);machine.home();selected=null;render();notify();}
 function advance(){
  const q=machine.getQuestion(),s=machine.getState();
  if(q.type==='knowledge'&&s.attempt.answers.length===s.attempt.index)machine.submit(null);
  machine.next();selected=null;render();notify();
  if(machine.getState().allCompleted&&!completedNotified){completedNotified=true;onComplete?.(machine.getState());}
 }
 function submit(){
  if(selected===null)return;machine.submit(selected);render();notify();
 }
 function stagePath(s){
  return node('ol',{class:'wwq-path','aria-label':'关卡进度'},bank.stages.map((stage,i)=>node('li',{'data-complete':String(!!s.completed[stage.id]),'data-current':String(s.attempt?.stageId===stage.id || (!s.attempt && stage.id===s.unlocked.find(id=>!s.completed[id])))},[
   button(String(i+1),()=>start(stage.id),{kind:`wwq-dot ${s.completed[stage.id]?'is-complete':''} ${s.attempt?.stageId===stage.id?'is-current':''}`,disabled:!s.unlocked.includes(stage.id),'aria-label':`${stage.title}，${s.completed[stage.id]?'已完成':s.unlocked.includes(stage.id)?'已解锁':'未解锁'}`}),
   node('span',{text:stage.title})
  ])));
 }
 function stats(items){return node('dl',{class:'wwq-stats'},items.map(([label,value])=>node('div',{},[node('dt',{text:label}),node('dd',{text:String(value)})])));}
 function render(){
  if(destroyed)return;
  const s=machine.getState(),stage=currentStage();
  const top=node('div',{class:'wwq-top'},[node('span',{class:'wwq-wordmark',text:'W&W / 知识漫游'}),button('题库工坊',openEditor,{kind:'wwq-quiet','aria-haspopup':'dialog'})]);
  const body=node('div',{class:`wwq-screen wwq-${s.view}`,'data-outcome':s.attempt?.finished?(s.attempt.passed?'passed':'failed'):'pending'});content.replaceChildren(top,body);
  if(s.view==='home'){
   const upcoming=bank.stages.find(st=>s.unlocked.includes(st.id)&&!s.completed[st.id])||bank.stages[0];
   body.append(node('div',{class:'wwq-hero'},[
    node('div',{class:'wwq-hero-copy'},[eyebrow('CULTURE, ONE STITCH AT A TIME'),heading(bank.title),node('p',{class:'wwq-intro',text:bank.description}),
     actions([button(s.completedCount?'继续漫游 →':'开始挑战 →',()=>start(upcoming.id),{kind:'wwq-primary'}),node('span',{class:'wwq-note',text:'不用赶路，每一次探索都算数。'})])]),
    node('div',{class:'wwq-emblem','aria-hidden':'true'},[node('span',{text:'✳'}),node('small',{text:'一针一线 · 一步一程'})])
   ]));
   body.append(stats([['旅程进度',`${s.completedCount} / ${s.stageCount}`],['累计最佳',`${s.totalScore} 分`],['题目类型','选择 · 判断 · 拓展']]),stagePath(s));
   body.append(node('div',{class:'wwq-section-title'},[node('h3',{text:'选择一段旅程'}),node('span',{text:'循序解锁 · 随时重温'})]));
   body.append(node('div',{class:'wwq-stage-grid'},bank.stages.map((st,i)=>{
    const unlocked=s.unlocked.includes(st.id),done=!!s.completed[st.id],count=bank.questions.filter(q=>q.stageId===st.id&&isPlayableQuestion(q));
    return node('article',{class:`wwq-stage-card ${unlocked?'':'is-locked'}`,'data-complete':String(done)},[
     node('div',{class:'wwq-card-top'},[node('span',{class:'wwq-stage-number',text:String(i+1).padStart(2,'0')}),node('span',{class:`wwq-badge ${done?'is-complete':''}`,text:done?'✓ 已完成':unlocked?'已解锁':'未解锁'})]),
     node('h3',{text:st.title}),node('p',{text:st.description}),node('p',{class:'wwq-meta',text:`${count.length} 题 · ${percent(st.passRate)} 通过${s.best[st.id]?` · 最佳 ${s.best[st.id].score} 分`:''}`}),
     button(done?'重新挑战 ↗':unlocked?'进入关卡 ↗':'完成前一关后解锁',()=>start(st.id),{disabled:!unlocked,kind:'wwq-card-button'})
    ]);
   })));
   body.append(node('p',{class:'wwq-footnote',text:'样本内容已附核查来源，不代表全部服饰文化。当前题库和进度仅保存在本次页面会话中；刷新或离开页面后恢复默认。累计分数为各关历史最佳分之和。'}));
  }else if(s.view==='transition'){
   body.append(node('div',{class:'wwq-transition-panel'},[eyebrow(`第 ${bank.stages.findIndex(x=>x.id===stage.id)+1} 段旅程`),node('div',{class:'wwq-transition-flower','aria-hidden':'true',text:'✳'}),heading(stage.title),node('p',{text:stage.description}),node('p',{class:'wwq-note',text:'准备好了，就一起出发。约 2 秒后开始…'}),button('立即开始',()=>{cancel(transitionTimer);machine.begin();render();}),button('返回关卡列表',home,{kind:'wwq-quiet'})]));
  }else if(s.view==='question'){
   const q=machine.getQuestion(),answered=s.attempt.answers.length>s.attempt.index,result=answered?s.attempt.answers.at(-1):null,knowledge=q.type==='knowledge';
   body.append(node('div',{class:'wwq-question-header'},[button('← 退出挑战',home,{kind:'wwq-quiet'}),node('span',{text:`${stage.title} / 第 ${s.attempt.index+1} 题，共 ${machine.getQuestions().length} 题`}),node('strong',{text:`本次 ${s.summary.score} 分`})]),
    node('progress',{class:'wwq-progress',max:machine.getQuestions().length,value:s.attempt.answers.length,'aria-label':'本关答题进度'}));
   const card=node('article',{class:'wwq-question-card','data-question-type':q.type},[eyebrow(`${typeNames[q.type]}${knowledge?' · 阅读即可，不计分':''}`),heading(q.question,'h3')]);
   if(!knowledge){
    const options=node('div',{class:'wwq-options',role:'group','aria-label':'答案选项'});
    q.options.forEach((o,i)=>options.append(button('',()=>select(o.id),{kind:`wwq-option ${selected===o.id?'is-selected':''} ${answered&&o.id===q.answer?'is-correct':''} ${answered&&selected===o.id&&!result.correct?'is-wrong':''}`,disabled:answered,'aria-pressed':String(selected===o.id),'data-option':o.id,'aria-label':`${q.type==='boolean'?o.id:String.fromCharCode(65+i)}. ${o.text}`})));
    [...options.children].forEach((b,i)=>b.append(node('span',{class:'wwq-option-key',text:q.type==='boolean'?q.options[i].id:String.fromCharCode(65+i)}),node('span',{text:q.options[i].text})));
    card.append(options);
   }
   if(q.hint){const hint=node('details',{class:'wwq-hint'},[node('summary',{text:'✧ 看一点提示'}),node('p',{text:q.hint})]);card.append(hint);}
   if(answered||knowledge){
    const feedback=node('section',{class:`wwq-feedback ${knowledge?'is-knowledge':result.correct?'is-correct':'is-wrong'}`,role:'status'},[
     node('h4',{text:knowledge?'多看一眼，收获一点新知识':result.correct?'✓ 回答正确，线索连起来了！':'再记住一个小线索'}),
     ...(!knowledge&&!result.correct?[node('p',{text:`正确答案：${q.options.find(o=>o.id===q.answer).text}`})]:[]),node('p',{text:q.explanation})
    ]);
    if(q.source.recordIds.length&&onOpenRecord)feedback.append(actions(q.source.recordIds.map(rid=>button('查看相关资料',()=>onOpenRecord(rid),{'aria-label':`查看相关资料 ${rid}`,kind:'wwq-quiet'}))));
    if(q.source.references.length)feedback.append(node('div',{class:'wwq-sources'},q.source.references.map(r=>node('a',{href:r.url,target:'_blank',rel:'noopener noreferrer',text:`来源：${r.title} ↗`}))));
    card.append(feedback);
   }
   card.append(actions([button(answered||knowledge?(s.attempt.index+1===machine.getQuestions().length?'查看本关结果 →':'下一题 →'):'确认答案',answered||knowledge?advance:submit,{kind:'wwq-primary',disabled:!answered&&!knowledge&&selected===null,'data-action':'answer'}),node('span',{class:'wwq-note',text:knowledge?'Enter / Space 继续':q.type==='boolean'?'T / F 选择 · Enter 确认':'1–4 或 A–D 选择 · Enter 确认'})]));body.append(card);
  }else{
   const complete=s.view==='complete',passed=s.attempt.passed;
   body.append(node('div',{class:'wwq-result-panel'},[eyebrow(complete?'THE JOURNEY CONTINUES':passed?'一段旅程，已经点亮':'慢慢来，再走一遍'),node('div',{class:'wwq-result-mark','aria-hidden':'true',text:complete?'✺':passed?'✳':'↻'}),
    heading(complete?'所有关卡，已点亮':passed?`${stage.title} · 挑战成功`:`${stage.title} · 还差一点`),
    node('p',{text:complete?'把今天收集的知识，带到下一次探索里。':`本关要求 ${percent(stage.passRate)}，本次正确率 ${percent(s.summary.accuracy)}。`}),
    stats([['本关得分',`${s.summary.score} 分`],['答对 / 答错',`${s.summary.correct} / ${s.summary.wrong}`],['正确率',percent(s.summary.accuracy)],['累计最佳',`${s.totalScore} 分`]]),
    node('p',{class:'wwq-note',text:`已完成 ${s.completedCount} / ${s.stageCount} 关。本关历史最佳 ${s.best[stage.id]?.score||0} 分；重试不会重复累计。`}),
    actions([button('重新挑战本关',()=>start(stage.id),{kind:'wwq-primary'}),button('返回关卡列表',home,{kind:'wwq-quiet'}),
     ...(complete?[button('再次漫游（从第一关）',()=>start(bank.stages[0].id))]:[]),
     ...(passed&&!complete&&bank.stages[bank.stages.findIndex(x=>x.id===stage.id)+1]?[button('进入下一关 →',()=>start(bank.stages[bank.stages.findIndex(x=>x.id===stage.id)+1].id))]:[])]),
    ...(complete?[stagePath(s),...bank.stages.map(st=>node('p',{class:'wwq-completion-row',text:`✓ ${st.title} · 最佳 ${s.best[st.id]?.score||0} 分`}))]:[])
   ]));
  }
  body.querySelector('[data-focus]')?.focus({preventScroll:true});
 }
 function select(id){
  const s=machine.getState();if(s.view!=='question'||s.attempt.answers.length>s.attempt.index)return;
  selected=id;root.querySelectorAll('[data-option]').forEach(e=>{const active=e.dataset.option===id;e.classList.toggle('is-selected',active);e.setAttribute('aria-pressed',String(active));});
  const answerButton=root.querySelector('[data-action="answer"]');if(answerButton)answerButton.disabled=false;
 }
 function keydown(e){
  if(destroyed||editor||!root.contains(document.activeElement)||e.altKey||e.ctrlKey||e.metaKey||e.repeat)return;
  if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const s=machine.getState();if(s.view!=='question')return;
  const q=machine.getQuestion(),answered=s.attempt.answers.length>s.attempt.index,key=e.key.toUpperCase();
  if(key==='ENTER'||key===' '){
   // Native buttons retain Space activation; Enter/Space on the question heading advances.
   if(e.target.closest('button,a,summary'))return;
   e.preventDefault();if(q.type==='knowledge'||answered)advance();else if(selected!==null)submit();return;
  }
  if(answered||q.type==='knowledge')return;
  const i=q.type==='boolean'?q.options.findIndex(o=>o.id===key):/^[1-4]$/.test(key)?Number(key)-1:'ABCD'.indexOf(key);
  if(i>=0&&i<q.options.length){e.preventDefault();select(q.options[i].id);}
 }
 root.addEventListener('keydown',keydown,{signal:events.signal});
 function setQuestionBank(next){
  if(destroyed)throw new Error('组件已销毁');const valid=normalizeQuestionBank(next),nextMachine=createChallengeState(valid);
  cancel(transitionTimer);bank=valid;machine=nextMachine;selected=null;completedNotified=false;render();notify();
 }
 function reset(){if(destroyed)return;cancel(transitionTimer);machine.reset();completedNotified=false;selected=null;render();notify();}

 function openEditor(){
  if(editor||destroyed)return;
  cancel(transitionTimer);
  const returnFocus=document.activeElement;
  let draft=structuredClone(bank),sid=draft.stages[0].id,qid=draft.questions.find(q=>q.stageId===sid)?.id;
  const dialog=node('dialog',{class:'wwq-editor','aria-labelledby':`${uid}-editor-title`});editor=dialog;
  function close(){dialog.close();dialog.remove();editor=null;if(!destroyed){(returnFocus?.isConnected?returnFocus:content.querySelector('.wwq-top button'))?.focus();if(machine.getState().view==='transition')transitionTimer=later(()=>{machine.begin();render();},2000);}}
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  const head=node('div',{class:'wwq-editor-head'},[node('div',{},[eyebrow('YOUR LITTLE WORKSHOP'),node('h2',{id:`${uid}-editor-title`,text:'题库工坊'})]),button('关闭',close,{'aria-label':'关闭题库工坊',kind:'wwq-quiet'})]);
  const panel=node('div',{class:'wwq-editor-panel'}),message=node('p',{class:'wwq-editor-error',role:'alert'});
  const jsonBox=node('textarea',{class:'wwq-json',rows:6,'aria-label':'题库 JSON',placeholder:'粘贴完整 QuestionBank JSON，点击“导入 JSON”。'});
  const file=node('input',{type:'file',accept:'.json,application/json','aria-label':'选择 JSON 文件'});
  function error(fn){try{message.textContent='';fn();}catch(e){message.textContent=e.message;}}
  function loadDraft(next){draft=normalizeQuestionBank(next);sid=draft.stages[0].id;qid=draft.questions.find(q=>q.stageId===sid)?.id;drawEditor();message.textContent='已载入编辑草稿；点击“应用题库”后生效，游戏进度将重置。';}
  file.addEventListener('change',async()=>{
   const chosen=file.files[0];if(!chosen)return;
   if(chosen.size>5*1024*1024){message.textContent='文件不能超过 5 MB';return;}
   try{const raw=await chosen.text();if(!destroyed&&editor===dialog)loadDraft(importQuestionBank(raw));}catch(e){if(editor===dialog)message.textContent=e.message;}
  });
  function download(){error(()=>{
   const json=exportQuestionBank(draft);jsonBox.value=json;
   const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));urls.add(url);
   const a=node('a',{href:url,download:`${draft.bankId}.json`});dialog.append(a);a.click();a.remove();later(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);
   message.textContent='完整 JSON 已导出，也已显示在文本框中。';
  });}
  const transfer=node('details',{class:'wwq-transfer'},[node('summary',{text:'导入 / 导出完整题库 JSON'}),jsonBox,file,actions([button('导入 JSON',()=>error(()=>loadDraft(importQuestionBank(jsonBox.value)))),button('导出 JSON',download)])]);
  const foot=node('div',{class:'wwq-editor-footer'},[node('p',{text:'仅编辑本次内存题库。应用后重置全部进度；刷新或离开页面恢复默认，不写入服务器。'}),actions([
   button('恢复默认样本',()=>{error(()=>{setQuestionBank(createDefaultQuestionBank());close();toast('已恢复默认样本题库与进度');});}),
   button('取消',close,{kind:'wwq-quiet'}),button('应用题库',()=>error(()=>{setQuestionBank(draft);close();toast('题库已更新，旅程重新开始');}),{kind:'wwq-primary'})])]);
  dialog.append(head,panel,transfer,message,foot);root.append(dialog);drawEditor();dialog.showModal();dialog.querySelector('button')?.focus();
  function field(label,control){return node('label',{class:'wwq-field'},[node('span',{text:label}),control]);}
  function input(value,oninput,{multiline=false,...attrs}={}){
   const e=node(multiline?'textarea':'input',{...(multiline?{rows:3}:{type:'text'}),...attrs});e.value=value??'';e.addEventListener('input',()=>oninput(e.value));return e;
  }
  function selectInput(values,value,change){const e=node('select',{},values.map(([v,t])=>node('option',{value:v,text:t})));e.value=value;e.onchange=()=>change(e.value);return e;}
  function move(items,index,delta){const other=index+delta;if(other<0||other>=items.length)return;[items[index],items[other]]=[items[other],items[index]];items.forEach((x,i)=>x.order=i+1);}
  function unique(prefix,items){let n=1;while(items.some(x=>x.id===`${prefix}-${n}`))n++;return `${prefix}-${n}`;}
  function newQuestion(stageId){const q=structuredClone(createDefaultQuestionBank().questions[0]);q.id=unique('question',draft.questions);q.stageId=stageId;q.order=Math.max(0,...draft.questions.filter(x=>x.stageId===stageId).map(x=>x.order))+1;return q;}
  function markDirty(q){
   q.review.status='draft';q.review.humanReviewed=false;q.generation.verified=false;
   const status=panel.querySelector('[data-review-status]');if(status)status.value='draft';
   panel.querySelectorAll('[data-verification]').forEach(e=>e.checked=false);
  }
  function drawEditor(){
   const stages=[...draft.stages].sort((a,b)=>a.order-b.order),stage=stages.find(s=>s.id===sid)||stages[0];sid=stage.id;
   const qs=draft.questions.filter(q=>q.stageId===sid).sort((a,b)=>a.order-b.order);let q=qs.find(q=>q.id===qid)||qs[0];qid=q?.id;
   const stageSelect=selectInput(stages.map(s=>[s.id,s.title]),sid,v=>{sid=v;qid=null;drawEditor();});
   const stageFields=node('section',{class:'wwq-editor-section'},[
    node('h3',{text:'关卡管理'}),field('选择关卡',stageSelect),
    field('关卡名称',input(stage.title,v=>stage.title=v)),field('关卡介绍',input(stage.description,v=>stage.description=v,{multiline:true})),
    field('通关正确率（0–100）',input(stage.passRate,v=>stage.passRate=v===''?NaN:Number(v),{type:'number',min:0,max:100,step:'any'})),
    actions([button('上移关卡',()=>{move(stages,stages.indexOf(stage),-1);drawEditor();},{disabled:stages.indexOf(stage)===0}),button('下移关卡',()=>{move(stages,stages.indexOf(stage),1);drawEditor();},{disabled:stages.indexOf(stage)===stages.length-1}),
     button('新建关卡',()=>{const s={id:unique('stage',draft.stages),title:'新专题',description:'请填写这个专题的探索内容。',order:Math.max(...stages.map(s=>s.order))+1,passRate:80};draft.stages.push(s);const added=newQuestion(s.id);draft.questions.push(added);sid=s.id;qid=added.id;drawEditor();}),
     button('删除关卡及题目',()=>{draft.stages=draft.stages.filter(s=>s.id!==sid);draft.questions=draft.questions.filter(q=>q.stageId!==sid);sid=draft.stages[0].id;qid=null;drawEditor();},{disabled:stages.length===1,kind:'wwq-danger'})]),
    node('p',{class:'wwq-note',text:`稳定 ID：${stage.id}。新关卡先复制一题来源完整的样本，可再编辑。删除仅影响草稿，取消可放弃。`})
   ]);
   const questionFields=node('section',{class:'wwq-editor-section'},[node('h3',{text:'题目管理'}),
    ...(qs.length?[field('选择题目',selectInput(qs.map((q,i)=>[q.id,`${i+1}. ${q.question.slice(0,45)}`]),qid,v=>{qid=v;drawEditor();}))]:[]),
    actions([button('新建题目',()=>{const added=newQuestion(sid);draft.questions.push(added);qid=added.id;drawEditor();}),
     button('删除题目',()=>{draft.questions=draft.questions.filter(x=>x.id!==qid);qid=null;drawEditor();},{disabled:!q,kind:'wwq-danger'}),
     button('上移题目',()=>{move(qs,qs.indexOf(q),-1);drawEditor();},{disabled:!q||qs.indexOf(q)===0}),button('下移题目',()=>{move(qs,qs.indexOf(q),1);drawEditor();},{disabled:!q||qs.indexOf(q)===qs.length-1})])
   ]);
   if(q){
    questionFields.append(field('题型',selectInput(Object.entries(typeNames),q.type,v=>{
     markDirty(q);q.type=v;q.options=v==='knowledge'?[]:v==='boolean'?[{id:'T',text:'正确'},{id:'F',text:'错误'}]:[{id:'A',text:'选项一'},{id:'B',text:'选项二'}];q.answer=q.options[0]?.id??null;drawEditor();
    })),field('题干',input(q.question,v=>{q.question=v;markDirty(q);},{multiline:true})),
    ...(q.type!=='knowledge'?[field('选项文本（每行一项，2–4 项）',input(q.options.map(o=>o.text).join('\n'),v=>{
     markDirty(q);q.options=v.split('\n').map((t,i)=>({id:q.type==='boolean'?(i===0?'T':'F'):String.fromCharCode(65+i),text:t}));
    },{multiline:true})),field('正确答案 ID（单选 A–D；判断 T/F）',input(q.answer,v=>{q.answer=v.trim().toUpperCase();markDirty(q);}))]:[]),
    field('解析',input(q.explanation,v=>{q.explanation=v;markDirty(q);},{multiline:true})),field('提示（可选）',input(q.hint,v=>{q.hint=v;markDirty(q);},{multiline:true})),
    field('来源档案 ID（逗号分隔，可选）',input(q.source.recordIds.join(', '),v=>{q.source.recordIds=v.split(/[,，]/).map(x=>x.trim()).filter(Boolean);markDirty(q);})),
    field('审核状态',selectInput([['approved','已审定'],['draft','草稿（不进入挑战）'],['rejected','已拒绝（不进入挑战）']],q.review.status,v=>{q.review.status=v;if(v==='approved')q.review.reviewedAt=new Date().toISOString();})),
    field('审核人 / 核查说明',input(q.review.reviewer,v=>q.review.reviewer=v)),
    field('已经核查题目与答案',node('input',{type:'checkbox','data-verification':'',checked:q.generation.verified,onchange:e=>q.generation.verified=e.target.checked})),
    field('已经人工审核',node('input',{type:'checkbox','data-verification':'',checked:q.review.humanReviewed,onchange:e=>q.review.humanReviewed=e.target.checked})),
    node('p',{class:'wwq-note',text:`ID：${q.id} · 生成方：${q.generation.provider}。来源、模型与审核时间完整字段可通过 JSON 编辑；AI 题必须经人工审核。`})
    );
   }
   panel.replaceChildren(stageFields,questionFields);
   const reviewSelect=[...questionFields.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='approved'));
   reviewSelect?.setAttribute('data-review-status','');
  }
 }

 // The canvas is clipped to this root. Stop drawing when hidden or motion is reduced.
 const motion=matchMedia('(prefers-reduced-motion: reduce)'),ctx=canvas.getContext('2d');let width=0,height=0,last=0;
 const particles=Array.from({length:20},()=>({x:Math.random(),y:Math.random(),r:1+Math.random()*2,v:.00001+Math.random()*.000015}));
 function size(){const box=root.getBoundingClientRect();width=box.width;height=Math.min(box.height,1600);const dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;ctx?.setTransform(dpr,0,0,dpr,0,0);}
 function draw(now){
  frame=0;if(destroyed||!ctx||motion.matches||document.hidden)return;
  if(now-last>32){const delta=Math.min(now-last,80);last=now;ctx.clearRect(0,0,width,height);ctx.globalAlpha=.56;ctx.shadowBlur=3;
   particles.forEach((p,i)=>{p.y=(p.y+p.v*delta)%1;ctx.fillStyle=['#E58889','#A8B99B','#B2D990','#E8C78A','#B9A7D8','#F0DFA6'][i%6];ctx.shadowColor=ctx.fillStyle;ctx.beginPath();ctx.arc(p.x*width,p.y*height,p.r,0,Math.PI*2);ctx.fill();});}
  frame=requestAnimationFrame(draw);
 }
 function resume(){cancelAnimationFrame(frame);frame=0;if(!motion.matches&&!document.hidden&&!destroyed&&ctx)frame=requestAnimationFrame(draw);else ctx?.clearRect(0,0,width,height);}
 const resize=new ResizeObserver(size);resize.observe(root);
 motion.addEventListener('change',resume,{signal:events.signal});document.addEventListener('visibilitychange',resume,{signal:events.signal});
 render();size();resume();
 return {getState:()=>machine.getState(),getQuestionBank:()=>structuredClone(bank),setQuestionBank,reset,
  destroy(){if(destroyed)return;destroyed=true;events.abort();timers.forEach(clearTimeout);timers.clear();cancelAnimationFrame(frame);resize.disconnect();
   if(editor){editor.close();editor.remove();editor=null;}urls.forEach(URL.revokeObjectURL);urls.clear();root.remove();}
 };
}
