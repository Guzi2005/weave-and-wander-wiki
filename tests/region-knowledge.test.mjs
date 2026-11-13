import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ETHNIC_TAGS} from '../public/tag-presets.js';
import {validateKnowledge,renderKnowledgeArticle,regionEthnicities,tagHref,readTagRoute,recommendEthnicities} from '../public/library/knowledge-base.js';
const base=new URL('../public/library/research/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,base),'utf8'));
const data={ethnicities:[...read('ethnic-a.json'),...read('ethnic-b.json')],provinces:read('provinces.json')};
const knowledge=validateKnowledge(data);

test('受控词表覆盖现有56民族名单，34地域与地图代码一致',()=>{
  assert.deepEqual(data.ethnicities.map(row=>row.name),ETHNIC_TAGS);
  const geo=JSON.parse(readFileSync(new URL('../public/library/china.geo.json',import.meta.url),'utf8'));
  assert.deepEqual(data.provinces.map(row=>row.id).sort(),geo.features.filter(f=>f.properties.name).map(f=>String(f.properties.adcode)).sort());
  for(const [i,row] of data.ethnicities.entries())assert.equal(row.id,`ethnic-${String(i+1).padStart(2,'0')}`);
});

test('各字段来源可解析，缺少来源或非法来源协议会阻止加载',()=>{
  const bad=structuredClone(data);bad.ethnicities[0].fieldSources.clothing=['missing'];
  assert.throws(()=>validateKnowledge(bad),/缺少有效来源/);
  const unsafe=structuredClone(data);unsafe.ethnicities[0].sources[0].url='javascript:alert(1)';
  assert.throws(()=>validateKnowledge(unsafe),/不支持的来源/);
});

test('省页与民族页从同一分布关系生成双向链接，无反向链接漂移',()=>{
  for(const ethnic of data.ethnicities){
    const ethnicHTML=renderKnowledgeArticle(ethnic.id,knowledge);
    for(const edge of ethnic.distribution){
      assert.ok(regionEthnicities(knowledge,edge.region).some(row=>row.id===ethnic.id));
      if(ethnic.id!=='ethnic-01')assert.ok(ethnicHTML.includes(`href="${tagHref(edge.region)}"`));
      assert.ok(renderKnowledgeArticle(edge.region,knowledge).includes(`href="${tagHref(ethnic.id)}"`));
    }
  }
});

test('页面来源统一置于尾部，正文进行HTML转义',()=>{
  for(const row of [...data.provinces,...data.ethnicities]){
    const html=renderKnowledgeArticle(row.id,knowledge);
    assert.ok(!html.includes('rm-citation'));assert.ok(html.includes('参考资料与注释'));
    for(const source of row.sources)assert.ok(html.includes(source.url.replaceAll('&','&amp;')));
  }
  const changed=structuredClone(data);changed.provinces[0].geography='<img src=x onerror=alert(1)>';
  const html=renderKnowledgeArticle('110000',validateKnowledge(changed));
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
});

test('民族层级独立于省级层级，直达链接与旧地域链接兼容',()=>{
  assert.equal(readTagRoute('#/ethnic/ethnic-15'),'ethnic-15');
  assert.equal(readTagRoute('#/region/420000'),'420000');
  assert.equal(readTagRoute('#/ethnic'),'ethnic-index');
  assert.equal(readTagRoute('#/bad'),'china');
  assert.equal(tagHref('ethnic-15'),'#/ethnic/ethnic-15');
  assert.equal(tagHref('420000'),'#/region/420000');
});

test('汉族广泛分布关系保留口径，高山族及纳西族边界说明不丢失',()=>{
  const han=knowledge.ethnicMap.get('ethnic-01');
  assert.ok(!han.distribution.some(edge=>['710000','810000','820000'].includes(edge.region)));
  assert.match(JSON.stringify(han),/广泛/);
  assert.match(JSON.stringify(knowledge.ethnicMap.get('ethnic-23')),/原住民/);
  assert.match(JSON.stringify(knowledge.ethnicMap.get('ethnic-27')),/摩梭/);
});


test('索引精简汉族与卡片说明，旧中国入口显示地域目录',()=>{
  const html=renderKnowledgeArticle('ethnic-index',knowledge);
  assert.ok(html.includes('rm-han-overview'));
  assert.ok(!html.includes('已整理地域'));
  assert.ok(!renderKnowledgeArticle('ethnic-01',knowledge).includes('rm-distribution-links'));
  assert.equal(tagHref('china'),'#/regions');
  assert.equal(readTagRoute('#/regions'),'china');
  assert.ok(renderKnowledgeArticle('china',knowledge).includes('<h1>地域索引</h1>'));
});

test('地域推荐优先明确分布关系，民族推荐使用共同地域且排除自身',()=>{
  const geo=JSON.parse(readFileSync(new URL('../public/library/china.geo.json',import.meta.url),'utf8'));
  const regions=geo.features.filter(f=>f.properties.name).map(feature=>({id:String(feature.properties.adcode),feature}));
  const taiwan=recommendEthnicities(knowledge,'710000',regions);
  assert.equal(taiwan[0].row.name,'高山族');
  const salar=recommendEthnicities(knowledge,'ethnic-35',regions);
  assert.ok(salar.length);
  assert.ok(salar.every(item=>item.row.id!=='ethnic-35'&&item.row.id!=='ethnic-01'));
  assert.ok(salar[0].reason.includes('关联地域'));
});

test('所有展示词条使用简洁陈述',()=>{
  for(const row of [...data.provinces,...data.ethnicities,{id:'china'},{id:'ethnic-index'}]){
    const html=renderKnowledgeArticle(row.id,knowledge);
    assert.doesNotMatch(html,/不是|不能|不应|不宜|不代表|不等于|不表示|不构成|不意味着|不等同|不必|不作为|并非/,row.id);
  }
});
