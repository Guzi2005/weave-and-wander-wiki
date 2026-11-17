import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {deriveLibrary,LIBRARY_KEYS} from '../public/library/library-store.js';
import {LIBRARY_TAGS} from '../public/library/tag-vocabulary.js';
import {QuizError,FIXED_TOPICS} from '../public/quiz-topics.js';
export async function loadQuizSources(store,publicDir){
 const read=async f=>JSON.parse(await readFile(path.join(publicDir,f),'utf8'));
 const [a,b,provinces]=await Promise.all([read('library/research/ethnic-a.json'),read('library/research/ethnic-b.json'),read('library/research/provinces.json')]);
 const ethnicities=[...a,...b],state=store.libraryState(),base={records:store.exportDump().records,assets:{}};
 const snapshot=deriveLibrary(base,LIBRARY_TAGS,(key,fallback)=>{const part=Object.entries(LIBRARY_KEYS).find(([,k])=>k===key)?.[0];return state[part]??fallback;});
 const tags=[...snapshot.topics.map(t=>({id:t.id,label:t.name,dimension:'topic'})),...provinces.map(p=>({id:p.id,label:p.name,dimension:'region'})),...ethnicities.map(e=>({id:e.id,label:e.name,dimension:'ethnicity'})),...snapshot.nodes.filter(n=>n.dimension!=='group'&&n.dimension!=='record').map(n=>({id:n.id,label:n.label,dimension:n.dimension}))];
 const unique=[...new Map(tags.map(t=>[t.id,t])).values()];
 const records=snapshot.records.map(r=>{
  const topic=snapshot.topics.find(t=>state.records?.[r.id]?.topicId?t.id===state.records[r.id].topicId:t.collections?.includes(r.collection_id));
  const tagIds=new Set(r._tagIds||[]);if(topic)tagIds.add(topic.id);
  // Topic region links are geographical organization only, never infer a person's ethnicity from a region.
  for(const region of topic?.regions||[])tagIds.add(region);
  const culture=r.culture?.text||'';
  for(const e of ethnicities)if(culture===e.name||culture.startsWith(e.name+'（')||culture.startsWith(e.name+' '))tagIds.add(e.id);
  const text=[r.title,r.notes,r.note,...(r.observations||[])].filter(x=>typeof x==='string').join('\n').replace(/<[^>]*>/g,' ').trim().slice(0,16000);
  return{id:r.id,title:r.title,revision:r.revision||1,text,observations:(r.observations||[]).filter(x=>typeof x==='string'),tagIds:[...tagIds],media:(r.media||[]).filter(m=>m&&m.path).map(m=>({path:m.path,role:m.role||'source'}))};
 });
 return{tags:unique,records,fixed:FIXED_TOPICS.map(x=>({...x}))};
}
export function selectSources(catalog,selectedTags){
 if(!Array.isArray(selectedTags)||!selectedTags.length||selectedTags.length>30||selectedTags.some(t=>typeof t!=='string')||new Set(selectedTags).size!==selectedTags.length)throw new QuizError('请选择有效且不重复的资料库标签');
 const groups=new Map();for(const id of selectedTags){const t=catalog.tags.find(t=>t.id===id);if(!t)throw new QuizError('选择了已不存在的标签');if(!groups.has(t.dimension))groups.set(t.dimension,[]);groups.get(t.dimension).push(id);}
 if((groups.get('ethnicity')||[]).length>6)throw new QuizError('民族标签一次最多选择 6 个');
 return catalog.records.filter(r=>[...groups.values()].every(ids=>ids.some(id=>r.tagIds.includes(id))));
}
export function evidenceUnits(records){
 return [...new Set(records.flatMap(r=>r.text.split(/[\n。！？；]/).map(s=>s.trim()).filter(s=>s.length>=18)))];
}
export function requireEvidence(records,{fixed=false}={}){
 if(!records.length)throw new QuizError(fixed?'当前资料库中该专题的有效档案不足以生成完整题库，请补充资料后重试。':'当前标签组合下暂无相关档案，无法生成题目。',422,'NO_RECORDS');
 if(evidenceUnits(records).length<5||records.reduce((n,r)=>n+r.text.length,0)<300)throw new QuizError(fixed?'当前资料库中该专题的有效档案不足以生成完整题库，请补充资料后重试。':'当前资料不足以生成完整的五道题，请尝试调整标签组合。',422,'INSUFFICIENT_EVIDENCE');
 return records;
}
