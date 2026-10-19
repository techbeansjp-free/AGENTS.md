import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/export-native-delivery.mjs',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');
test('complex export binds original intent and both CI runs without upgrading missing measurements',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-export-'));
 try{
  const worktree=path.join(root,'worktree'),pkg=path.join(root,'distribution/package');fs.mkdirSync(path.join(worktree,'complex'),{recursive:true});fs.mkdirSync(path.join(pkg,'skills/asc'),{recursive:true});
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
  const git=(...args)=>execFileSync('git',args,{cwd:worktree,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');fs.writeFileSync(path.join(worktree,'complex/REQUIREMENTS.md'),'original requirements');git('add','.');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');const base=git('rev-parse','HEAD');
  const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  fs.writeFileSync(path.join(pkg,'skills/asc/SKILL.md'),'synthetic skill');fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({version:'0.0.0-test'}));fs.writeFileSync(path.join(pkg,'release-identity.json'),JSON.stringify({sourceFiles:{'skills/asc/SKILL.md':hash('synthetic skill')}}));
  write('setup.json',{repository:'adachi-tatsuru/asc-public-synthetic-eval-20261016',origin:worktree,worktree,base,model:'fixture',effort:'fixture'});write('git-controls.json',{});
  const ci={head:base,draft:true,merged:false,boundToPr:true,checks:{test:'success'}};
  const delivery={phase:'original',head:base,complexCI:ci,greetingCI:ci,verification:{head:base,passed:true,results:[{argv:[process.execPath,'relative-test.mjs'],exit:0}]},usage:{observedProcessedTokens:null},pr:1};
  write('complex-delivery.json',delivery);fs.writeFileSync(path.join(worktree,'complex/REQUIREMENTS.md'),'changed after run');
  const output=path.join(root,'out.json');const run=()=>spawnSync(process.execPath,[script,root,output,'--complex'],{env:{...env,GIT_DIR:'/nonexistent'},encoding:'utf8'});
  let p=run();assert.equal(p.status,0,p.stderr);const result=JSON.parse(fs.readFileSync(output));assert.equal(result.conditions.intentSha256,hash('original requirements'));assert.deepEqual(result.conditions.commands,[[`absolute-path-sha256:${hash(process.execPath)}`,'relative-test.mjs']]);assert.equal(JSON.stringify(result).includes(process.execPath),false);assert.deepEqual(result.ci.checks,{'complex:test':'success','greeting:test':'success'});assert.equal(result.manualHandoffs,undefined);assert.equal(result.usage.observedProcessedTokens,null);assert.equal(result.evaluationCoverage.hostWorktreePointerRecorded,false);
  write('result.json',{status:0,recovery:{previousStatus:1}});write('complex-delivery.json',{...delivery,manualHandoffs:0});
  p=run();assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).manualHandoffs,1);assert.equal(JSON.parse(fs.readFileSync(output)).recovered,true);
  write('result.json',{status:0,automaticResumes:1,attempts:[{status:1},{status:0}]});
  p=run();assert.equal(p.status,0,p.stderr);const resumed=JSON.parse(fs.readFileSync(output));assert.equal(resumed.automaticResumes,1);assert.equal(resumed.manualHandoffs,0);assert.equal(resumed.usage.missingUsage.length,1);assert.equal(resumed.attempts[0].status,1);
  fs.unlinkSync(path.join(root,'result.json'));
  for(const change of [d=>d.greetingCI={...ci,head:'wrong'},d=>d.complexCI={...ci,checks:{}},d=>d.phase='revision',d=>d.interruptedAttempt={seconds:1}]){const bad=structuredClone(delivery);change(bad);write('complex-delivery.json',bad);assert.notEqual(run().status,0);}
  write('complex-delivery.json',{...delivery,greetingCI:{...ci,checks:{test:'failure'}}});p=run();assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).ci.checks['greeting:test'],'failure');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Claude export retains actual model and rejects incomplete or intervened observations',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-claude-export-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const pkg=path.join(root,'distribution/package');fs.mkdirSync(path.join(pkg,'skills/asc'),{recursive:true});
 fs.writeFileSync(path.join(pkg,'skills/asc/SKILL.md'),'synthetic');fs.writeFileSync(path.join(pkg,'package.json'),'{"version":"0.5.900-alpha.20"}');fs.writeFileSync(path.join(pkg,'release-identity.json'),JSON.stringify({sourceFiles:{'skills/asc/SKILL.md':hash('synthetic')}}));
 const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
 write('setup.json',{repository:'adachi-tatsuru/asc-public-synthetic-eval-20261016',origin:root,worktree:root,session:'test-session',base:'base',model:'alias',effort:'medium',cliVersion:'test'});write('git-controls.json',{});write('owner.json',{intent:'original'});
 const good={session:'test-session',implementationIntervention:0,run:{status:0,signal:null,seconds:1},totalSeconds:2,deliverySeconds:1,modelUsage:{actual:{inputTokens:1}},usage:{complete:true,reconciledWithHostModelUsage:true,observedProcessedTokens:1,missingUsage:[]},ci:{head:'head'},verification:{head:'head',passed:true,results:[{argv:['test'],exit:0}]},pr:1};
 const output=path.join(root,'out.json'),run=d=>{write('delivery.json',d);return spawnSync(process.execPath,[script,root,output,'--claude'],{encoding:'utf8'});};
 assert.equal(run(good).status,0);const data=JSON.parse(fs.readFileSync(output));assert.deepEqual(data.conditions.actualModels,['actual']);assert.equal(data.elapsedSeconds,2);assert.equal(data.implementationAndReviewSeconds,1);assert.equal(data.manualHandoffs,0);
 for(const change of [d=>d.usage.complete=false,d=>d.usage.reconciledWithHostModelUsage=false,d=>d.implementationIntervention=1,d=>d.session='wrong',d=>d.run.status=1,d=>d.modelUsage.other={}]){const bad=structuredClone(good);change(bad);assert.notEqual(run(bad).status,0);}
});
