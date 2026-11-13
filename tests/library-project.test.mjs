import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {createStore} from '../lib/store.mjs';import {buildServer} from '../server.mjs';
const seed=path.resolve('seed/records.json');
test('project library saves canonical records, taxonomy and uploaded files atomically and survives restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ww-project-'));let server;
 try{
  let store=createStore({dataFile:path.join(dir,'records.json'),seedFile:seed});store.load();server=buildServer(store,{mediaDir:path.join(dir,'media')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,method,body)=>fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const bootstrap=await(await fetch(base+'/api/library/bootstrap')).json();assert.equal(bootstrap.data.records.length,store.count());assert.ok(bootstrap.data.assets['WW-MOS-001-C01']);
  const edit={title:'正式保存测试',note:'项目记录',topicId:'culture-mosuo',tagIds:['object-type-1-1'],source:{author:'测试',url:'https://example.org/source'}};
  let response=await request('/api/library/state','PATCH',{part:'records',value:{'WW-MOS-001-C02':edit}});assert.equal(response.status,200);assert.equal(store.get('WW-MOS-001-C02').record.title,'正式保存测试');assert.equal(store.get('WW-MOS-001-C02').record.notes,'项目记录');
  const malicious=await request('/api/library/state','PATCH',{part:'records',value:{'WW-MOS-001-C02':{...edit,source:{url:'javascript:alert(1)'}}}});assert.equal(malicious.status,422);assert.equal(store.get('WW-MOS-001-C02').record.title,'正式保存测试');
  response=await request('/api/library/state','PATCH',{part:'trees',value:[{id:'a',label:'循环',parentId:'a'}]});assert.equal(response.status,422);
  const vocabulary=JSON.parse(await readFile('public/library/vocabulary.json','utf8'));response=await request('/api/library/state','PATCH',{part:'trees',value:vocabulary.filter(n=>n.id!=='object-type-1-1')});assert.equal(response.status,422);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');response=await fetch(base+'/api/library/files?name=test.png&lastModified=123',{method:'POST',body:png});assert.equal(response.status,201);const file=await response.json();
  response=await request('/api/library/autosaves','PUT',{recordId:'WW-MOS-001-C02',files:[file],record:{parent_id:'WW-MOS-001',category:'服装'}});assert.equal(response.status,200);assert.ok(store.get('WW-MOS-001-C02').record.media.some(m=>m.path===file.path));assert.deepEqual(Buffer.from(await(await fetch(base+file.path)).arrayBuffer()),png);
  response=await fetch(base+'/api/library/state',{method:'PATCH',headers:{Origin:'http://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
  await new Promise(r=>server.close(r));server=null;store=createStore({dataFile:path.join(dir,'records.json'),seedFile:seed});store.load();assert.equal(store.get('WW-MOS-001-C02').record.title,'正式保存测试');assert.equal(store.libraryState().autosaves[0].files[0].path,file.path);
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
