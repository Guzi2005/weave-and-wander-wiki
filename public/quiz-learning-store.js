import {FIXED_TOPICS,validateTopic,signature,clone,QuizError} from './quiz-topics.js';
export const LEARNING_KEY='ww-quiz-learning-v1';
// crypto.randomUUID 只在安全上下文（https/localhost）可用；手机经 http://局域网IP 访问时不存在，
// 这里回退到 crypto.getRandomValues（非安全上下文也可用），再退到 Math.random。
function defaultUuid(){
 try{if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();}catch{}
 const bytes=new Uint8Array(16);
 if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);
 else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);
 bytes[6]=bytes[6]&0x0f|0x40;bytes[8]=bytes[8]&0x3f|0x80;
 const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
const topicKey=t=>t.id+'@'+t.version;
const empty=()=>({schemaVersion:1,topics:[],attempts:[],fixedPins:{}});
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validateLearningData(raw){
 if(!raw||raw.schemaVersion!==1||!Array.isArray(raw.topics)||!Array.isArray(raw.attempts)||!raw.fixedPins||typeof raw.fixedPins!=='object'||Array.isArray(raw.fixedPins))throw new QuizError('个人记录格式或版本无效');
 if(raw.topics.length>500||raw.attempts.length>20000)throw new QuizError('个人记录超过当前容量');
 const topics=raw.topics.map(validateTopic),map=new Map(topics.map(t=>[topicKey(t),t]));if(map.size!==topics.length)throw new QuizError('专题版本重复');
 const ids=new Set();const attempts=raw.attempts.map(a=>{
  if(!a||typeof a.id!=='string'||!/^attempt-[a-zA-Z0-9-]{1,100}$/.test(a.id)||ids.has(a.id)||!time(a.startedAt)||!['active','completed','abandoned','interrupted'].includes(a.status))throw new QuizError('挑战记录无效');ids.add(a.id);
  const t=map.get(a.topicKey);if(!t||!Array.isArray(a.answers)||a.answers.length>t.questions.length)throw new QuizError('挑战记录缺少对应固定题目');
  const used=new Set();const answers=a.answers.map((row,i)=>{const q=t.questions[i];if(!row||row.questionId!==q.id||used.has(q.id)||!time(row.answeredAt))throw new QuizError('历史答案不符合专题快照');used.add(q.id);
   if(row.skipped===true){if(row.answer!=null)throw new QuizError('跳过记录不应包含答案');return{questionId:q.id,answer:null,correct:false,skipped:true,answeredAt:row.answeredAt};}
   if(!q.options.some(o=>o.id===row.answer))throw new QuizError('历史答案不符合专题快照');return{questionId:q.id,answer:row.answer,correct:row.answer===q.answer,answeredAt:row.answeredAt};});
  if(a.status==='completed'&&answers.length!==t.questions.length)throw new QuizError('完成记录答案数量与题库不符');
  if(a.status!=='active'&&!time(a.finishedAt))throw new QuizError('挑战结束时间无效');
  const real=answers.filter(x=>!x.skipped),correct=real.filter(x=>x.correct).length,accuracy=correct/Math.max(1,real.length)*100;
  return{id:a.id,topicKey:a.topicKey,topicId:t.id,version:t.version,startedAt:a.startedAt,finishedAt:a.status==='active'?null:a.finishedAt,status:a.status,answers,correct,accuracy,passed:a.status==='completed'&&accuracy>=t.passRate};
 });
 const fixedPins=Object.create(null);for(const def of FIXED_TOPICS){if(raw.fixedPins[def.id]){const t=map.get(raw.fixedPins[def.id]);if(!t||t.id!==def.id||t.type!=='fixed'||t.review.status!=='published')throw new QuizError('固定题库版本引用无效');fixedPins[def.id]=topicKey(t);}}
 return{schemaVersion:1,topics,attempts,fixedPins};
}
export function createLearningStore({storage=localStorage,clock=()=>new Date().toISOString(),uuid=defaultUuid}={}){
 let data=empty(),persistedRaw=null;
 try{const raw=storage.getItem(LEARNING_KEY);persistedRaw=raw;if(raw)data=validateLearningData(JSON.parse(raw));}catch{throw new QuizError('本浏览器学习记录读取失败。为避免覆盖，已停止写入；请先备份浏览器数据再处理。');}
 function save(next){const validated=validateLearningData(next);const encoded=JSON.stringify(validated);if(storage.getItem(LEARNING_KEY)!==persistedRaw)throw new QuizError('其他标签页已更新学习记录，请刷新后重试；未覆盖任何历史。');try{storage.setItem(LEARNING_KEY,encoded);}catch{throw new QuizError('浏览器未能保存记录（可能容量不足或禁用存储）。本次操作未应用，请先导出已有记录。');}persistedRaw=encoded;data=validated;return clone(data);}
 const update=fn=>{const next=clone(data);const result=fn(next);save(next);return result;};
 // A page reload never overwrites an earlier partial attempt with a new attempt.
 if(data.attempts.some(a=>a.status==='active'))update(d=>d.attempts.forEach(a=>{if(a.status==='active'){a.status='interrupted';a.finishedAt=clock();}}));
 function register(t){const topic=validateTopic(t),key=topicKey(topic),prior=data.topics.find(x=>topicKey(x)===key);if(prior){if(JSON.stringify(prior)!==JSON.stringify(topic))throw new QuizError('同一专题版本的题目不可覆盖');return key;}update(d=>d.topics.push(topic));return key;}
 function syncFixed(rows){let changed=false;const next=clone(data);for(const row of rows){if(!row.topic)continue;const t=validateTopic(row.topic),key=topicKey(t);if(!next.topics.some(x=>topicKey(x)===key)){next.topics.push(t);changed=true;}
  const cur=next.fixedPins[row.id];
  if(!cur){next.fixedPins[row.id]=key;changed=true;}
  else{const curT=next.topics.find(x=>topicKey(x)===cur);
   // 服务器发布更高版本时自动升级固定版本；旧版本上进行中的挑战标记为中断，避免续答到旧题。
   if(curT&&t.version>curT.version){next.fixedPins[row.id]=key;changed=true;for(const a of next.attempts)if(a.topicId===row.id&&a.topicKey===cur&&a.status==='active'){a.status='interrupted';a.finishedAt=clock();}}}}if(changed)save(next);}
 function switchFixedVersion(id,key){const t=data.topics.find(t=>topicKey(t)===key);if(!t||t.id!==id||t.type!=='fixed'||t.review.status!=='published')throw new QuizError('正式题库版本不存在');if(data.attempts.some(a=>a.topicId===id&&a.status==='active'))throw new QuizError('请先结束当前挑战再切换版本');update(d=>{d.fixedPins[id]=key;});}
 const qualified=id=>data.attempts.some(a=>a.topicId===id&&a.passed);
 function summary(key){const t=data.topics.find(t=>topicKey(t)===key);if(!t)throw new QuizError('专题不存在');const attempts=data.attempts.filter(a=>a.topicKey===key),ever=Object.fromEntries(t.questions.map(q=>[q.id,attempts.some(a=>a.answers.some(x=>x.questionId===q.id&&x.correct))]));
  return{attemptCount:attempts.length,lastAttemptAt:attempts.at(-1)?.startedAt||null,bestAccuracy:Object.values(ever).filter(Boolean).length/Math.max(1,t.questions.length)*100,questionBestRecords:ever,passed:attempts.some(a=>a.passed),completed:attempts.some(a=>a.status==='completed'),attempts:clone(attempts)};}
 function fixedTopic(id){return data.topics.find(t=>topicKey(t)===data.fixedPins[id])||null;}
 function unlocked(id){const index=FIXED_TOPICS.findIndex(t=>t.id===id);if(index<0)return id==='more'&&FIXED_TOPICS.every(d=>{return qualified(d.id);});return index===0||FIXED_TOPICS.slice(0,index).every(d=>{return qualified(d.id);});}
 // seed：从「查看相关资料」返回续答时，把离开前已提交的答案按原位补进新尝试（位置不匹配的种子会被丢弃，保证记录始终合法）。
 function start(key,seed){const t=data.topics.find(t=>topicKey(t)===key);if(!t)throw new QuizError('专题不存在');if(t.type==='fixed'&&!unlocked(t.id))throw new QuizError('专题尚未解锁');if(t.type==='generated'&&!unlocked('more')&&t.generation?.provider!=='user')throw new QuizError('请先通过两个固定专题');
  const attempt={id:'attempt-'+uuid(),topicKey:key,startedAt:clock(),finishedAt:null,status:'active',answers:[]};
  for(const s of Array.isArray(seed)?seed:[]){const q=t.questions[attempt.answers.length];if(s&&typeof s.questionId==='string'&&typeof s.answer==='string'&&q&&q.id===s.questionId&&q.options.some(o=>o.id===s.answer))attempt.answers.push({questionId:s.questionId,answer:s.answer,answeredAt:clock()});}
  update(d=>d.attempts.push(attempt));return clone(data.attempts.at(-1));}
 // 续答恢复：页面路由切换会重建 store（active 会被标记 interrupted），显式把该尝试恢复为进行中；找不到或已结束则返回 false。
 function revive(id){if(typeof id!=='string')return false;let ok=false;update(d=>{const a=d.attempts.find(a=>a.id===id);if(!a||!['active','interrupted'].includes(a.status))return;a.status='active';a.finishedAt=null;ok=true;});return ok;}
 function answer(attemptId,questionId,value){update(d=>{const a=d.attempts.find(a=>a.id===attemptId);if(!a||a.status!=='active')throw new QuizError('本次挑战已结束');const t=d.topics.find(t=>topicKey(t)===a.topicKey),idx=t?t.questions.findIndex(q=>q.id===questionId):-1;if(idx<0||idx<a.answers.length)throw new QuizError('重复提交或答案无效');const q=t.questions[idx];if(!q.options.some(o=>o.id===value))throw new QuizError('重复提交或答案无效');for(let k=a.answers.length;k<idx;k++)a.answers.push({questionId:t.questions[k].id,answer:null,skipped:true,answeredAt:clock()});a.answers.push({questionId,answer:value,answeredAt:clock()});});}
 function finish(id,status='completed'){update(d=>{const a=d.attempts.find(a=>a.id===id);if(!a||a.status!=='active')return;if(!['completed','abandoned'].includes(status))throw new QuizError('结束状态无效');const t=d.topics.find(t=>topicKey(t)===a.topicKey);if(status==='completed'&&a.answers.length!==(t?.questions.length??5))throw new QuizError('尚未答完全部题目');a.status=status;a.finishedAt=clock();});}
 function importData(json){if(typeof json!=='string'||json.length>20*1024*1024)throw new QuizError('个人记录文件过大');let incoming;try{incoming=validateLearningData(JSON.parse(json));}catch(e){throw new QuizError('个人记录导入失败：'+e.message);}
  update(d=>{for(const t of incoming.topics){const prior=d.topics.find(x=>topicKey(x)===topicKey(t));if(prior&&JSON.stringify(prior)!==JSON.stringify(t))throw new QuizError('专题版本冲突，未导入');if(!prior)d.topics.push(t);}for(const a of incoming.attempts){const prior=d.attempts.find(x=>x.id===a.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(a))throw new QuizError('历史记录冲突，未导入');if(!prior)d.attempts.push(a);}for(const [id,key]of Object.entries(incoming.fixedPins))if(!d.fixedPins[id])d.fixedPins[id]=key;});}
 // —— 编辑题目：所有改动都通过「版本 +1 的新专题」落地，旧版本与历史挑战记录保持不变 ——
 // fixed 专题同时把固定题库指针切到新版本（与 switchFixedVersion 同一语义）。
 function commitTopic(next){const key=topicKey(next);update(d=>{const i=d.topics.findIndex(x=>topicKey(x)===key);if(i>=0)d.topics[i]=next;else d.topics.push(next);if(next.type==='fixed')d.fixedPins[next.id]=key;});return key;}
 function bumped(t){const next=clone(t);next.version=Math.max(0,...data.topics.filter(x=>x.id===t.id).map(x=>x.version))+1;next.createdAt=clock();return next;}
 function uniqueQuestionId(questions){let n=questions.length+1;while(questions.some(q=>q.id==='q'+n))n++;return 'q'+n;}
 function replaceQuestion(key,questionId,question){const t=data.topics.find(t=>topicKey(t)===key);if(!t)throw new QuizError('专题不存在');const at=t.questions.findIndex(q=>q.id===questionId);if(at<0)throw new QuizError('题目不存在于该题库');const next=bumped(t);const q=clone(question);q.id=next.questions[at].id;q.knowledgePoint='kp-'+q.id;next.questions[at]=q;return commitTopic(next);}
 function addQuestion(key,question){const t=data.topics.find(t=>topicKey(t)===key);if(!t)throw new QuizError('专题不存在');if(t.questions.length>=10)throw new QuizError('每个题库最多十道题');const next=bumped(t);const q=clone(question);q.id=uniqueQuestionId(next.questions);q.knowledgePoint='kp-'+q.id;next.questions.push(q);return commitTopic(next);}
 function createTopic({title,question}){const now=clock();const t={schemaVersion:1,id:'user-'+defaultUuid().slice(0,8),version:1,title:String(title||'').trim()||'我的新题库',description:'手动编辑创建的服饰文化题库。',type:'generated',passRate:75,selectedTags:[],createdAt:now,questions:[],generation:{provider:'user',model:'手动编辑',generatedAt:now,verified:true},review:{status:'validated',method:'automatic',humanReviewed:false,reviewer:'程序校验',reviewedAt:now},sourceSnapshots:[]};const q=clone(question);q.id='q1';q.knowledgePoint='kp-q1';t.questions=[q];validateTopic(t);return commitTopic(t);}
 // 生成题库按 id 去重，只保留最新版本，避免编辑后旧版本也出现在列表里。
 function latestGenerated(){const map=new Map();for(const t of data.topics.filter(t=>t.type==='generated')){const prior=map.get(t.id);if(!prior||t.version>prior.version)map.set(t.id,t);}return clone([...map.values()]);}
 return{getData:()=>clone(data),register,syncFixed,switchFixedVersion,qualified,summary,unlocked,fixedTopic,topic:key=>clone(data.topics.find(t=>topicKey(t)===key)||null),generated:latestGenerated,duplicates:tags=>clone(data.topics.filter(t=>t.type==='generated'&&signature(t.selectedTags)===signature(tags))),start,revive,answer,finish,importData,exportData:()=>JSON.stringify(data,null,2),replaceQuestion,addQuestion,createTopic};
}
export {topicKey};
