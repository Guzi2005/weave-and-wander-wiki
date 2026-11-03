import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('../../scripts/garment_definition.gd',import.meta.url),'utf8');
const values=name=>JSON.parse(source.match(new RegExp('const '+name+' := (\\[[^\\n]+\\])'))[1]);
const names=values('STYLE_NAMES'),ids=values('DESIGN_IDS');
const seedPath=new URL('./seed/records.json',import.meta.url);
const seed=JSON.parse(readFileSync(seedPath,'utf8'));
const catalogPath=new URL('./public/assets/catalog.json',import.meta.url);
const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
const now=new Date().toISOString();
const records=names.flatMap((title,style)=>{
 if(style>=14&&style<=16)return [];
 const id='WW-BASIC-'+String(style).padStart(3,'0');
 catalog.assets[id]={model:ids[style],label:title,cover:'/assets/'+ids[style]+'-cover.png'};
 return [{id,title,record_type:'component',category:[6,7,8,9,17].includes(style)?'饰品':'服装',status:'已整理',collection_id:'ww_game_basics',parent_id:null,culture:null,place:null,date_text:null,notes:'W&W 游戏基础版型。对应游戏款式 '+style+'，模型 '+ids[style]+'。外观可随所选布料改变。此条记录游戏模型与可调设计，不作为传统服饰考证结论。',observations:style===17?['发箍最窄与最宽尺寸可参数化调整。']:[],source:{author:'W&W 项目',captured_at:null,place:null,url:null,license:null},media:[{path:'/assets/'+ids[style]+'-cover.png',role:'generated_concept',label:'游戏现有模型预览'}],revision:1,created_at:now,updated_at:now}];
});
const base='http://127.0.0.1:4318/api';
const existing=await (await fetch(base+'/export')).json();
for(const record of records){
 if(!seed.records.some(x=>x.id===record.id))seed.records.push(record);
 if(existing.records.some(x=>x.id===record.id))continue;
 const response=await fetch(base+'/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
 if(!response.ok)throw Error(await response.text());
}
writeFileSync(seedPath,JSON.stringify(seed,null,2)+'\n');
writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log('Imported',records.length,'basic patterns; existing cultural records preserved.');
