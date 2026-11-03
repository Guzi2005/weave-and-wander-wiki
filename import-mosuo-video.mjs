import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const url='https://www.xiaohongshu.com/explore/682bc550000000002002a98d';
const screenshots=['0a1183b7-7bb7-45b6-87f9-82ededf380a0','7d15dd44-6bd6-4268-aad5-f84439206fb4','1eda97ea-8c7d-43ea-9bcd-e2dd0b49d7b8','97a86d44-5ce9-43db-a53d-6f610d1fa837'];
const media=screenshots.map((id,i)=>{
 const dest=`mosuo-video-user-${i+1}.png`;
 copyFileSync(`C:/Users/16152/AppData/Local/Temp/codex-clipboard-${id}.png`,path.join(here,'public/assets',dest));
 return {path:`/assets/${dest}`,role:'source',label:`用户补充截图 ${i+1}（视频中的不同穿戴实例）`};
});
for(const time of [126,130,132,291]){
 const name=`mosuo-video-${time}s.jpg`;
 copyFileSync(path.join(root,`captures/mosuo_video/frame-${time.toFixed(1).padStart(6,'0')}.jpg`),path.join(here,'public/assets',name));
 media.push({path:`/assets/${name}`,role:'source',label:`本地视频帧 ${Math.floor(time/60)}:${String(time%60).padStart(2,'0')}，时差岛`});
}
const note='补充来源 V-MOS-002。与照片001不是同一人、同一套衣物。本地视频长707.76秒，1280×720，25fps；已抽取全片30秒间隔索引，并逐帧检查02:06–02:14、04:51及若干头饰镜头。视频里的历史和社会解释仅作为讲述者观点，尚未独立核验，不直接生成事实题。公开使用视频及截图的授权待确认，当前仅本地研究。';
const observations=[
 '画面观察｜02:06–02:10：白衣穿戴者转身时，黑色假发束形成宽厚的一圈，后脑有收束与盘结；不是多圈细绳叠成的帽檐。',
 '视频讲述｜约02:10的字幕说明牦牛尾用于假发。此说法有视频出处；不能据此确定照片001那件头饰的真实材料。',
 '画面观察｜02:10：红色花饰为多层卷叠的宽花瓣，帽缘有多排红色珠串；与蓝衣讲述者的多色珠饰不是同一件头饰。',
 '画面观察｜02:06–02:14：裙褶转动时形成柔软圆弧，褶脊有宽度，下摆与红线随裙片连续起伏。',
 '画面观察｜04:51：蓝衣穿戴者背面可见头后收束的多色垂饰经过颈侧；原照片紫色米珠束的精确系结位置仍属参考推演。',
 '用户补充｜照片001的紫色长米珠串从后脑自然汇集，经肩侧垂落。模型保留原照片紫色、红衣、浅蓝裙组合，参考新视频改善结构。',
 '制作决定｜银线织纹与丝绸光泽是本次游戏材质目标；底布和银线分别控制粗糙度、金属度与浅浮纹法线。生成纹样不能替代原物工艺鉴定。'
];
async function api(route,method='GET',body){const response=await fetch('http://127.0.0.1:4318/api'+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error(await response.text());return response.json();}
const all=await api('/records');const rows=Array.isArray(all)?all:all.records;
let ref=rows.find(r=>r.collection_id==='mosuo_video_002');
if(!ref){const result=await api('/records','POST',{title:'摩梭服饰补充影像｜什么是真正的摩梭？',category:'服装',record_type:'object',collection_id:'mosuo_video_002',notes:note,source_url:url,media,observations});ref=result.record||result;}
// Keep later research/user additions when the initial-source import is repeated.
const {record:existingRef}=await api('/records/'+ref.id);
const mergedMedia=[...(existingRef.media||[])];
for(const item of media)if(!mergedMedia.some(m=>m.path===item.path))mergedMedia.push(item);
const mergedObservations=[...new Set([...(existingRef.observations||[]),...observations])];
const refPatch={};
if(existingRef.status==='待整理')refPatch.status='考证中';
if(!existingRef.source?.author)refPatch.source_author='时差岛（页面发布账号）';
if(!existingRef.culture?.text)refPatch.culture_text='摩梭（视频题名、讲述与用户提供）';
if(!existingRef.source?.url)refPatch.source_url=url;
if(!existingRef.notes)refPatch.notes=note;
if(JSON.stringify(mergedMedia)!==JSON.stringify(existingRef.media))refPatch.media=mergedMedia;
if(JSON.stringify(mergedObservations)!==JSON.stringify(existingRef.observations))refPatch.observations=mergedObservations;
if(Object.keys(refPatch).length)await api('/records/'+ref.id,'PATCH',refPatch);
for(const id of ['WW-MOS-001','WW-MOS-001-C01','WW-MOS-001-C03']){
 const {record}=await api('/records/'+id);const addition=`补充结构参考：${ref.id} / V-MOS-002《什么是真正的摩梭？》。不同穿戴实例不并入本套装；后脑收束、盘辫及花瓣结构据补充影像修订。`;
 const patch={};if(!record.observations.some(x=>x.includes('V-MOS-002')))patch.observations=[...record.observations,addition];
 if(record.title.includes('种子珠'))patch.title=record.title.replaceAll('种子珠','米珠');
 if(Object.keys(patch).length)await api('/records/'+id,'PATCH',patch);
}
const seedPath=path.join(here,'seed/records.json');const seed=JSON.parse(readFileSync(seedPath,'utf8'));
const now=new Date().toISOString();
if(!seed.records.some(r=>r.id==='WW-MOS-REF-002'))seed.records.push({id:'WW-MOS-REF-002',title:'摩梭服饰补充影像｜什么是真正的摩梭？',category:'服装',record_type:'object',status:'考证中',collection_id:'mosuo_video_002',parent_id:null,culture:{text:'摩梭（视频及用户提供）',attribution:'source'},notes:note,observations,source:{author:'时差岛',url,license:null},media,revision:1,created_at:now,updated_at:now});
for(const record of seed.records){record.title=record.title.replaceAll('种子珠','米珠');if(['WW-MOS-001','WW-MOS-001-C01','WW-MOS-001-C03'].includes(record.id)&&!record.observations.some(x=>x.includes('V-MOS-002')))record.observations.push('补充结构参考 WW-MOS-REF-002 / V-MOS-002；不同穿戴实例不并入照片001套装。');}
writeFileSync(seedPath,JSON.stringify(seed,null,2)+'\n');
const hashes=media.map(m=>({path:m.path,sha256:createHash('sha256').update(readFileSync(path.join(here,'public',m.path))).digest('hex')}));
writeFileSync(path.join(root,'captures/mosuo_video/wiki-import.json'),JSON.stringify({record_id:ref.id,url,media:hashes},null,2));
console.log('VIDEO_SOURCE_IMPORTED',ref.id,media.length);
