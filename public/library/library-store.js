import {baseMedia,fileMediaId,orderMedia} from './record-media.js';
import {INITIAL_TOPICS,recordsForTopic} from './library-management.js';
import {seedUploadTrees,expandSelection} from './contribution-trees.js';
export const LIBRARY_KEYS={trees:'ww-contribution-trees-v1',topics:'ww-contribution-topics-v1',records:'ww-contribution-record-edits-v1'};
export const topicRoute=id=>id==='culture-mosuo'?'#/culture/mosuo':'#/culture/'+encodeURIComponent(id);
export const routeTopic=id=>id==='culture:mosuo'?'culture-mosuo':id.startsWith('culture:')?id.slice(8):null;
export function deriveLibrary(base,tags,read,saved=[]){
  const topics=(read(LIBRARY_KEYS.topics,INITIAL_TOPICS)||[]).map(t=>({...INITIAL_TOPICS.find(x=>x.id===t.id),...t}));for(const seed of INITIAL_TOPICS)if(!topics.some(t=>t.id===seed.id))topics.push({...seed});
  const edits=read(LIBRARY_KEYS.records,{}),seeds=seedUploadTrees(tags,base),stored=read(LIBRARY_KEYS.trees,null);
  const nodes=(stored||seeds).filter(n=>!n.recordId&&n.id!=='tree-entries').map(n=>({...n,label:n.id==='tree-structure'&&n.label==='组合形式'?'资料类型':n.label,recordIds:seeds.find(s=>s.id===n.id)?.recordIds||[]}));for(const seed of seeds)if((seed.recordIds.length||seed.id==='tree-structure'||seed.id==='structure-ensemble')&&!nodes.some(n=>n.id===seed.id))nodes.push({...seed});
  const source=[...base.records];for(const item of saved)if(item.status==='autosaved'&&item.record&&!source.some(r=>r.id===item.record.id))source.push(item.record);
  const records=source.map(record=>{const edit=edits[record.id]||{},explicit=Object.hasOwn(edit,'tagIds'),tagIds=expandSelection(nodes,explicit?edit.tagIds.filter(id=>id!=='tree-entries'&&!id.startsWith('entry:')):nodes.filter(n=>n.recordIds.includes(record.id)).map(n=>n.id));if(record.record_type==='ensemble'&&!tagIds.includes('structure-ensemble')){tagIds.push('structure-ensemble','tree-structure');}if((record.collection_id==='mosuo_video_002'||record.record_type==='supplementary')&&!tagIds.includes('type-supplementary-media'))tagIds.push('type-supplementary-media','tree-structure');const category=nodes.find(n=>n.dimension==='object-kind'&&tagIds.includes(n.id))?.label||record.category;return {...record,...edit,category,source:{...record.source,...edit.source},media:[...(record.media||[])],_tagIds:tagIds,_explicitTags:explicit};});
  return {topics,nodes,records,edits};
}
export function createLibraryStore(data,{tags,readFiles,storage=localStorage,eventTarget=window}){
  const base=structuredClone(data),listeners=new Set(),urls=new Map();let saved=[],snapshot;
  const read=(key,fallback)=>{try{return JSON.parse(storage.getItem(key))??fallback;}catch{return fallback;}};
  function refresh(origin='external'){
    snapshot=deriveLibrary(base,tags,read,saved);const activeURLs=new Set();
    for(const item of saved){const record=snapshot.records.find(r=>r.id===item.recordId);if(!record)continue;
      record._files=[];
      for(const [i,file] of (item.files||[]).entries()){
        const key=item.id+':'+file.name+':'+file.size+':'+file.lastModified+':'+i;activeURLs.add(key);
        if(!urls.has(key))urls.set(key,URL.createObjectURL(file));
        record._files.push({id:fileMediaId(file),name:file.name,type:file.type,size:file.size,path:urls.get(key)});
        if(/^image\//.test(file.type)||/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name))record.media.push({path:urls.get(key),role:'source',label:file.name});
      }
    }
    for(const record of snapshot.records){const items=[...baseMedia(record,data.assets[record.id]),...(record._files||[]).filter(file=>/^image\//.test(file.type)||/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)).map(file=>({...file,label:file.name}))];const ordered=orderMedia(items,record.mediaOrder||[]);record._previewCover=ordered[0]?.path;const positions=new Map(ordered.map((item,i)=>[item.path,i]));record.media.sort((a,b)=>(positions.get(a.path)??Infinity)-(positions.get(b.path)??Infinity));}
    for(const [key,url] of urls)if(!activeURLs.has(key)){URL.revokeObjectURL(url);urls.delete(key);}
    data.records.splice(0,data.records.length,...snapshot.records);
    for(const listener of listeners)listener({origin,snapshot});
    return snapshot;
  }
  async function syncFiles(origin='external'){try{saved=await readFiles();refresh(origin);}catch{}}
  const onStorage=e=>{if(Object.values(LIBRARY_KEYS).includes(e.key)||e.key===null)refresh('external');};
  eventTarget.addEventListener('storage',onStorage);
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('ww-library-live-v1'):null;
  if(channel)channel.onmessage=e=>{refresh('external');if(e.data?.files)syncFiles('external');};
  refresh('initial');
  return {
    data,changedExternal(){refresh('external');syncFiles('external');},get snapshot(){return snapshot;},read,
    changed({files=false}={}){refresh('editor');channel?.postMessage({files});if(files)syncFiles('editor');},
    ready:()=>syncFiles('initial'),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    topic(id){return snapshot.topics.find(t=>t.id===id);},
    records(id){return recordsForTopic(data,snapshot.topics,id,snapshot.edits);},
    topicsFor(id){return snapshot.topics.filter(t=>(id.startsWith('ethnic-')?t.ethnicities:t.regions)?.includes(id));},
    labels(record){return snapshot.nodes.filter(n=>record._tagIds?.includes(n.id)&&n.dimension!=='group').map(n=>n.label);},
    cleanup(){channel?.close();eventTarget.removeEventListener('storage',onStorage);urls.forEach(url=>URL.revokeObjectURL(url));listeners.clear();}
  };
}
