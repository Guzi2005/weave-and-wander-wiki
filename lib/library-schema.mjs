export class LibraryError extends Error {}
const fail=message=>{throw new LibraryError(message);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('资料字段类型或长度无效');return value;};
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(value))fail('标识符无效');return value;};
const strings=(value,max=200)=>{if(!Array.isArray(value)||value.length>max)fail('关联列表无效');return [...new Set(value.map(v=>text(v,600,true)))];};
export function validateLibraryPart(part,value){
 if(part==='topics'){
  if(!Array.isArray(value)||value.length>500)fail('专题列表无效');const seen=new Set();return value.map(t=>{if(!plain(t)||seen.has(t.id))fail('专题标识重复或无效');seen.add(id(t.id));const regions=strings(t.regions||[],34),ethnicities=strings(t.ethnicities||[],56);if(regions.some(v=>!/^\d{6}$/.test(v))||ethnicities.some(v=>!/^ethnic-(?:0[1-9]|[1-4]\d|5[0-6])$/.test(v)))fail('地域或民族标识无效');return {id:t.id,name:text(t.name,120,true),note:text(t.note||'',4000),regions,ethnicities,collections:strings(t.collections||[],100)};});
 }
 if(part==='trees'){
  if(!Array.isArray(value)||value.length>3000)fail('标签树无效');const nodes=value.filter(n=>!n.recordId&&n.id!=='tree-entries').map(n=>({id:id(n.id),label:text(n.label,120,true),parentId:n.parentId?id(n.parentId):null,dimension:text(n.dimension||'custom',40,true),...(n.topicId?{topicId:id(n.topicId)}:{}),recordIds:[]}));const ids=new Set(nodes.map(n=>n.id));if(ids.size!==nodes.length)fail('标签标识重复');const byId=new Map(nodes.map(n=>[n.id,n]));for(const node of nodes){let current=node;const seen=new Set();while(current.parentId){if(!ids.has(current.parentId))fail('子节点缺少父节点');if(seen.has(current.id))fail('标签树存在循环');seen.add(current.id);current=byId.get(current.parentId);}}return nodes;
 }
 if(part==='records'){
  if(!plain(value)||Object.keys(value).length>10000)fail('资料编辑列表无效');const result=Object.create(null);for(const [key,row] of Object.entries(value)){id(key);if(!plain(row))fail('资料编辑无效');const source=row.source||{};if(!plain(source))fail('来源无效');const url=text(source.url||'',500);if(url){try{if(!['http:','https:'].includes(new URL(url).protocol))fail('来源网址协议无效');}catch{fail('来源网址无效');}}result[key]={title:text(row.title,120,true),note:text(row.note||'',4000),topicId:id(row.topicId),tagIds:strings(row.tagIds||[],300),mediaOrder:strings(row.mediaOrder||[],100),source:{author:text(source.author||'',500),url}};}return result;
 }
 fail('未知资料库字段');
}
export function assertLibraryDeletion(previous,next,records,edits={},autosaves=[]){
 const remaining=new Set(next.map(n=>n.id));for(const node of previous)if(!remaining.has(node.id)){
  if(!node.parentId||previous.some(child=>child.parentId===node.id))fail('只能删除末端子节点');
  const used=(node.recordIds||[]).some(id=>records.some(r=>r.id===id))||Object.values(edits).some(r=>r.tagIds?.includes(node.id))||autosaves.some(r=>r.assignments?.tagIds?.includes(node.id));if(used)fail('已有资料关联的标签节点不能删除');
 }
}
