import {FIXED_TOPICS,validateTopic,signature,clone,QuizError} from './quiz-topics.js';
export const LEARNING_KEY='ww-quiz-learning-v1';
const topicKey=t=>t.id+'@'+t.version;
const empty=()=>({schemaVersion:1,topics:[],attempts:[],fixedPins:{}});
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validateLearningData(raw){
 if(!raw||raw.schemaVersion!==1||!Array.isArray(raw.topics)||!Array.isArray(raw.attempts)||!raw.fixedPins||typeof raw.fixedPins!=='object'||Array.isArray(raw.fixedPins))throw new QuizError('个人记录格式或版本无效');
 if(raw.topics.length>500||raw.attempts.length>20000)throw new QuizError('个人记录超过当前容量');
 const topics=raw.topics.map(validateTopic),map=new Map(topics.map(t=>[topicKey(t),t]));if(map.size!==topics.length)throw new QuizError('专题版本重复');
 const ids=new Set();const attempts=raw.attempts.map(a=>{
  if(!a||typeof a.id!=='string'||!/^attempt-[a-zA-Z0-9-]{1,100}$/.test(a.id)||ids.has(a.id)||!time(a.startedAt)||!['active','completed','abandoned','interrupted'].includes(a.status))throw new QuizError('挑战记录无效');ids.add(a.id);
  const t=map.get(a.topicKey);if(!t||!Array.isArray(a.answers)||a.answers.length>5)throw new QuizError('挑战记录缺少对应固定题目');
  const used=new Set();const answers=a.answers.map((row,i)=>{const q=t.questions[i];if(!row||row.questionId!==q.id||used.has(q.id)||!q.options.some(o=>o.id===row.answer)||!time(row.answeredAt))throw new QuizError('历史答案不符合专题快照');used.add(q.id);return{questionId:q.id,answer:row.answer,correct:row.answer===q.answer,answeredAt:row.answeredAt};});
  if(a.status==='completed'&&answers.length!==5)throw new QuizError('完成记录必须包含五个答案');
  if(a.status!=='active'&&!time(a.finishedAt))throw new QuizError('挑战结束时间无效');
  const correct=answers.filter(x=>x.correct).length,accuracy=correct/5*100;
  return{id:a.id,topicKey:a.topicKey,topicId:t.id,version:t.version,startedAt:a.startedAt,finishedAt:a.status==='active'?null:a.finishedAt,status:a.status,answers,correct,accuracy,passed:a.status==='completed'&&accuracy>=t.passRate};
 });
 const fixedPins=Object.create(null);for(const def of FIXED_TOPICS){if(raw.fixedPins[def.id]){const t=map.get(raw.fixedPins[def.id]);if(!t||t.id!==def.id||t.type!=='fixed'||t.review.status!=='published')throw new QuizError('固定题库版本引用无效');fixedPins[def.id]=topicKey(t);}}
 return{schemaVersion:1,topics,attempts,fixedPins};
}
export function createLearningStore({storage=localStorage,clock=()=>new Date().toISOString(),uuid=()=>crypto.randomUUID()}={}){
 let data=empty(),persistedRaw=null;
 try{const raw=storage.getItem(LEARNING_KEY);persistedRaw=raw;if(raw)data=validateLearningData(JSON.parse(raw));}catch{throw new QuizError('本浏览器学习记录读取失败。为避免覆盖，已停止写入；请先备份浏览器数据再处理。');}
 function save(next){const validated=validateLearningData(next);const encoded=JSON.stringify(validated);if(storage.getItem(LEARNING_KEY)!==persistedRaw)throw new QuizError('其他标签页已更新学习记录，请刷新后重试；未覆盖任何历史。');try{storage.setItem(LEARNING_KEY,encoded);}catch{throw new QuizError('浏览器未能保存记录（可能容量不足或禁用存储）。本次操作未应用，请先导出已有记录。');}persistedRaw=encoded;data=validated;return clone(data);}
 const update=fn=>{const next=clone(data);const result=fn(next);save(next);return result;};
 // A page reload never overwrites an earlier partial attempt with a new attempt.
 if(data.attempts.some(a=>a.status==='active'))update(d=>d.attempts.forEach(a=>{if(a.status==='active'){a.status='interrupted';a.finishedAt=clock();}}));
 function register(t){const topic=validateTopic(t),key=topicKey(topic),prior=data.topics.find(x=>topicKey(x)===key);if(prior){if(JSON.stringify(prior)!==JSON.stringify(topic))throw new QuizError('同一专题版本的题目不可覆盖');return key;}update(d=>d.topics.push(topic));return key;}
 function syncFixed(rows){let changed=false;const next=clone(data);for(const row of rows){if(!row.topic)continue;const t=validateTopic(row.topic),key=topicKey(t);if(!next.topics.some(x=>topicKey(x)===key)){next.topics.push(t);changed=true;}if(!next.fixedPins[row.id]){next.fixedPins[row.id]=key;changed=true;}}if(changed)save(next);}
 function switchFixedVersion(id,key){const t=data.topics.find(t=>topicKey(t)===key);if(!t||t.id!==id||t.type!=='fixed'||t.review.status!=='published')throw new QuizError('正式题库版本不存在');if(data.attempts.some(a=>a.topicId===id&&a.status==='active'))throw new QuizError('请先结束当前挑战再切换版本');update(d=>{d.fixedPins[id]=key;});}
 const qualified=id=>data.attempts.some(a=>a.topicId===id&&a.passed);
 function summary(key){const t=data.topics.find(t=>topicKey(t)===key);if(!t)throw new QuizError('专题不存在');const attempts=data.attempts.filter(a=>a.topicKey===key),ever=Object.fromEntries(t.questions.map(q=>[q.id,attempts.some(a=>a.answers.some(x=>x.questionId===q.id&&x.correct))]));
  return{attemptCount:attempts.length,lastAttemptAt:attempts.at(-1)?.startedAt||null,bestAccuracy:Object.values(ever).filter(Boolean).length/5*100,questionBestRecords:ever,passed:attempts.some(a=>a.passed),completed:attempts.some(a=>a.status==='completed'),attempts:clone(attempts)};}
 function fixedTopic(id){return data.topics.find(t=>topicKey(t)===data.fixedPins[id])||null;}
 function unlocked(id){const index=FIXED_TOPICS.findIndex(t=>t.id===id);if(index<0)return id==='more'&&FIXED_TOPICS.every(d=>{return qualified(d.id);});return index===0||FIXED_TOPICS.slice(0,index).every(d=>{return qualified(d.id);});}
 function start(key){const t=data.topics.find(t=>topicKey(t)===key);if(!t)throw new QuizError('专题不存在');if(t.type==='fixed'&&!unlocked(t.id))throw new QuizError('专题尚未解锁');if(t.type==='generated'&&!unlocked('more'))throw new QuizError('请先通过两个固定专题');
  const attempt={id:'attempt-'+uuid(),topicKey:key,startedAt:clock(),finishedAt:null,status:'active',answers:[]};update(d=>d.attempts.push(attempt));return clone(data.attempts.at(-1));}
 function answer(attemptId,questionId,value){update(d=>{const a=d.attempts.find(a=>a.id===attemptId);if(!a||a.status!=='active')throw new QuizError('本次挑战已结束');const t=d.topics.find(t=>topicKey(t)===a.topicKey),q=t.questions[a.answers.length];if(!q||q.id!==questionId||!q.options.some(o=>o.id===value))throw new QuizError('重复提交或答案无效');a.answers.push({questionId,answer:value,answeredAt:clock()});});}
 function finish(id,status='completed'){update(d=>{const a=d.attempts.find(a=>a.id===id);if(!a||a.status!=='active')return;if(!['completed','abandoned'].includes(status))throw new QuizError('结束状态无效');if(status==='completed'&&a.answers.length!==5)throw new QuizError('尚未答完五道题');a.status=status;a.finishedAt=clock();});}
 function importData(json){if(typeof json!=='string'||json.length>20*1024*1024)throw new QuizError('个人记录文件过大');let incoming;try{incoming=validateLearningData(JSON.parse(json));}catch(e){throw new QuizError('个人记录导入失败：'+e.message);}
  update(d=>{for(const t of incoming.topics){const prior=d.topics.find(x=>topicKey(x)===topicKey(t));if(prior&&JSON.stringify(prior)!==JSON.stringify(t))throw new QuizError('专题版本冲突，未导入');if(!prior)d.topics.push(t);}for(const a of incoming.attempts){const prior=d.attempts.find(x=>x.id===a.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(a))throw new QuizError('历史记录冲突，未导入');if(!prior)d.attempts.push(a);}for(const [id,key]of Object.entries(incoming.fixedPins))if(!d.fixedPins[id])d.fixedPins[id]=key;});}
 return{getData:()=>clone(data),register,syncFixed,switchFixedVersion,qualified,summary,unlocked,fixedTopic,topic:key=>clone(data.topics.find(t=>topicKey(t)===key)||null),generated:()=>clone(data.topics.filter(t=>t.type==='generated')),duplicates:tags=>clone(data.topics.filter(t=>t.type==='generated'&&signature(t.selectedTags)===signature(tags))),start,answer,finish,importData,exportData:()=>JSON.stringify(data,null,2)};
}
export {topicKey};
