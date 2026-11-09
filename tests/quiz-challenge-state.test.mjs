import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDefaultQuestionBank} from '../public/quiz-question-bank.js';
import {createChallengeState} from '../public/quiz-challenge-state.js';
const bank=()=>createDefaultQuestionBank();
function finish(s,wrong=0){s.begin();for(const q of s.getQuestions()){
 s.submit(q.type==='knowledge'?null:wrong-->0?q.options.find(o=>o.id!==q.answer).id:q.answer);s.next();
}return s.getState();}
test('only first stage unlocked, forbidden jumps rejected',()=>{const b=bank(),s=createChallengeState(b);assert.deepEqual(s.getState().unlocked,[b.stages[0].id]);assert.throws(()=>s.start(b.stages[1].id));});
test('correct/wrong scoring, repeated submission and knowledge exclusion',()=>{
 const b=bank(),s=createChallengeState(b);s.start(b.stages[0].id);s.begin();s.submit('A');assert.equal(s.getState().summary.score,10);assert.throws(()=>s.submit('A'));s.next();s.submit('F');
 assert.equal(s.getState().summary.accuracy,50);assert.equal(s.getState().summary.score,10);s.next();s.submit('A');s.next();s.submit('A');s.next();
 const before=s.getState().summary;s.submit(null);assert.deepEqual(s.getState().summary,before);s.next();assert.equal(s.getState().attempt.passed,false);assert.equal(s.getState().view,'result');
});
test('pass, unlock, retry replaces attempt and total uses historical best without farming',()=>{
 const b=bank(),s=createChallengeState(b);s.start(b.stages[0].id);assert.equal(finish(s).totalScore,40);assert.equal(s.getState().unlocked.length,2);
 s.start(b.stages[1].id);finish(s);const best=structuredClone(s.getState().best[b.stages[1].id]);
 s.start(b.stages[0].id);assert.equal(s.getState().summary.score,0);finish(s,4);
 assert.equal(s.getState().totalScore,80);assert.deepEqual(s.getState().best[b.stages[1].id],best);assert.equal(s.getState().completedCount,2);
 s.retry();assert.equal(s.getState().summary.answered,0);finish(s);assert.equal(s.getState().totalScore,80);
});
test('per-stage pass boundary, all stages final completion and reset',()=>{
 const b=bank();b.stages[0].passRate=75;const s=createChallengeState(b);s.start(b.stages[0].id);assert.equal(finish(s,1).attempt.passed,true);
 for(const stage of b.stages.slice(1)){s.start(stage.id);finish(s);}
 assert.equal(s.getState().view,'complete');assert.equal(s.getState().allCompleted,true);assert.equal(s.getState().totalScore,190);
 const snap=s.getState();snap.completed.foo=true;assert.equal(s.getState().completed.foo,undefined);
 s.reset();assert.equal(s.getState().totalScore,0);assert.equal(s.getState().completedCount,0);
});
test('100 and 0 pass rates, fractional accuracy and early exits',()=>{
 const b=bank();b.stages[0].passRate=0;const s=createChallengeState(b);s.start(b.stages[0].id);assert.equal(finish(s,4).attempt.passed,true);
 s.start(b.stages[1].id);s.begin();s.submit('A');s.home();assert.equal(s.getState().best[b.stages[1].id],undefined);
});
test('arbitrary stage count, order and reviewed question pool',()=>{
 const b=bank();b.stages=b.stages.slice(0,1);b.questions=b.questions.filter(q=>q.stageId===b.stages[0].id);b.questions[0].review.status='draft';
 const s=createChallengeState(b);s.start(b.stages[0].id);assert.equal(s.getQuestions().length,4);assert.equal(finish(s).view,'complete');
});
test('prototype-like IDs cannot unlock stages or corrupt best-score tables',()=>{
 const b=bank();const old=b.stages[0].id;b.stages[0].id='__proto__';b.questions.filter(q=>q.stageId===old).forEach(q=>q.stageId='__proto__');
 const s=createChallengeState(b);assert.deepEqual(s.getState().unlocked,['__proto__']);assert.equal(s.getState().completedCount,0);
 s.start('__proto__');finish(s);assert.equal(s.getState().completedCount,1);assert.equal(s.getState().totalScore,40);
});
