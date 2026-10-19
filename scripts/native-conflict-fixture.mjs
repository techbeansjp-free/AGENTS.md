/** Evaluation-only fault injection into a disposable synthetic worktree, before Agent launch. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
export const conflictFaultCodes=Object.freeze(['SYNTHETIC_INVALID_A','SYNTHETIC_INVALID_B']);
export function assertConflictFaultsRemoved(source){
 if(conflictFaultCodes.some(code=>source.includes(code)))throw Error('Injected validation fault remains');
}
export function injectNativeConflict(repo){
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
 const args=['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false'];
 const options={cwd:repo,env,encoding:'utf8',stdio:['ignore','pipe','pipe']};
 const git=(...a)=>execFileSync('git',[...args,...a],options).trim();
 if(git('status','--porcelain'))throw Error('Conflict fixture requires clean worktree');
 const branch=git('symbolic-ref','--short','HEAD'),base=git('rev-parse','HEAD');
 const file='complex/reservation/service.mjs',absolute=path.join(repo,file),original=fs.readFileSync(absolute,'utf8');
 if(!/(['"])VALIDATION\1/.test(original))throw Error('Expected synthetic validation error literal');
 const fault=code=>original.replace(/(['"])VALIDATION\1/g,(_,q)=>q+code+q);
 fs.writeFileSync(absolute,fault(conflictFaultCodes[0]));git('add','--',file);git('commit','-m','Inject synthetic conflicting validation fault A');const left=git('rev-parse','HEAD');
 git('checkout','--detach',base);fs.writeFileSync(absolute,fault(conflictFaultCodes[1]));git('add','--',file);git('commit','-m','Inject synthetic conflicting validation fault B');const right=git('rev-parse','HEAD');
 git('checkout',branch);const pick=spawnSync('git',[...args,'cherry-pick',right],options);
 const unresolved=git('diff','--name-only','--diff-filter=U').split('\n');
 if(pick.status!==1||unresolved.length!==1||unresolved[0]!==file)throw Error('Expected actual single-service Git conflict');
 return {kind:'pre-launch synthetic fault injection',base,left,right,conflictingPaths:unresolved,gitConflictObserved:true,evaluatorResolution:false,scope:'Two intentionally invalid validation error codes conflict; original requirements remain authoritative. Agent must recover and implement revision. Not a performance comparison.'};
}
