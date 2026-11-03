import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStore} from '../lib/store.mjs';
import {eligibleQuestions} from '../public/player-pages.js';

test('one question pool: adoption does not determine eligibility; drafts and stale excluded',()=>{
 const questions=[{id:'a',status:'approved',game_versions:[]},{id:'b',status:'approved',game_versions:['dev']},{id:'c',status:'draft'},{id:'d',status:'approved',needs_review:true}];
 assert.deepEqual(eligibleQuestions(questions).map(q=>q.id),['a','b']);
});
test('adoption versions persist, deduplicate, survive edits, reject invalid types atomically',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ww-adoption-'));
 try{
  const options={dataFile:path.join(dir,'data.json'),seedFile:new URL('../seed/records.json',import.meta.url)};
  const store=createStore(options);store.load();
  const q=store.listQuestions({})[0];
  const saved=store.patchQuestion(q.id,{game_versions:['dev','dev','v1']});
  assert.deepEqual(saved.game_versions,['dev','v1']);
  const again=createStore(options);again.load();assert.deepEqual(again.getQuestion(q.id).game_versions,['dev','v1']);
  assert.throws(()=>again.patchQuestion(q.id,{game_versions:'v2'}));
  assert.deepEqual(again.getQuestion(q.id).game_versions,['dev','v1']);
  assert.deepEqual(again.patchQuestion(q.id,{explanation:'Updated explanation'}).game_versions,['dev','v1']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
