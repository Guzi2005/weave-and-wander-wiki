import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
test('isolated public build contains all quiz modules, stylesheet, and read-only Worker',async()=>{
 const source=fileURLToPath(new URL('../',import.meta.url)),root=await mkdtemp(path.join(tmpdir(),'ww-quiz-build-test-'));
 try{
  await cp(path.join(source,'public'),path.join(root,'public'),{recursive:true});
  await cp(path.join(source,'build-public.mjs'),path.join(root,'build-public.mjs'));
  await mkdir(path.join(root,'data'));await cp(path.join(source,'seed/records.json'),path.join(root,'data/records.json'));
  execFileSync(process.execPath,['build-public.mjs'],{cwd:root});
  for(const f of ['quiz-challenge.js','quiz-challenge-state.js','quiz-question-bank.js','quiz-challenge.css'])assert.equal(await readFile(path.join(root,'dist-public',f),'utf8'),await readFile(path.join(source,'public',f),'utf8'));
  const html=await readFile(path.join(root,'dist-public/index.html'),'utf8');assert.match(html,/\/quiz-challenge\.css/);assert.match(html,/name="ww-public"/);
  const worker=(await import(pathToFileURL(path.join(root,'dist-public/_worker.js')))).default;
  assert.equal((await worker.fetch(new Request('https://quiz.test/api/questions',{method:'POST'}),{})).status,405);
  assert.equal((await worker.fetch(new Request('https://quiz.test/api/questions'),{})).status,200);
  const css=await readFile(path.join(source,'public/quiz-challenge.css'),'utf8');
  // Every non-keyframe selector must remain scoped; no global element/.btn rules.
  for(const line of css.split('\n'))if(line.includes('{')&&!/^\s*(?:\/\*|@|--|position:|font:|\}|\s*$)/.test(line))assert.ok(line.trim().startsWith('.ww-quiz-challenge'),line);
 }finally{await rm(root,{recursive:true,force:true});}
});
