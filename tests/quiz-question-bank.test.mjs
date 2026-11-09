import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultQuestionBank,normalizeQuestionBank,importQuestionBank,exportQuestionBank,isPlayableQuestion} from '../public/quiz-question-bank.js';
test('default has dynamic stages, 25 questions and a stable JSON round trip',()=>{
 const b=createDefaultQuestionBank();assert.equal(b.stages.length,5);assert.equal(b.questions.length,25);
 assert.deepEqual(importQuestionBank(exportQuestionBank(b)),b);
 b.stages.push({id:'new-topic',title:'安徽',description:'新地区',order:6,passRate:60});
 b.questions.push({...structuredClone(b.questions[0]),id:'new-q',stageId:'new-topic'});
 assert.equal(normalizeQuestionBank(b).stages.length,6);
});
for(const [name,mutate] of [
 ['重复关卡',b=>b.stages[1].id=b.stages[0].id],['重复题目',b=>b.questions[1].id=b.questions[0].id],
 ['缺失关联',b=>b.questions[0].stageId='missing'],['无效题型',b=>b.questions[0].type='essay'],
 ['缺答案',b=>delete b.questions[0].answer],['越界通过率',b=>b.stages[0].passRate=101],
 ['无普通题',b=>b.questions=b.questions.filter(q=>q.stageId!==b.stages[0].id||q.type==='knowledge')],
 ['重复选项',b=>b.questions[0].options[1].id='A'],['错误布尔选项',b=>b.questions[1].options[0].id='A'],
 ['危险引用',b=>b.questions[0].source.references[0].url='javascript:alert(1)'],
 ['未审AI',b=>b.questions[0].generation.provider='deepseek'],['重复顺序',b=>b.stages[1].order=1],
 ['无效审核时间',b=>b.questions[0].review.reviewedAt='yesterday']
])test(`拒绝${name}`,()=>{const b=createDefaultQuestionBank();mutate(b);assert.throws(()=>normalizeQuestionBank(b));});
test('reject invalid JSON/schema and do not mutate input',()=>{
 assert.throws(()=>importQuestionBank('{'));assert.throws(()=>normalizeQuestionBank({}));
 const b=createDefaultQuestionBank(),copy=structuredClone(b);normalizeQuestionBank(b);assert.deepEqual(b,copy);
});
test('AI drafts may be stored but never played; approval requires explicit human review',()=>{
 const b=createDefaultQuestionBank(),q=b.questions[0];q.generation={provider:'deepseek',model:'test',generatedAt:'2026-11-09T00:00:00Z',verified:false};q.review.status='draft';
 assert.equal(isPlayableQuestion(normalizeQuestionBank(b).questions[0]),false);
 q.review.status='approved';q.generation.verified=true;assert.throws(()=>normalizeQuestionBank(b));
 q.review.humanReviewed=true;assert.equal(isPlayableQuestion(normalizeQuestionBank(b).questions[0]),true);
});
