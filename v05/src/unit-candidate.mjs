/** Old output is candidate data, never reusable test/review/approval evidence. */
import fs from 'node:fs';import path from 'node:path';
import {Controller,digest} from './controller.mjs';
import {commitCandidate} from './candidate.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
const entries=(blobs,paths)=>[...blobs].filter(([name])=>paths.some(p=>name===p||name.startsWith(p+'/'))).map(([name,b])=>[name,b.mode,b.oid]).sort((a,b)=>a[0].localeCompare(b[0]));
export function candidateMatchesContract(reference,contract){
 demand(reference&&typeof reference.repo==='string'&&path.isAbsolute(reference.repo)&&/^[a-f0-9]{40}$/.test(reference.base)&&/^[a-f0-9]{40}$/.test(reference.head),'Explicit candidate Git binding required');
 return reference.contractDigest===digest(contract);
}
export function importUnitCandidate({reference,unit,contract,candidate,base,workspace,commitIdentity,controller}){
 const matches=candidateMatchesContract(reference,contract);
 if((contract.requiresDesign||contract.risks?.length)&&!controller)return {status:'invalidated',reason:'fresh-owner-approved-work-required'};
 if(!matches)return {status:'invalidated',reason:'unit-contract-changed'};
 if(controller){demand(controller.repo===fs.realpathSync(candidate)&&controller.base===base&&digest(controller.contract)===digest(contract),'Candidate controller binding mismatch');controller.target({allowEmpty:true});}
 const source=new Controller({repo:reference.repo,base:reference.base,contract,implementer:'untrusted-prior-output'});
 source.git('merge-base','--is-ancestor',reference.base,reference.head);
 const priorBase=source.blobs(reference.base),output=source.blobs(reference.head);
 const names=new Set([...priorBase.keys(),...output.keys()]);
 const changed=[...names].filter(name=>priorBase.get(name)?.oid!==output.get(name)?.oid||priorBase.get(name)?.mode!==output.get(name)?.mode);
 demand(changed.length&&changed.every(name=>unit.writePaths.includes(name)),'Prior candidate exceeded unit scope');
 const target=controller??new Controller({repo:candidate,base,contract,implementer:'untrusted-prior-output'}),current=target.blobs(base);
 // Preserve newer edits at the write destination. Changed read inputs invalidate
 // evidence, not necessarily these untrusted candidate bytes. The caller always
 // runs current verification and fresh review before any integration.
 if(digest(entries(priorBase,unit.writePaths))!==digest(entries(current,unit.writePaths)))return {status:'invalidated',reason:'write-preimage-changed'};
 const readInputsChanged=digest(entries(priorBase,unit.readPaths))!==digest(entries(current,unit.readPaths));
 fs.mkdirSync(workspace);
 for(const name of unit.writePaths){const blob=output.get(name);if(!blob)continue;const file=path.join(workspace,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,blob.bytes,{flag:'wx',mode:blob.mode==='100755'?0o755:0o644});}
 const result=commitCandidate(target,workspace,commitIdentity);
 return {status:'candidate-imported',readInputsChanged,sourceBase:reference.base,sourceHead:reference.head,head:result.head,authority:'none; new verification and fresh review required'};
}
