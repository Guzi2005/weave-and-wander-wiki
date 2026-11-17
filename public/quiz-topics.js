/** Shared, JSON-only topic contract. AI validation and human publication are separate states. */
export const FIXED_TOPICS = Object.freeze([
 {id:'ukrainian-costume',title:'乌克兰服饰',tagIds:['topic-ukrainian'],order:1,passRate:80},
 {id:'mosuo-culture',title:'摩梭人',tagIds:['culture-mosuo'],order:2,passRate:75}
]);
export class QuizError extends Error {constructor(message,status=422,code='INVALID_QUIZ'){super(message);this.status=status;this.code=code;}}
const fail=m=>{throw new QuizError(m);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const str=(v,n,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(n+'无效');return v.trim();};
export const clone=v=>structuredClone(v);
export const signature=tags=>[...new Set(tags)].sort().join('|');
export function validateTopic(topic){
 if(!plain(topic)||topic.schemaVersion!==1||!['fixed','generated'].includes(topic.type))fail('专题格式无效');
 const id=str(topic.id,'专题ID',120);if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))fail('专题ID无效');
 if(!Number.isSafeInteger(topic.version)||topic.version<1)fail('专题版本无效');
 if(typeof topic.passRate!=='number'||!Number.isFinite(topic.passRate)||topic.passRate<0||topic.passRate>100)fail('通关比例无效');
 if(!Array.isArray(topic.questions)||topic.questions.length<1||topic.questions.length>10)fail('每个专题需要 1–10 道普通题');
 if(!Array.isArray(topic.selectedTags)||topic.selectedTags.some(t=>typeof t!=='string'||t.length>120)||topic.selectedTags.length>50)fail('标签格式无效');
 const seen=new Set(),prompts=new Set();
 const questions=topic.questions.map(q=>{
  if(!plain(q))fail('题目格式无效');const qid=str(q.id,'题目ID',120),prompt=str(q.question,'题干',2000);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(qid)||seen.has(qid)||prompts.has(prompt.replace(/[\s，。？！,.?!]/g,'')))fail('题目ID或题干重复');seen.add(qid);prompts.add(prompt.replace(/[\s，。？！,.?!]/g,''));
  if(!['single','boolean'].includes(q.type))fail('仅支持普通单选题和判断题');
  if(!Array.isArray(q.options)||(q.type==='boolean'?q.options.length!==2:q.options.length<2||q.options.length>4))fail('普通题选项数量无效（单选 2–4 项，判断 2 项）');
  const keys=new Set(),texts=new Set();const options=q.options.map(o=>{
   if(!plain(o))fail('选项无效');const key=str(o.id,'选项ID',1),text=str(o.text,'选项',1000);
   if(!(q.type==='single'?'ABCD':'TF').includes(key)||keys.has(key)||texts.has(text))fail('选项ID或文本重复无效');keys.add(key);texts.add(text);return{id:key,text};
  });
  if(!keys.has(q.answer))fail('正确答案未指向有效选项');
  if(!Array.isArray(q.sourceRecordIds)||!q.sourceRecordIds.length||q.sourceRecordIds.length>10||q.sourceRecordIds.some(x=>typeof x!=='string'||!x||x.length>120))fail('题目缺少档案来源');
  if(!Array.isArray(q.evidence)||!q.evidence.length||q.evidence.length>10)fail('题目缺少原文证据');
  const evidence=q.evidence.map(e=>({recordId:str(e.recordId,'证据档案',120),quote:str(e.quote,'证据原文',2000)}));
  if(evidence.some(e=>!q.sourceRecordIds.includes(e.recordId)))fail('证据与来源不一致');
  return{id:qid,type:q.type,question:prompt,options,answer:q.answer,explanation:str(q.explanation,'解析',4000),hint:typeof q.hint==='string'?q.hint.slice(0,1000):'',sourceRecordIds:[...new Set(q.sourceRecordIds)],evidence,knowledgePoint:str(q.knowledgePoint,'知识点',1000)};
 });
 const points=questions.map(q=>q.knowledgePoint.replace(/[\s，。？！,.?!]/g,''));if(new Set(points).size!==questions.length)fail('不得重复考查相同知识点');
 const time=str(topic.createdAt,'生成时间',80);if(!Number.isFinite(Date.parse(time)))fail('生成时间无效');
 if(!plain(topic.generation)||typeof topic.generation.provider!=='string'||typeof topic.generation.model!=='string'||!topic.generation.model)fail('生成元数据无效');
 const review=topic.review;if(!plain(review)||!['draft','published','validated'].includes(review.status)||typeof review.humanReviewed!=='boolean')fail('审核状态无效');
 if(topic.type==='fixed'&&review.status==='published'&&(!review.humanReviewed&&review.method!=='automatic'||typeof review.reviewer!=='string'||!review.reviewer.trim()||!Number.isFinite(Date.parse(review.reviewedAt))))fail('固定题库发布必须记录校验方式与时间');
 if(topic.type==='generated'&&review.status!=='validated')fail('动态专题必须通过程序校验');
 return{schemaVersion:1,id,title:str(topic.title,'专题名称',200),description:str(topic.description,'专题介绍',2000),type:topic.type,version:topic.version,passRate:topic.passRate,selectedTags:[...new Set(topic.selectedTags)],createdAt:time,questions,generation:clone(topic.generation),review:clone(review),sourceSnapshots:Array.isArray(topic.sourceSnapshots)?clone(topic.sourceSnapshots):[]};
}
export function toChallengeBank(topic){
 const t=validateTopic(topic);
 return{schemaVersion:1,bankId:t.id,title:t.title,description:t.description,stages:[{id:t.id,title:t.title,description:t.description,order:1,passRate:t.passRate}],questions:t.questions.map((q,i)=>({...q,stageId:t.id,order:i+1,source:{type:'archive',recordIds:q.sourceRecordIds,references:[]},generation:{...t.generation,verified:true},review:{status:t.type==='fixed'&&t.review.humanReviewed?'approved':'validated',humanReviewed:t.review.humanReviewed,reviewer:t.review.reviewer||'程序校验（非人工审定）',reviewedAt:t.review.reviewedAt||t.createdAt}}))};
}
