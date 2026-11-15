import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {Controller} from '../src/controller.mjs';import {commitCandidate} from '../src/candidate.mjs';
test('candidate commit never runs attribute filters or hooks',{skip:process.platform!=='linux'},t=>{
 const root=tempDir('asc-candidate-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),workspace=path.join(root,'worker');fs.mkdirSync(repo);fs.mkdirSync(workspace);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'code.txt'),'before');fs.writeFileSync(path.join(repo,'.gitattributes'),'code.txt filter=evil');git('add','.');git('commit','-qm','base');
 const marker=path.join(root,'bad');git('config','filter.evil.clean',`touch '${marker}'; cat`);
 fs.writeFileSync(path.join(repo,'.git/hooks/pre-commit'),`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o755});
 const contract={intent:'Change code',criteria:['after'],allowedPaths:['code.txt'],testArgv:['/bin/true'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''};
 const c=new Controller({repo,base:git('rev-parse','HEAD'),contract,implementer:'worker'});
 fs.writeFileSync(path.join(workspace,'code.txt'),'after');const target=commitCandidate(c,workspace);
 assert.equal(target.head,git('rev-parse','HEAD'));assert.equal(fs.existsSync(marker),false);
 assert.equal(fs.readFileSync(path.join(repo,'code.txt'),'utf8'),'after');assert.equal(c.nextWork(contract.intent).work,'verify');
 assert.throws(()=>commitCandidate(c,workspace),/no change/);
 const staged=execFileSync('git',['hash-object','-w','--stdin'],{cwd:repo,input:'staged user content',encoding:'utf8'}).trim();
 git('update-index','--cacheinfo','100644',staged,'code.txt');
 const indexBefore=fs.readFileSync(path.join(repo,'.git/index'));
 fs.writeFileSync(path.join(workspace,'code.txt'),'new candidate');
 assert.throws(()=>commitCandidate(c,workspace),/index/);
 assert.equal(git('rev-parse','HEAD'),target.head);
 assert.deepEqual(fs.readFileSync(path.join(repo,'.git/index')),indexBefore);
 assert.equal(git('show',':code.txt'),'staged user content');
 git('read-tree','HEAD');
 fs.unlinkSync(path.join(workspace,'code.txt'));fs.symlinkSync(path.join(repo,'.git/config'),path.join(workspace,'code.txt'));
 assert.throws(()=>commitCandidate(c,workspace));assert.equal(git('rev-parse','HEAD'),target.head);
});

// #1703: on macOS a process detached inside the Agent sandbox can outlive the Agent and keep writing its workspace.
// The Controller reads that workspace once; the candidate, the verification snapshot and the review export come from the commit.
test('workspace writes after the candidate commit change neither the candidate nor the verified or reviewed target',async t=>{
 const {exportSource}=await import('../src/workflow.mjs');const {hostExecution}=await import('../src/host-execution.mjs');
 const root=tempDir('asc-candidate-leftover-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),workspace=path.join(root,'worker');fs.mkdirSync(repo);fs.mkdirSync(workspace);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'code.txt'),'before');git('add','.');git('commit','-qm','base');
 // Test Host: runs the verification command in the workspace the Controller hands it.
 const host=path.join(root,'host.mjs');
 fs.writeFileSync(host,`import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const q=JSON.parse(fs.readFileSync(0,'utf8')),p=q.payload,r=spawnSync(p.argv[0],p.argv.slice(1),{cwd:p.workspace,env:{},timeout:p.timeout});
process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result:{exit:r.status,stdout:String(r.stdout),stderr:String(r.stderr)}}));`);
 const check="const fs=require('node:fs');if(fs.readFileSync('code.txt','utf8')!=='after'||fs.existsSync('planted.txt'))process.exit(1)";
 const contract={intent:'Change code',criteria:['after'],allowedPaths:['code.txt'],testArgv:[process.execPath,'-e',check],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''};
 const c=new Controller({repo,base:git('rev-parse','HEAD'),contract,implementer:'worker'});
 c.setHostVerification(hostExecution(c,{protocol:'asc-host-execution/v1',command:[process.execPath,host]}).verify);
 fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 const target=commitCandidate(c,workspace);
 // A leftover process rewrites the allowed file and plants another one after the Controller has read the workspace.
 fs.writeFileSync(path.join(workspace,'code.txt'),'leftover');fs.writeFileSync(path.join(workspace,'planted.txt'),'leftover');
 assert.deepEqual(c.target(),target);
 assert.equal(git('show',`${target.head}:code.txt`),'after');
 assert.equal(fs.readFileSync(path.join(repo,'code.txt'),'utf8'),'after');
 // Verification runs on a snapshot of the commit: the check fails if it sees the leftover's content.
 c.verify();assert.equal(c.nextWork(contract.intent).work,'independent-review');
 const review=path.join(root,'review');fs.mkdirSync(review);exportSource(c,target.head,review);
 assert.equal(fs.readFileSync(path.join(review,'code.txt'),'utf8'),'after');assert.equal(fs.existsSync(path.join(review,'planted.txt')),false);
});
