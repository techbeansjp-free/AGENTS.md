import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {Controller,digest} from '../src/controller.mjs';import {importUnitCandidate,candidateMatchesContract} from '../src/unit-candidate.mjs';
test('restart imports actual SHA-256 candidate bytes without importing evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-sha256-candidate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),target=path.join(root,'target');fs.mkdirSync(source);
 const git=(repo,...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git(source,'init','-q','--object-format=sha256');git(source,'config','user.name','Fixture');git(source,'config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(source,'app.txt'),'before');git(source,'add','.');git(source,'commit','-qm','base');const base=git(source,'rev-parse','HEAD');
 git(root,'clone','-q',source,target);
 fs.writeFileSync(path.join(source,'app.txt'),'after');git(source,'add','.');git(source,'commit','-qm','candidate');const head=git(source,'rev-parse','HEAD');
 const contract={intent:'Update app',criteria:['after'],allowedPaths:['app.txt'],testArgv:['node','--version'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'fixture',risks:[],unresolved:[],requiresDesign:false,design:''};
 const reference={repo:source,base,head,contractDigest:digest(contract)};
 const result=importUnitCandidate({reference,unit:{writePaths:['app.txt'],readPaths:[]},contract,candidate:target,base,workspace:path.join(root,'workspace')});
 assert.equal(result.status,'candidate-imported');assert.equal(result.head.length,64);assert.match(result.authority,/new verification/);assert.equal(fs.readFileSync(path.join(target,'app.txt'),'utf8'),'after');
 assert.equal(new Controller({repo:target,base,contract,implementer:'new-context'}).events.length,0);
 assert.equal(candidateMatchesContract({...reference,contractDigest:'0'.repeat(64)},contract),false);
 for(const length of [39,41,63,65])assert.throws(()=>candidateMatchesContract({...reference,head:'a'.repeat(length)},contract),/Git binding/);
});
