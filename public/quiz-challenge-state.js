import {normalizeQuestionBank,isPlayableQuestion} from './quiz-question-bank.js';
const clone=v=>structuredClone(v);
/** Pure state machine. Cumulative score is the sum of per-stage bests, never attempt sums. */
export function createChallengeState(input){
 const bank=normalizeQuestionBank(input),completed=Object.create(null),best=Object.create(null);let view='home',attempt=null;
 const stageIndex=id=>bank.stages.findIndex(s=>s.id===id);
 const unlocked=id=>{const i=stageIndex(id);return i>=0&&(i===0||!!completed[bank.stages[i-1].id]);};
 const pool=id=>bank.questions.filter(q=>q.stageId===id&&isPlayableQuestion(q));
 const summary=()=>{
  const normal=attempt?.answers.filter(a=>a.type!=='knowledge')||[],correct=normal.filter(a=>a.correct).length;
  return {correct,wrong:normal.length-correct,answered:normal.length,total:attempt?pool(attempt.stageId).filter(q=>q.type!=='knowledge').length:0,
   accuracy:normal.length?correct/normal.length*100:0,score:correct*10};
 };
 const snapshot=()=>clone({view,attempt,summary:summary(),completed,best,unlocked:bank.stages.filter(s=>unlocked(s.id)).map(s=>s.id),
  totalScore:Object.values(best).reduce((n,x)=>n+x.score,0),completedCount:Object.keys(completed).length,stageCount:bank.stages.length,allCompleted:bank.stages.every(s=>completed[s.id])});
 function start(stageId){if(!unlocked(stageId))throw new Error('关卡尚未解锁');attempt={stageId,index:0,answers:[],finished:false,passed:false};view='transition';return snapshot();}
 function begin(){if(view==='transition')view='question';return snapshot();}
 function getQuestion(){return attempt?clone(pool(attempt.stageId)[attempt.index]||null):null;}
 function submit(answer){
  if(view!=='question'||!attempt||attempt.finished)throw new Error('当前无法提交');
  const q=getQuestion();if(attempt.answers.length>attempt.index)throw new Error('本题已经提交');
  if(q.type!=='knowledge'&&!q.options.some(o=>o.id===answer))throw new Error('请选择有效答案');
  const result={questionId:q.id,type:q.type,answer:q.type==='knowledge'?null:answer,correct:q.type==='knowledge'?null:answer===q.answer};
  attempt.answers.push(result);return clone(result);
 }
 function next(){
  if(view!=='question'||attempt.answers.length!==attempt.index+1)throw new Error('请先完成本题');
  if(attempt.index+1<pool(attempt.stageId).length){attempt.index++;return snapshot();}
  attempt.finished=true;const result=summary(),stage=bank.stages.find(s=>s.id===attempt.stageId);
  attempt.passed=result.accuracy>=stage.passRate;
  if(!best[stage.id]||result.score>best[stage.id].score)best[stage.id]={...result};
  if(attempt.passed)completed[stage.id]=true;
  view=attempt.passed&&stageIndex(stage.id)===bank.stages.length-1&&bank.stages.every(s=>completed[s.id])?'complete':'result';return snapshot();
 }
 function home(){attempt=null;view='home';return snapshot();}
 function reset(){Object.keys(completed).forEach(k=>delete completed[k]);Object.keys(best).forEach(k=>delete best[k]);return home();}
 return {getState:snapshot,getQuestion,getQuestions:()=>clone(attempt?pool(attempt.stageId):[]),start,begin,submit,next,home,reset,
  retry:()=>{if(!attempt)throw new Error('没有可重试的关卡');return start(attempt.stageId);}};
}
