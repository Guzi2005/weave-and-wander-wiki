import {test} from 'node:test';import assert from 'node:assert/strict';
import {FIXED_TOPICS,validateTopic,toChallengeBank} from '../public/quiz-topics.js';
import {createLearningStore,topicKey,LEARNING_KEY} from '../public/quiz-learning-store.js';
import {topic,memoryStorage} from './fixtures/quiz-topic.mjs';
import {createChallengeState} from '../public/quiz-challenge-state.js';
function setup(storage=memoryStorage()){const s=createLearningStore({storage});s.syncFixed(FIXED_TOPICS.map(d=>({...d,topic:topic({id:d.id,passRate:d.passRate})})));return s;}
function attempt(s,t,correct){const a=s.start(topicKey(t));t.questions.forEach((q,i)=>s.answer(a.id,q.id,correct.includes(i)?'A':'B'));s.finish(a.id);return a;}
test('two fixed rates retained and AI-validated topic adapter uses honest metadata',()=>{assert.deepEqual(FIXED_TOPICS.map(d=>d.passRate),[80,75]);const t=topic({id:'generated-1',type:'generated'}),b=toChallengeBank(t);assert.equal(b.questions[0].generation.provider,'siliconflow');assert.equal(b.questions[0].review.humanReviewed,false);const m=createChallengeState(b);m.start(t.id);m.begin();assert.equal(m.getQuestions().length,5);});
test('each question best is a union across attempts, attempts never overwritten',()=>{const s=setup(),t=s.fixedTopic('ukrainian-costume');attempt(s,t,[0,2]);attempt(s,t,[1,3]);attempt(s,t,[1,2,3]);const x=s.summary(topicKey(t));assert.equal(x.bestAccuracy,80);assert.equal(x.attemptCount,3);assert.equal(x.attempts[2].accuracy,60);assert.equal(x.passed,false);});
test('pass unlock survives failed retries, refreshed store preserves all records',()=>{const storage=memoryStorage(),s=setup(storage),t=s.fixedTopic('ukrainian-costume');assert.equal(s.unlocked('mosuo-culture'),false);assert.throws(()=>s.start(topicKey(s.fixedTopic('mosuo-culture'))));attempt(s,t,[0,1,2,3]);attempt(s,t,[]);assert.equal(s.unlocked('mosuo-culture'),true);const restored=setup(storage);assert.equal(restored.summary(topicKey(t)).attemptCount,2);assert.equal(restored.unlocked('mosuo-culture'),true);});
test('both fixed topics passed unlock more, same tags generate independent immutable topics',()=>{const s=setup();for(const d of FIXED_TOPICS){const t=s.fixedTopic(d.id);attempt(s,t,[0,1,2,3,4]);}assert.equal(s.unlocked('more'),true);const a=topic({id:'generated-1',type:'generated'}),b=topic({id:'generated-2',type:'generated'});s.register(a);s.register(b);attempt(s,a,[0]);assert.equal(s.duplicates(['topic-ukrainian']).length,2);assert.equal(s.summary(topicKey(b)).attemptCount,0);const bad=structuredClone(a);bad.questions[0].question='改写';assert.throws(()=>s.register(bad));});
test('syncFixed auto-upgrades the fixed pin when the server publishes a higher version',()=>{const s=setup(),t=s.fixedTopic('ukrainian-costume');const next=topic({version:2});next.questions[0].question='修订版本新题';s.syncFixed([{id:next.id,topic:next}]);assert.equal(s.fixedTopic(t.id).version,2);});
test('syncFixed upgrade interrupts active attempts on the old version',()=>{const s=setup(),t=s.fixedTopic('ukrainian-costume');const a=s.start(topicKey(t));const next=topic({version:2});next.questions[0].question='修订版本新题';s.syncFixed([{id:next.id,topic:next}]);assert.equal(s.fixedTopic(t.id).version,2);assert.equal(s.summary(topicKey(t)).attempts[0].status,'interrupted');});
test('partial attempt saved per answer, reload marks interruption without losing best',()=>{const storage=memoryStorage(),s=setup(storage),t=s.fixedTopic('ukrainian-costume'),a=s.start(topicKey(t));s.answer(a.id,'q1','A');assert.throws(()=>s.answer(a.id,'q1','A'));const restored=createLearningStore({storage});const x=restored.summary(topicKey(t));assert.equal(x.attempts[0].status,'interrupted');assert.equal(x.bestAccuracy,20);assert.equal(x.passed,false);});
test('data export/import, browser isolation, invalid data and conflict are atomic',()=>{const s=setup(),t=s.fixedTopic('ukrainian-costume');attempt(s,t,[0]);const other=createLearningStore({storage:memoryStorage()});assert.equal(other.getData().topics.length,0);other.importData(s.exportData());assert.deepEqual(other.getData(),s.getData());const before=other.exportData();assert.throws(()=>other.importData('{}'));assert.equal(other.exportData(),before);const bad=JSON.parse(before);bad.topics[0].questions[0].question='冲突';assert.throws(()=>other.importData(JSON.stringify(bad)));assert.equal(other.exportData(),before);});
test('storage failure/corruption never overwrites existing data; cross-tab writes detected',()=>{const storage=memoryStorage();storage.setItem(LEARNING_KEY,'broken');assert.throws(()=>createLearningStore({storage}));assert.equal(storage.getItem(LEARNING_KEY),'broken');const m=memoryStorage(),a=createLearningStore({storage:m}),b=createLearningStore({storage:m});a.register(topic());assert.throws(()=>b.register(topic({id:'generated-1',type:'generated'})));const failing={getItem:()=>null,setItem(){throw new Error('Quota');}};const s=createLearningStore({storage:failing});assert.throws(()=>s.register(topic()));assert.equal(s.getData().topics.length,0);});
test('reject wrong count, duplicate point, missing evidence and invalid answers',()=>{for(const mutate of [t=>{t.questions=[];},t=>t.questions.push(t.questions[0]),t=>t.questions[0].answer='Z',t=>t.questions[1].knowledgePoint=t.questions[0].knowledgePoint,t=>t.questions[0].evidence=[]]){const t=topic();mutate(t);assert.throws(()=>validateTopic(t));}});
test('explicit version switch preserves old answers and earned unlocks without mixing per-question bests',()=>{
 const s=setup(),old=s.fixedTopic('ukrainian-costume');attempt(s,old,[0,1,2,3,4]);
 const next=topic({version:2});next.questions[0].question='根据《测试服饰档案》，新版服饰题';
 s.syncFixed([{id:next.id,topic:next}]);assert.equal(s.fixedTopic(next.id).version,2);
 const oldSummary=s.summary(topicKey(old));s.switchFixedVersion(next.id,topicKey(next));
 assert.equal(s.fixedTopic(next.id).version,2);assert.deepEqual(s.summary(topicKey(old)),oldSummary);
 assert.equal(s.summary(topicKey(next)).attemptCount,0);assert.equal(s.unlocked('mosuo-culture'),true);
 assert.equal(s.qualified(next.id),true);
});
function editedQuestion(over={}){return{id:'',type:'single',question:'按《测试服饰档案》， edited 题干内容是什么？',options:[{id:'A',text:'编辑答案甲'},{id:'B',text:'编辑答案乙'},{id:'C',text:'编辑答案丙'},{id:'D',text:'编辑答案丁'}],answer:'B',explanation:'编辑解析依据测试档案。',hint:'',sourceRecordIds:['WW-TEST-001'],evidence:[{recordId:'WW-TEST-001',quote:'测试档案第1个独立知识点明确记载：材料1用于该样本的制作。'}],knowledgePoint:''};}
test('replaceQuestion bumps version, keeps position and repins fixed topics without breaking history',()=>{
 const s=setup(),t=s.fixedTopic('ukrainian-costume');attempt(s,t,[0]);
 const oldKey=topicKey(t),oldSummary=s.summary(oldKey);
 const newKey=s.replaceQuestion(oldKey,'q2',editedQuestion());
 const edited=s.topic(newKey);
 assert.notEqual(newKey,oldKey);assert.equal(edited.version,2);
 assert.equal(edited.questions[1].question,'按《测试服饰档案》， edited 题干内容是什么？');
 assert.equal(edited.questions.length,5);assert.equal(edited.questions[1].id,'q2');
 assert.equal(s.fixedTopic('ukrainian-costume').version,2);
 assert.deepEqual(s.summary(oldKey),oldSummary);
});
test('addQuestion appends and createTopic makes a playable user topic listed once',()=>{
 const s=setup();
 const key=s.addQuestion(topicKey(s.fixedTopic('ukrainian-costume')),editedQuestion());
 const t=s.topic(key);assert.equal(t.questions.length,6);assert.equal(t.questions.at(-1).id,'q6');
 const userKey=s.createTopic({title:'我的测试题库',question:editedQuestion()});
 const user=s.topic(userKey);
 assert.equal(user.generation.provider,'user');assert.equal(user.questions.length,1);assert.equal(user.title,'我的测试题库');
 // 用户题库无需先通关固定专题即可开答，且只有最新版本出现在列表里。
 const a=s.start(userKey);s.answer(a.id,'q1','B');s.finish(a.id);
 assert.equal(s.generated().length,1);assert.equal(s.generated()[0].id,user.id);
 assert.equal(s.summary(userKey).bestAccuracy,100);
});
test('answer pads skipped questions when jumping ahead, finish stays consistent and export round-trips',()=>{
 const s=setup(),t=s.fixedTopic('ukrainian-costume'),a=s.start(topicKey(t));
 s.answer(a.id,'q3','A');
 const data=s.getData(),attempts=data.attempts;
 assert.equal(attempts.at(-1).answers.length,3);
 assert.equal(attempts.at(-1).answers[0].skipped,true);
 const restored=createLearningStore({storage:memoryStorage()});restored.importData(s.exportData());
 const back=restored.getData().attempts.at(-1);
 assert.equal(back.answers.length,3);assert.equal(back.answers[0].skipped,true);
 assert.equal(Math.round(back.accuracy),100);
 s.answer(a.id,'q4','A');s.answer(a.id,'q5','A');s.finish(a.id);
 const sum=s.summary(topicKey(t));
 assert.equal(sum.attempts.at(-1).status,'completed');
 assert.equal(sum.attempts.filter(x=>x.status==='completed').length,1);
});
