import {test} from 'node:test';import assert from 'node:assert/strict';import {Github} from '../src/github.mjs';
const head='a'.repeat(40),base='b'.repeat(40),repository='owner/dummy';
function setup(overrides={}){
 const calls=[];const data={state:'open',draft:true,merged:false,head:{repo:{full_name:repository},ref:'trial',sha:head},base:{repo:{full_name:repository},ref:'main',sha:base},...overrides};
 const command=(argv)=>{calls.push(argv);if(argv[0]==='git')return argv[1]==='config'?'':head;if(argv[1]==='pr')return '[{"number":1}]';return JSON.stringify(data);};
 return {calls,data,provider:new Github({repository,issue:1,repo:'/dummy',branch:'trial',baseBranch:'main',base,workflowPath:'.github/workflows/safety.yml',command})};
}
test('existing validated Draft is observed before any push',()=>{
 const {provider,calls}=setup();assert.equal(provider.createDraft(head),1);assert(!calls.some(a=>a.includes('push')));
 for(const wrong of [{draft:false},{state:'closed'},{merged:true},{head:{repo:{full_name:'foreign/repo'},ref:'trial',sha:head}}]){
  const f=setup(wrong);assert.throws(()=>f.provider.createDraft(head));assert(!f.calls.some(a=>a.includes('push')));
 }
});
test('CI must be from expected repository, workflow, PR and HEAD',async()=>{
 const {provider,data}=setup();provider.expectedHead=head;
 const good={id:10,head_sha:head,event:'pull_request',path:'.github/workflows/safety.yml',repository:{full_name:repository},pull_requests:[{number:1,head:{sha:head},base:{sha:base}}],status:'completed',conclusion:'success',html_url:'fixture-run'};
 let run=good;
 provider.api=route=>route.includes('/actions/runs?')?{workflow_runs:[run]}:route.includes('/jobs?')?{total_count:1,jobs:[{name:'check',status:'completed',conclusion:'success'}]}:data;
 assert.equal((await provider.observe(1,{timeout:0})).checks.check,'success');
 for(const change of [{head_sha:base},{event:'push'},{path:'.github/workflows/other.yml'},{pull_requests:[]},{pull_requests:[{number:1,head:{sha:head},base:{sha:'c'.repeat(40)}}]},{pull_requests:[{number:1,head:{sha:base},base:{sha:base}}]},{repository:{full_name:'foreign/repo'}},{conclusion:'failure'}]){
  run={...good,...change};await assert.rejects(provider.observe(1,{timeout:0}));
 }
});

test('local Git transport substitution is rejected before external operations',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{execFileSync}=await import('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-transport-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:'pipe'});git('init','-q');
 for(const key of ['core.sshCommand','url.ssh://foreign/.insteadOf','include.path','extensions.worktreeConfig','remote.git@github.com:owner/dummy.git.url']){
  git('config',key,key==='extensions.worktreeConfig'?'true':'/dummy/untrusted');let external=0;
  const provider=new Github({repository,issue:1,repo:root,branch:'trial',baseBranch:'main',base,workflowPath:'.github/workflows/safety.yml',command:argv=>{
   if(argv[0]==='git'&&argv[1]==='config')return git(...argv.slice(1));external++;throw Error('Unexpected external operation');
  }});
  assert.throws(()=>provider.createDraft(head),/transport configuration/);assert.equal(external,0);git('config','--unset',key);
 }
});


test('only transient read transport failures retry within deadline without mutations',async()=>{
 const {provider,data,calls}=setup();provider.expectedHead=head;let reads=0;
 const run={id:10,head_sha:head,event:'pull_request',path:'.github/workflows/safety.yml',repository:{full_name:repository},pull_requests:[{number:1,head:{sha:head},base:{sha:base}}],status:'completed',conclusion:'success',html_url:'fixture-run'};
 provider.api=route=>{reads++;if(reads===2)throw Object.assign(Error('network'),{stderr:'dial tcp 127.0.0.1:443: i/o timeout'});return route.includes('/actions/runs?')?{workflow_runs:[run]}:route.includes('/jobs?')?{total_count:1,jobs:[{name:'check',status:'completed',conclusion:'success'}]}:data;};
 const result=await provider.observe(1,{timeout:1000,interval:0});assert.equal(result.transportFailures.length,1);assert.equal(result.checks.check,'success');assert.equal(calls.length,0);
 for(const failure of [Error('PR identity changed'),Object.assign(Error('auth'),{stderr:'HTTP 401: Bad credentials'}),new SyntaxError('invalid JSON')]){reads=0;provider.api=()=>{reads++;throw failure;};await assert.rejects(provider.observe(1,{timeout:1000,interval:0}));assert.equal(reads,1);}
 reads=0;provider.api=()=>{reads++;throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});};
 await assert.rejects(provider.observe(1,{timeout:1000,interval:0}));assert.equal(reads,3);
 reads=0;await assert.rejects(provider.observe(1,{timeout:0,interval:0}));assert.equal(reads,1);
});

test('identity is checked again after a transient observation failure',async()=>{
 const {provider,data}=setup();provider.expectedHead=head;let reads=0;
 provider.api=()=>{reads++;if(reads===1)throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});return {...data,draft:false};};
 await assert.rejects(provider.observe(1,{timeout:1000,interval:0}),/identity/);assert.equal(reads,2);
});


test('default CI observation survives twenty minutes; explicit owner deadline still applies',async t=>{
 const {provider,data}=setup();provider.expectedHead=head;
 let elapsed=0,observations=0;
 t.mock.method(Date,'now',()=>elapsed);
 provider.api=route=>{
  if(route.includes('/actions/runs?')){
   observations++;elapsed+=20*60*1000;
   return {workflow_runs:observations===1?[]:[{id:10,head_sha:head,event:'pull_request',path:'.github/workflows/safety.yml',repository:{full_name:repository},pull_requests:[{number:1,head:{sha:head},base:{sha:base}}],status:'completed',conclusion:'success',html_url:'fixture-run'}]};
  }
  return route.includes('/jobs?')?{total_count:1,jobs:[{name:'check',status:'completed',conclusion:'success'}]}:data;
 };
 assert.equal((await provider.observe(1,{interval:0})).checks.check,'success');assert.equal(observations,2);
 observations=0;provider.ciTimeoutMilliseconds=300000;
 await assert.rejects(provider.observe(1,{interval:0}),/deadline exceeded/);assert.equal(observations,1);
 for(const timeout of [-1,NaN,'300000'])await assert.rejects(provider.observe(1,{timeout}),/Invalid CI/);
});


test('completed run waits for job completion without accepting incomplete evidence',async()=>{
 const {provider,data}=setup();provider.expectedHead=head;let reads=0;
 const run={id:10,head_sha:head,event:'pull_request',path:'.github/workflows/safety.yml',repository:{full_name:repository},pull_requests:[{number:1,head:{sha:head},base:{sha:base}}],status:'completed',conclusion:'success'};
 provider.api=route=>route.includes('/actions/runs?')?{workflow_runs:[run]}:route.includes('/jobs?')?{total_count:1,jobs:[{name:'check',status:++reads===1?'in_progress':'completed',conclusion:reads===1?null:'success'}]}:data;
 assert.equal((await provider.observe(1,{timeout:1000,interval:0})).checks.check,'success');assert.equal(reads,2);
 reads=0;await assert.rejects(provider.observe(1,{timeout:0}),/deadline/);
 provider.api=route=>route.includes('/actions/runs?')?{workflow_runs:[run]}:route.includes('/jobs?')?{total_count:2,jobs:[{name:'check',status:'completed'},{name:'check',status:'completed'}]}:data;
 await assert.rejects(provider.observe(1,{timeout:1000,interval:0}),/Ambiguous jobs/);
});

test('empty and partial job indexes are reobserved; all pages are required',async()=>{
 const {provider,data,calls}=setup();provider.expectedHead=head;let observations=0;
 const run={id:10,head_sha:head,event:'pull_request',path:'.github/workflows/safety.yml',repository:{full_name:repository},pull_requests:[{number:1,head:{sha:head},base:{sha:base}}],status:'completed',conclusion:'success'};
 const jobs=Array.from({length:101},(_,i)=>({name:'check-'+i,status:'completed',conclusion:'success'}));
 provider.api=route=>{
  if(route.includes('/actions/runs?'))return {workflow_runs:[run]};
  if(route.includes('&page=2'))return {total_count:101,jobs:jobs.slice(100)};
  if(route.includes('/jobs?')){observations++;return observations===1?{total_count:0,jobs:[]}:observations===2?{total_count:1,jobs:[]}:{total_count:101,jobs:jobs.slice(0,100)};}
  return data;
 };
 const result=await provider.observe(1,{timeout:1000,interval:0});assert.equal(Object.keys(result.checks).length,101);assert.equal(observations,3);assert.equal(calls.length,0);
 observations=0;await assert.rejects(provider.observe(1,{timeout:0}),/deadline/);
});

test('workflow ref suffix is accepted without weakening CI identity binding',async()=>{
 const {provider,data}=setup();provider.expectedHead=head;
 const good={id:10,head_sha:head,event:'pull_request',path:'.github/workflows/safety.yml@main',repository:{full_name:repository},pull_requests:[{number:1,head:{sha:head},base:{sha:base}}],status:'completed',conclusion:'success'};
 let run=good,jobReads=0;
 provider.api=route=>{
  if(route.includes('/actions/runs?'))return {workflow_runs:[run]};
  if(route.includes('/jobs?')){jobReads++;return {total_count:1,jobs:[{name:'check',status:'completed',conclusion:'success'}]};}
  return data;
 };
 for(const suffix of ['', '@main', '@refs/heads/feature/topic', '@'+head]){
  run={...good,path:'.github/workflows/safety.yml'+suffix};
  assert.equal((await provider.observe(1,{timeout:0})).checks.check,'success');
 }
 for(const change of [{path:'.github/workflows/other.yml@main'},{path:null},{path:42},{head_sha:base},{event:'push'},{repository:{full_name:'foreign/repo'}},{pull_requests:[]},{pull_requests:[{number:2,head:{sha:head},base:{sha:base}}]},{pull_requests:[{number:1,head:{sha:base},base:{sha:base}}]},{pull_requests:[{number:1,head:{sha:head},base:{sha:head}}]}]){
  run={...good,...change};jobReads=0;
  await assert.rejects(provider.observe(1,{timeout:0}),/deadline/);
  assert.equal(jobReads,0);
 }
});


test('new Draft binds the submitted commit without claiming synthetic or Controller verification',()=>{
 const {provider,data}=setup(),calls=[];
 provider.command=(argv)=>{
  calls.push(argv);
  if(argv[0]==='git')return argv[1]==='config'?'':head;
  if(argv[1]==='pr'&&argv[2]==='list')return '[]';
  if(argv[1]==='pr'&&argv[2]==='create')return 'https://github.com/'+repository+'/pull/1';
  if(argv[1]==='api')return JSON.stringify(argv[2].includes('/git/ref/')?{object:{sha:base}}:data);
  throw Error('Unexpected command');
 };
 assert.equal(provider.createDraft(head),1);
 const submitted=calls.find(a=>a[1]==='pr'&&a[2]==='create');assert(submitted.includes('--draft'));
 assert.equal(submitted[submitted.indexOf('--title')+1],'Changes for #1');
 const body=submitted[submitted.indexOf('--body')+1];assert(body.includes(head));assert.doesNotMatch(body,/Isolated|Controller verification|independent fresh review/);
 assert.equal(calls.filter(a=>a.includes('push')).length,1);
});
