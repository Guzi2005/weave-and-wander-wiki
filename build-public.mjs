import {loadLibraryAssets} from './lib/library-assets.mjs';
import { readFile, writeFile, mkdir, copyFile, readdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'public');
const output = path.join(root, 'dist-public');
const db = JSON.parse(await readFile(path.join(root, 'data', 'records.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(source, 'assets', 'catalog.json'), 'utf8'));
const PART_SIZE = 20 * 1024 * 1024;

try {
  await rm(output, { recursive: true, force: true });
} catch {}
await mkdir(path.join(output, 'assets', 'models'), { recursive: true });
await copyFile(path.join(source, 'tag-presets.js'), path.join(output, 'tag-presets.js'));
for (const name of ['app.js', 'archive-layout.js', 'bead-physics.js', 'index.html', 'motif-preview.js', 'motif-recipe.js', 'motifs.js', 'node-styles.js', 'player-pages.js', 'questions.js', 'styles.css', 'viewer.js']) {
  await copyFile(path.join(source, name), path.join(output, name));
}
let html = await readFile(path.join(output, 'index.html'), 'utf8');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="ww-public" content="true">');
await writeFile(path.join(output, 'index.html'), html);
for (const folder of ['library', 'vendor', 'assets/guide', 'assets/bench', 'assets/node-styles', 'assets/motifs']) {
  const from = path.join(source, folder);
  const to = path.join(output, folder);
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}
const safeAsset = /^(?:[a-z0-9_-]+-cover\.png|[a-z0-9_-]+-uv\.svg|ww-logo\.jpg|source\.png|ukrainian-source\.jpg)$/i;
for (const name of await readdir(path.join(source, 'assets'))) {
  if (safeAsset.test(name)) await copyFile(path.join(source, 'assets', name), path.join(output, 'assets', name));
}
await copyFile(path.join(source, 'assets', 'catalog.json'), path.join(output, 'assets', 'catalog.json'));

const modelNames = new Set(Object.values(catalog.assets).map(a => a.model).filter(Boolean));
for (const name of ['bench', ...modelNames]) {
  const file = path.join(source, 'assets', 'models', `${name}.glb`);
  const target = path.join(output, 'assets', 'models', `${name}.glb`);
  try {
    const bytes = await readFile(file);
    if (bytes.length <= PART_SIZE) await writeFile(target, bytes);
    else for (let i = 0; i * PART_SIZE < bytes.length; i++)
      await writeFile(`${target}.part${i}`, bytes.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const PUBLIC_SOURCE_MEDIA = new Set(['/assets/source.png', '/assets/ukrainian-source.jpg']);
const publicRecords = db.records.map(r => ({
  id:r.id, title:r.title, record_type:r.record_type, category:r.category,
  status:r.status, parent_id:r.parent_id, collection_id:r.collection_id,
  culture:r.culture, place:r.place, date_text:r.date_text,
  observations:(r.observations || []).filter(x => !/\/(?:assets|media)\//.test(x)),
  source:{author:r.source?.author || null,captured_at:r.source?.captured_at || null,
    place:r.source?.place || null,url:r.source?.url || null,license:r.source?.license || null},
  media:(r.media || []).filter(m => m.role === 'source' && PUBLIC_SOURCE_MEDIA.has(m.path))
    .map(m => ({path:m.path, role:'source', label:m.label, focus:m.focus || {x:50,y:50}})),
  revision:r.revision, created_at:r.created_at, updated_at:r.updated_at,
}));
const publicQuestions = db.questions.filter(q => q.status === 'approved' &&
  q.record_revision === db.records.find(r => r.id === q.record_id)?.revision)
  .map(q => ({id:q.id,record_id:q.record_id,prompt:q.prompt,options:q.options,
    correct_index:q.correct_index,explanation:q.explanation,evidence_note:q.evidence_note,
    game_versions:q.game_versions,status:q.status,needs_review:false}));

const libraryAssets=await loadLibraryAssets(source);
const publishedLibrary={...(db.library||{revision:0,topics:null,trees:null,records:{}}),autosaves:[],records:Object.fromEntries(Object.entries(db.library?.records||{}).filter(([id])=>publicRecords.some(r=>r.id===id)).map(([id,row])=>[id,{...row,note:'',source:{author:row.source?.author||'',url:row.source?.url||''}}]))};
const worker = `const RECORDS=${JSON.stringify(publicRecords)};\nconst QUESTIONS=${JSON.stringify(publicQuestions)};\nconst LIBRARY_ASSETS=${JSON.stringify(libraryAssets)};\nconst LIBRARY_STATE=${JSON.stringify(publishedLibrary)};\n` + `
const summary=r=>({id:r.id,title:r.title,record_type:r.record_type,category:r.category,
 status:r.status,parent_id:r.parent_id,collection_id:r.collection_id,culture:r.culture,
 media:r.media,revision:r.revision,updated_at:r.updated_at});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.hostname==='weave-and-wander-wiki.fluorescentmice.fun'){
   url.hostname='ww-wiki.fluorescentmice.fun';
   return Response.redirect(url.toString(),301);
 }
 if(request.method!=='GET' && request.method!=='HEAD') return json({error:'只读站点'},405);
 if(url.pathname==='/api/library/bootstrap')return json({data:{schema:'ww-library-v1',...LIBRARY_ASSETS,records:RECORDS},state:LIBRARY_STATE});
 if(url.pathname==='/api/library/state')return json(LIBRARY_STATE);
 if(url.pathname==='/api/records'){
   const q=(url.searchParams.get('q')||'').toLowerCase();
   const category=url.searchParams.get('category');
   const status=url.searchParams.get('status');
   const rows=RECORDS.filter(r=>(!category||r.category===category)&&(!status||r.status===status)&&
     (!q||[r.id,r.title,r.culture?.text,r.place,r.collection_id].filter(Boolean).some(v=>String(v).toLowerCase().includes(q))));
   return json({count:rows.length,total:RECORDS.length,records:rows.map(summary)});
 }
 const record=url.pathname.match(/^\\/api\\/records\\/([A-Za-z0-9-]+)$/);
 if(record){const r=RECORDS.find(x=>x.id===record[1]);if(!r)return json({error:'记录不存在'},404);
   return json({record:r,children:RECORDS.filter(x=>x.parent_id===r.id).map(summary),
     parent:r.parent_id?summary(RECORDS.find(x=>x.id===r.parent_id)||{id:r.parent_id,title:'关联记录'}):null});}
 if(url.pathname==='/api/questions'){
   const id=url.searchParams.get('record_id');
   const rows=QUESTIONS.filter(q=>!id||q.record_id===id);
   return json({questions:rows,count:rows.length});
 }
 if(url.pathname.startsWith('/api/'))return json({error:'未知的 API 路径'},404);
 if(/^\\/assets\\/models\\/[A-Za-z0-9_-]+\\.glb$/.test(url.pathname)){
   const first=await env.ASSETS.fetch(new URL(url.pathname+'.part0',url));
   if(first.ok){let index=0,reader=null;
     const stream=new ReadableStream({async pull(controller){
       while(true){if(!reader){const part=await env.ASSETS.fetch(new URL(url.pathname+'.part'+index++,url));
         if(!part.ok){controller.close();return;}reader=part.body.getReader();}
         const {value,done}=await reader.read();if(done){reader=null;continue;}
         controller.enqueue(value);return;}
     }});
     return new Response(request.method==='HEAD'?null:stream,{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
   }
 }
 return env.ASSETS.fetch(request);
}};
`;
await writeFile(path.join(output, '_worker.js'), worker);
await writeFile(path.join(output, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' blob:; media-src 'self' blob:\n`);
console.log(`Public build: ${publicRecords.length} records, ${publicQuestions.length} approved questions, ${modelNames.size} models; curated source images included.`);
