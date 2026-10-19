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
  for(const change of [d=>d.greetingCI={...ci,head:'wrong'},d=>d.complexCI={...ci,checks:{}},d=>d.phase='revision',d=>d.interruptedAttempt={seconds:1}]){const bad=structuredClone(delivery);change(bad);write('complex-delivery.json',bad);assert.notEqual(run().status,0);}
  write('complex-delivery.json',{...delivery,greetingCI:{...ci,checks:{test:'failure'}}});p=run();assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).ci.checks['greeting:test'],'failure');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
