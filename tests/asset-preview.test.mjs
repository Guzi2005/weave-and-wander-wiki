import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,openSync,readSync,closeSync} from 'node:fs';
import {createAssetItems,createAssetPreview,assetHref} from '../public/library/asset-preview.js';
const read=file=>JSON.parse(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
import data from './fixtures/library-data.mjs';
const seed=read('seed/records.json');
const items=createAssetItems(data);

test('资料展示引用项目档案，覆盖现有资料形式和套装部件',()=>{
  assert.deepEqual(data.records.map(row=>row.id),seed.records.map(row=>row.id));
  assert.deepEqual(new Set(items.map(row=>row.kind)),new Set(['models','images','drawings','recipes','nodes']));
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

test('书目归入资料文件的图鉴画册书架，不进入影像',()=>{
  const book=read('public/library/patterns.json')[0];
  const archive={...data,records:[...data.records,book]};
  const rows=createAssetItems(archive);
  assert.equal(rows.filter(row=>row.record?.id===book.id).length,1);
  assert.equal(rows.find(row=>row.id===book.id)?.kind,'books');
  assert.ok(existsSync(new URL('../public'+rows.find(row=>row.id===book.id).cover,import.meta.url)));
  const preview=createAssetPreview(archive);
  assert.match(preview.render('assets'),/资料文件[\s\S]*图鉴画册[\s\S]*ap-bookshelf/);
  assert.match(preview.render('assets'),/href="#\/asset\/WW-BIB-HQS-2021"/);
  assert.match(preview.render('asset:'+book.id),/中国经典纹样图鉴/);
});

test('纹样正文链接指向现有条目，保留较长名称和原文', () => {
  const records = read('public/library/patterns.json');
  const preview = createAssetPreview({...data, records});
  const example = records.find(record => record.title === '八达晕纹');
  const html = preview.render('asset:' + example.id);
  for (const name of ['龟背纹', '回纹', '锁子纹']) {
    const target = records.find(record => record.title === name);
    assert.ok(html.includes(`<a class="wiki-link" href="${assetHref(target.id)}">${name}</a>`));
    assert.match(preview.render('asset:' + target.id), new RegExp(`<h1>${name}</h1>`));
  }
  const coin = records.find(record => record.title === '钱纹');
  assert.ok(html.includes(`<a class="wiki-link" href="${assetHref(coin.id)}">古钱纹</a>`));
  assert.ok(!html.includes(`<a class="wiki-link" href="${assetHref(example.id)}">`));

  const cloud = records.find(record => record.title === '云纹');
  const cloudThunder = records.find(record => record.title === '云雷纹');
  const sample = {...example, pattern_text:[{heading:'结构', paragraphs:['<云雷纹>和云纹']}]};
  const overlap = createAssetPreview({...data, records:[sample, cloud, cloudThunder]});
  assert.ok(overlap.render('asset:' + sample.id).includes(
    `&lt;<a class="wiki-link" href="${assetHref(cloudThunder.id)}">云雷纹</a>&gt;和<a class="wiki-link" href="${assetHref(cloud.id)}">云纹</a>`
  ));
});

test('三维可用状态匹配文件魔数，兼容LFS指针和真实GLB',()=>{
  let available=0;
  for(const row of Object.values(data.assets)){
    const file=new URL('../public/assets/models/'+row.model+'.glb',import.meta.url);
    const descriptor=openSync(file,'r'),header=Buffer.alloc(4);
    try{readSync(descriptor,header,0,4,0);}finally{closeSync(descriptor);}
    assert.equal(row.modelAvailable,header.toString()==='glTF');
    if(row.modelAvailable)available++;
  }
  assert.ok(available>0);
  assert.equal(data.assets['WW-BASIC-006'].modelAvailable,true);
});

test('资产详情使用右下角放大图标和统一全屏层，不再输出旧式完整图片链接',()=>{
  const preview=createAssetPreview(data);
  const model=preview.render('asset:WW-BASIC-000');
  assert.match(model,/class="ap-expand"/);
  assert.match(model,/data-expand-media="model"/);
  assert.match(model,/class="ap-lightbox"/);
  assert.match(model,/data-lightbox-stage/);
  assert.match(model,/转动与动作会驱动物理效果/);
  assert.doesNotMatch(model,/打开完整图片/);

  const still=preview.render('asset:images-WW-MOS-001');
  assert.match(still,/data-expand-media="image"/);
  assert.doesNotMatch(still,/ap-main-image"[^>]*button/);
  assert.doesNotMatch(still,/打开完整图片/);
});
