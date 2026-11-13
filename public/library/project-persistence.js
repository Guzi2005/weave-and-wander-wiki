import {LIBRARY_KEYS} from './library-store.js';
export async function createProjectPersistence({readOnly=false}={}){
 const response=await fetch('/api/library/bootstrap',{cache:'no-store'});if(!response.ok)throw new Error('无法加载项目资料库');const bootstrap=await response.json();
 let state=bootstrap.state||{topics:null,trees:null,records:{},autosaves:[]},queue=Promise.resolve();const dirty=new Map(),fileRefs=new WeakMap(),files=new Map(),listeners=new Set();
 const notify=(ok,error)=>listeners.forEach(fn=>fn({ok,error}));
 async function json(url,options){const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options?.headers}});const result=await response.json();if(!response.ok)throw new Error(result.error||'项目保存失败');return result;}
 const storage={getItem(key){const part=Object.entries(LIBRARY_KEYS).find(([,k])=>k===key)?.[0];return part&&state[part]!=null?JSON.stringify(state[part]):null;},setItem(key,value){if(readOnly)throw new Error('公开站点仅供阅读');const part=Object.entries(LIBRARY_KEYS).find(([,k])=>k===key)?.[0];if(!part)throw new Error('未知资料库字段');const parsed=JSON.parse(value);state={...state,[part]:parsed};dirty.set(part,parsed);queue=queue.catch(()=>{}).then(async()=>{for(const [field,pending] of [...dirty]){const result=await json('/api/library/state',{method:'PATCH',body:JSON.stringify({part:field,value:pending})});if(dirty.get(field)===pending)dirty.delete(field);state.revision=result.revision;}});queue.then(()=>{if(!dirty.size)notify(true);},error=>notify(false,error));}};
 async function sync(){await queue;state=await json('/api/library/state');return state;}
 async function readFiles(){
  if(readOnly)return [];
  await queue;const result=await json('/api/library/autosaves');return Promise.all((result.items||[]).map(async item=>({...item,record:{...item.record,media:(item.record?.media||[]).filter(m=>!(item.files||[]).some(f=>f.path===m.path))},files:await Promise.all((item.files||[]).map(async meta=>{if(files.has(meta.path))return files.get(meta.path);const response=await fetch(meta.path);if(!response.ok)throw new Error('文件未能读取');const file=new File([await response.blob()],meta.name,{type:meta.type,lastModified:meta.lastModified});fileRefs.set(file,meta);files.set(meta.path,file);return file;}))})));
 }
 async function saveFiles(payload){
  if(readOnly)throw new Error('公开站点仅供阅读');await queue;
  const metas=[];for(const file of payload.files||[]){let meta=fileRefs.get(file);if(!meta){const response=await fetch('/api/library/files?'+new URLSearchParams({name:file.name,lastModified:String(file.lastModified)}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});meta=await response.json();if(!response.ok)throw new Error(meta.error||'上传失败');fileRefs.set(file,meta);files.set(meta.path,file);}metas.push(meta);}
  const saved=await json('/api/library/autosaves',{method:'PUT',body:JSON.stringify({...payload,files:metas})});notify(true);return saved;
 }
 const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('ww-project-persistence-v1'):null;
 if(channel)channel.onmessage=async()=>{try{await sync();window.dispatchEvent(new Event('ww-project-refresh'));}catch{}};
 const broadcast=()=>channel?.postMessage({updated:true});listeners.add(event=>{if(event.ok)broadcast();});
 return {data:bootstrap.data,storage,readFiles,saveFiles,sync,onSave(fn){listeners.add(fn);return()=>listeners.delete(fn);},readOnly,cleanup(){channel?.close();},whenSaved:()=>queue};
}
