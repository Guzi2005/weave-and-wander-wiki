import {test}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';
import{createStore}from'../lib/store.mjs';import{buildServer}from'../server.mjs';
test('quiz HTTP boot, two real library topics, auth and failures preserve archive',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ww-quiz-http-'));let server,calls=0;
 try{
  const store=createStore({dataFile:path.join(dir,'records.json'),seedFile:path.resolve('seed/records.json')});store.load();const before=JSON.stringify(store.exportDump());await writeFile(path.join(dir,'quiz-banks.json'),JSON.stringify({schemaVersion:1,published:[],drafts:[]}));
  server=buildServer(store,{mediaDir:path.join(dir,'media'),quizEnv:{QUIZ_ADMIN_TOKEN:'test-admin'},quizFetch:async()=>{calls++;throw new Error('must not call');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const b=await(await fetch(base+'/api/quiz/bootstrap')).json();assert.deepEqual(b.fixed.map(t=>t.title),['乌克兰服饰','摩梭人']);assert.ok(b.tags.some(t=>t.id==='topic-ukrainian'));assert.equal(b.ai.configured,false);
  assert.equal((await fetch(base+'/api/quiz/admin/drafts')).status,403);
  const request=(p,body,headers={})=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await request('/api/quiz/admin/generate',{fixedId:'ukrainian-costume'})).status,403);
  const missing=await request('/api/quiz/admin/generate',{fixedId:'ukrainian-costume'},{Authorization:'Bearer test-admin'});assert.equal(missing.status,503);assert.match((await missing.json()).error,/DEEPSEEK_API_KEY/);
  const empty=await request('/api/quiz/generate',{selectedTags:['ethnic-01']});assert.equal(empty.status,422);assert.match((await empty.json()).error,/暂无相关档案/);
  assert.equal((await request('/api/quiz/generate',{selectedTags:['topic-ukrainian']},{Origin:'http://other.test'})).status,403);
  assert.equal((await fetch(base+'/api/quiz/admin/drafts',{headers:{Authorization:'Bearer test-admin'}})).status,200);
  assert.equal(calls,0);assert.equal(JSON.stringify(store.exportDump()),before);
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
