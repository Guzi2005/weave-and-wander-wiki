import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,openSync,readSync,closeSync} from 'node:fs';
import {createAssetItems,assetHref} from '../public/library/asset-preview.js';
const read=file=>JSON.parse(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
import data from './fixtures/library-data.mjs';
const seed=read('seed/records.json');
const items=createAssetItems(data);

test('资料展示引用项目档案，覆盖现有资料形式和套装部件',()=>{
  assert.deepEqual(data.records.map(row=>row.id),seed.records.map(row=>row.id));
  assert.deepEqual(new Set(items.map(row=>row.kind)),new Set(['models','images','drawings','motifs','nodes']));
  assert.equal(new Set(items.map(row=>row.id)).size,items.length);
  assert.equal(items.filter(row=>row.kind==='models'&&row.record.record_type==='ensemble').length,2);
  assert.equal(items.filter(row=>row.kind==='models'&&row.record.parent_id==='WW-MOS-001'&&row.record.record_type==='component').length,3);
  assert.equal(items.filter(row=>row.kind==='nodes').length,6);
});

test('封面图、图纸和配方都解析到项目真实文件',()=>{
  for(const row of items){
    assert.match(row.cover,/^\/assets\//);
    assert.ok(existsSync(new URL('../public'+row.cover,import.meta.url)),row.cover);
    if(row.entry?.recipe)assert.ok(existsSync(new URL('../public'+row.entry.recipe,import.meta.url)));
    assert.ok(assetHref(row.id).startsWith('#/asset/'));
  }
});

test('三维可用状态匹配文件魔数，LFS指针保持模型图展示',()=>{
  let available=0;
  for(const row of Object.values(data.assets)){
    const file=new URL('../public/assets/models/'+row.model+'.glb',import.meta.url);
    const descriptor=openSync(file,'r'),header=Buffer.alloc(4);
    try{readSync(descriptor,header,0,4,0);}finally{closeSync(descriptor);}
    assert.equal(row.modelAvailable,header.toString()==='glTF');
    if(row.modelAvailable)available++;
  }
  assert.ok(available>0);
  assert.equal(data.assets['WW-MOS-001'].modelAvailable,false);
  assert.equal(data.assets['WW-BASIC-006'].modelAvailable,true);
});
