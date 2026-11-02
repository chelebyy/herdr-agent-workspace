const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {invocation,resultText,orchestrate,validate,normalizeCatalog,execute} = require('./mods/task-presets-tr/team-runner.cjs');
const role = {tool:'codex',provider:'openai',model:'test',effort:'medium',role:'Araştır'};
const config = {mode:'parallel',folder:__dirname,task:'Read only',coordinator:role,workers:[role,{...role,tool:'claude'}],reviewer:role};
test('CLI args keep hostile prompt as stdin, preserve selected model/effort, never bypass permissions', () => {
  const text = '$(Remove-Item x) `whoami` " & echo test\nTürkçe';
  for (const tool of ['codex','claude','opencode']) {
    const r=invocation({...role,tool},text);
    assert.equal(r.input,text);
    assert.ok(!r.args.includes(text));
    assert.ok(!r.args.some(a=>a.includes('bypass') || a==='--auto'));
    if(tool==='codex') {assert.ok(r.args.includes('service_tier="default"'));assert.ok(r.args.includes('model_reasoning_effort="medium"'));}
    if(tool==='claude') assert.ok(r.args.includes('medium'));
    if(tool==='opencode') assert.ok(r.args.includes('openai/test#medium'));
  }
});
test('Catalog strips provider credentials/settings and keeps real variants', () => {
  const rows=normalizeCatalog('opencode',{data:[{enabled:true,capabilities:{tools:true},providerID:'p',id:'m',settings:{apiKey:'secret'},variants:[{id:'high'}]}]});
  assert.equal(rows[0].efforts[0],'high');assert.ok(!JSON.stringify(rows).includes('secret'));
});
test('Validation rejects stale models, unsupported efforts, zero members and relative cwd', () => {
  const rows=[{...role,efforts:['medium']},{...role,tool:'claude',efforts:['medium']}];
  assert.equal(validate(config,rows),config);
  assert.throws(()=>validate({...config,folder:'.'},rows));
  assert.throws(()=>validate({...config,workers:[]},rows));
  assert.throws(()=>validate({...config,workers:[role]},rows));
  assert.equal(validate({...config,mode:'coordinated',workers:[role]},rows).workers.length,1);
  assert.throws(()=>validate({...config,coordinator:{...role,effort:'ultra'}},rows));
  assert.throws(()=>validate({...config,coordinator:{...role,model:'missing'}},rows));
});
test('Exit zero or partial text alone never proves success', () => {
  assert.throws(()=>resultText('codex','{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}'));
  assert.throws(()=>resultText('claude','{"type":"result","subtype":"error_max_turns","is_error":true}'));
  assert.throws(()=>resultText('opencode','{"type":"text","part":{"text":"partial"}}'));
  assert.equal(resultText('codex','{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\n{"type":"turn.completed"}'),'OK');
  assert.equal(resultText('claude','{"type":"result","subtype":"success","result":"OK"}'),'OK');
  const step='{"type":"step_start"}\n';
  assert.equal(resultText('opencode',step+'{"type":"text","part":{"text":"OK"}}\n{"type":"step_finish","part":{"reason":"stop"}}'),'OK');
  assert.throws(()=>resultText('opencode',step+'{"type":"text","part":{"text":"partial"}}\n{"type":"step_finish","part":{"reason":"tool-calls"}}'));
  // Some OpenCode versions exit after the last step's text without step_finish: accepted.
  assert.equal(resultText('opencode',step+'{"type":"text","part":{"text":"OK"}}'),'OK');
  // Only the last step counts: earlier text plus an empty last step is not an answer.
  assert.throws(()=>resultText('opencode',step+'{"type":"text","part":{"text":"partial"}}\n{"type":"step_finish","part":{"reason":"tool-calls"}}\n'+step));
  assert.equal(resultText('opencode',step+'{"type":"text","part":{"text":"old"}}\n{"type":"step_finish","part":{"reason":"tool-calls"}}\n'+step+'{"type":"text","part":{"text":"OK"}}\n{"type":"step_finish","part":{"reason":"end_turn"}}'),'OK');
});
test('Parallel workers start independently; synthesis and reviewer wait for both', async () => {
  const seen=[], pending=[];
  const task=orchestrate(config,async(id,r,prompt)=>{
    seen.push(id);
    if(id.startsWith('worker')) return new Promise(resolve=>pending.push(()=>resolve(id+' EVIDENCE')));
    if(id==='synthesis') {assert.ok(prompt.includes('worker-1 EVIDENCE'));assert.ok(prompt.includes('worker-2 EVIDENCE'));}
    if(id==='review') assert.ok(prompt.includes('synthesis EVIDENCE'));
    return id+' EVIDENCE';
  });
  assert.deepEqual(seen,['worker-1','worker-2']);
  pending[0]();pending[1]();
  assert.equal((await task).status,'completed');
  assert.deepEqual(seen,['worker-1','worker-2','synthesis','review']);
});
test('Coordinated work assigns each specific task and rejects invalid plans before workers', async()=>{
  const assigned=[];
  await orchestrate({...config,mode:'coordinated',reviewer:null},async(id,r,prompt)=>{
    if(id==='plan') return JSON.stringify({assignments:[{index:1,task:'Check tests'},{index:0,task:'Check code'}]});
    if(id.startsWith('worker')) assigned.push([id,prompt]);
    return 'OK';
  });
  assert.ok(assigned[0][1].includes('Check code'));assert.ok(assigned[1][1].includes('Check tests'));
  const calls=[];
  await assert.rejects(orchestrate({...config,mode:'coordinated'},async id=>{calls.push(id);return '{"assignments":[{"index":0,"task":"x"},{"index":0,"task":"y"}]}';}));
  assert.deepEqual(calls,['plan']);
});
test('Member failure produces partial result; total failure prevents synthesis', async()=>{
  const r=await orchestrate({...config,reviewer:null},async(id,role,prompt)=>{
    if(id==='worker-1')throw new Error('quota');
    if(id==='synthesis')assert.ok(prompt.includes('quota'));
    return 'OK';
  });
  assert.equal(r.status,'partial');
  let synthesis=false;
  await assert.rejects(orchestrate(config,async id=>{if(id==='synthesis')synthesis=true;throw new Error('quota');}));
  assert.equal(synthesis,false);
});
test('UI retains independent selections and serializes only enabled roles', () => {
  const source=fs.readFileSync(require('node:path').join(__dirname,'mods/task-presets-tr/main.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export default class /g,'class ').replace(/export (function|const) /g,'$1 ');
  const context=vm.createContext({View:class{},shared:()=>undefined,InputState:{new:({value})=>({value:()=>value,on(){}})}});
  const {TaskPresets,PRESETS}=vm.runInContext(source+'\n;({TaskPresets,PRESETS})',context);
  const view=new TaskPresets();
  view.catalog=[{tool:'codex',provider:'openai',model:'test',name:'Test',efforts:['medium']},{tool:'opencode',provider:'google',model:'flash',name:'Flash',efforts:['low']}];
  view.roles=['Coordinator','Worker A','Worker B','Reviewer'].map(label=>view.makeRole(view.catalog[0],label));
  view.selectModel(view.roles[1],view.catalog[1]);view.roles[1].effort='low';
  view.preset=PRESETS[1];view.input={value:()=>''};view.folderInput={value:()=>__dirname};view.mode='parallel';
  const result=view.teamConfig();
  assert.equal(result.coordinator.tool,'codex');assert.equal(result.workers[0].tool,'opencode');assert.equal(result.workers[0].effort,'low');assert.equal(result.workers[1].tool,'codex');assert.equal(result.reviewer,null);
  view.reviewer=true;assert.equal(view.teamConfig().reviewer.role,'Reviewer');
  view.catalog=[];assert.throws(()=>view.teamConfig());
});
test('Local subprocess preserves split UTF-8 output and reports nonzero exit', async()=>{
  const result=await execute([process.execPath],['-e',"const b=Buffer.from('Türkçe');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.exitCode=7},20)"],{timeout:2000});
  assert.equal(result.stdout,'Türkçe');assert.equal(result.code,7);
});
test('Local subprocess timeout and oversized output fail, without launching any provider', async()=>{
  await assert.rejects(execute([process.execPath],['-e','setInterval(()=>{},1000)'],{timeout:150}),/zaman/);
  const os=require('node:os');const pwd=await execute([process.execPath],['-e','process.stdout.write(process.env.PWD+"|"+process.cwd())'],{cwd:os.tmpdir(),timeout:5000});
  assert.equal(pwd.stdout,os.tmpdir()+'|'+os.tmpdir(),'children get PWD = cwd so CLIs that read PWD use the chosen folder');
  await assert.rejects(execute([process.execPath],['-e',"process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000)"],{timeout:2000,limit:100}),/çıktı/);
});
