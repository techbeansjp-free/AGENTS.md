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
 write('setup.json',{repository:'adachi-tatsuru/asc-public-synthetic-eval-20261016',origin:root,worktree:root,runnerSha256:'a'.repeat(64),session:'test-session',base:'base',model:'alias',effort:'medium',cliVersion:'test'});write('git-controls.json',{});write('owner.json',{intent:'original'});
 const good={session:'test-session',implementationIntervention:0,run:{status:0,signal:null,seconds:1},totalSeconds:2,deliverySeconds:1,modelUsage:{actual:{inputTokens:1}},usage:{complete:true,reconciledWithHostModelUsage:true,observedProcessedTokens:1,missingUsage:[]},ci:{head:'head'},verification:{head:'head',passed:true,results:[{argv:['test'],exit:0}]},pr:1};
 const output=path.join(root,'out.json'),run=d=>{write('delivery.json',d);return spawnSync(process.execPath,[script,root,output,'--claude'],{encoding:'utf8'});};
 assert.equal(run(good).status,0);const data=JSON.parse(fs.readFileSync(output));assert.deepEqual(data.conditions.actualModels,['actual']);assert.equal(data.conditions.runnerSha256,'a'.repeat(64));assert.equal(data.elapsedSeconds,2);assert.equal(data.implementationAndReviewSeconds,1);assert.equal(data.manualHandoffs,0);assert.equal(data.evaluationCoverage.inHostVerification,null);
 assert.equal(data.conditions.verificationTransport,'unrecorded');
 const transportSetup=JSON.parse(fs.readFileSync(path.join(root,'setup.json')));
 for(const verificationTransport of ['inline','saved']){
  write('setup.json',{...transportSetup,verificationTransport});assert.equal(run(good).status,0);
  assert.equal(JSON.parse(fs.readFileSync(output)).conditions.verificationTransport,verificationTransport);
 }
 write('setup.json',{...transportSetup,verificationTransport:'invalid'});assert.notEqual(run(good).status,0);
 write('setup.json',transportSetup);
 const estimateRun=run({...good,elapsedTimeIsEstimate:true});assert.equal(estimateRun.status,0);
 const estimateLog=JSON.parse(estimateRun.stdout);assert.equal(estimateLog.elapsedSeconds,null);assert.equal(estimateLog.elapsedSecondsEstimate,2);assert.equal(estimateLog.elapsedComparisonEligible,false);
 const estimated=JSON.parse(fs.readFileSync(output));assert.equal(estimated.elapsedSeconds,null);assert.equal(estimated.elapsedSecondsEstimate,2);assert.equal(estimated.elapsedComparisonEligible,false);assert.equal(estimated.elapsedTimeIsEstimate,true);
 assert.notEqual(run({...good,inHostVerification:{head:'head'}}).status,0);
 const verified={...good.verification,schema:'asc-worktree-verification/v1',repo:root,base:'base',contractSha256:'c'.repeat(64),contextSha256:'d'.repeat(64)};
 const eventEvidence={toolUseId:'verify',head:'head',contractSha256:verified.contractSha256,checks:1,scope:'Observed coordinator Bash result; external oracle independently rechecked the same commit'};
 fs.writeFileSync(path.join(root,'events.jsonl'),[
  {message:{content:[{type:'tool_use',name:'Bash',id:'verify',input:{command:'node cli.mjs worktree-verify . base /owner.json'}}]}},
  {message:{content:[{type:'tool_result',tool_use_id:'verify',content:JSON.stringify(verified)}]}}
 ].map(JSON.stringify).join('\n'));
 assert.equal(run({...good,verification:verified,inHostVerification:eventEvidence}).status,0);
 assert.deepEqual(JSON.parse(fs.readFileSync(output)).evaluationCoverage.inHostVerification,eventEvidence);
 assert.notEqual(run({...good,verification:verified,inHostVerification:{...eventEvidence,toolUseId:'invented'}}).status,0);
 const priorSetup=JSON.parse(fs.readFileSync(path.join(root,'setup.json'))),capture={command:'node /synthetic/capture.mjs',marker:'1'.repeat(32)};
 write('setup.json',{...priorSetup,verificationCapture:capture});
 fs.writeFileSync(path.join(root,'events.jsonl'),[
  {message:{content:[{type:'tool_use',name:'Bash',id:'verify',input:{command:capture.command}}]}},
  {message:{content:[{type:'tool_result',tool_use_id:'verify',content:`noise\nASC_VERIFY_${capture.marker}_BEGIN\n${JSON.stringify({status:0,error:null,stdout:JSON.stringify(verified),stderr:''})}\nASC_VERIFY_${capture.marker}_END\nmore noise`}]}}
 ].map(JSON.stringify).join('\n'));
 assert.equal(run({...good,verification:verified,inHostVerification:eventEvidence}).status,0);
 assert.deepEqual(JSON.parse(fs.readFileSync(output)).evaluationCoverage.inHostVerification,eventEvidence);
 write('setup.json',priorSetup);
 assert.notEqual(run({...good,verification:verified,inHostVerification:eventEvidence}).status,0);


 for(const change of [d=>d.usage.complete=false,d=>d.usage.reconciledWithHostModelUsage=false,d=>d.implementationIntervention=1,d=>d.session='wrong',d=>d.run.status=1,d=>d.modelUsage.other={}]){const bad=structuredClone(good);change(bad);assert.notEqual(run(bad).status,0);}
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
 const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 fs.mkdirSync(path.join(root,'complex'));fs.writeFileSync(path.join(root,'complex/REQUIREMENTS.md'),'requirements');fs.writeFileSync(path.join(root,'complex/REVISION.md'),'revision');fs.writeFileSync(path.join(root,'complex/SYSTEM_REQUIREMENTS.md'),'system journeys');
 git('init');git('add','complex');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');const base=git('rev-parse','HEAD');
 const setup=JSON.parse(fs.readFileSync(path.join(root,'setup.json')));write('setup.json',{...setup,base,scenario:'complex-two-issue-currency'});
 const ci={head:base,draft:true,merged:false,boundToPr:true,checks:{test:'success'}};
 const complex={...good,head:base,ci,greetingCI:ci};assert.equal(run(complex).status,0);
 write('setup.json',{...setup,base,scenario:'complex-two-issue-system'});assert.notEqual(run(complex).status,0);
 assert.notEqual(run({...complex,greetingCI:undefined}).status,0);
 const browserConfig={transport:'fixed-isolated-mcp/v1',oracleSha256:'b'.repeat(64),driverSha256:'c'.repeat(64),timeoutMilliseconds:60000};
 const observation={toolUseId:'browser',head:base,oracleSha256:browserConfig.oracleSha256,driverSha256:browserConfig.driverSha256};
 const browser={schema:'asc-evaluation-browser/v1',head:base,oracleSha256:browserConfig.oracleSha256,driverSha256:browserConfig.driverSha256,passed:true,exit:0,error:null,signal:null,inHostObservation:observation};
 write('setup.json',{...setup,base,scenario:'complex-two-issue-system',browserVerification:browserConfig});
 fs.writeFileSync(path.join(root,'events.jsonl'),[
  {message:{content:[{type:'tool_use',name:'mcp__asc_browser__verify_browser',id:'browser',input:{head:base}}]}},
  {message:{content:[{type:'tool_result',tool_use_id:'browser',content:[{type:'text',text:JSON.stringify(browser)}]}]}}
 ].map(JSON.stringify).join('\n'));
 assert.equal(run({...complex,browserVerification:browser}).status,0);
 assert.deepEqual(JSON.parse(fs.readFileSync(output)).evaluationCoverage.browserVerification,browser);
 const system=JSON.parse(fs.readFileSync(output));assert.equal(system.conditions.scenario,'complex-two-issue-system');assert.equal(system.conditions.intentSha256,hash(JSON.stringify(['original','requirements','system journeys'])));assert.deepEqual(system.conditions.browserVerification,browserConfig);
 for(const value of [undefined,{...browser,passed:false},{...browser,head:'wrong'},{...browser,inHostObservation:{...observation,toolUseId:'invented'}},{...browser,driverSha256:'wrong'}])assert.notEqual(run({...complex,browserVerification:value}).status,0);

 write('setup.json',{...setup,base,scenario:'complex-two-issue-currency'});assert.equal(run(complex).status,0);
 const exported=JSON.parse(fs.readFileSync(output));assert.equal(exported.conditions.intentSha256,hash(JSON.stringify(['original','requirements','revision'])));assert.deepEqual(exported.ci.checks,{'complex:test':'success','greeting:test':'success'});
 write('setup.json',{...setup,base,scenario:'complex-two-issue-currency',reviewerMode:'registered',reviewerDefinitionSha256:'b'.repeat(64)});
 for(const agentType of [undefined,'claude'])assert.notEqual(run({...complex,review:{agentType}}).status,0);
 assert.equal(run({...complex,review:{agentType:'asc-reviewer'}}).status,0);
 write('setup.json',{...setup,base,scenario:'complex-two-issue-currency',reviewerMode:'generic'});
 assert.notEqual(run({...complex,review:{agentType:'asc-reviewer'}}).status,0);
 for(const change of [d=>delete d.greetingCI,d=>d.greetingCI={...ci,head:'wrong'},d=>d.greetingCI={...ci,checks:{}}]){const bad=structuredClone(complex);change(bad);assert.notEqual(run(bad).status,0);}

});
