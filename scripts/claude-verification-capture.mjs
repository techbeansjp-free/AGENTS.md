/** Evaluation-only framing. Does not implement, repair or approve project changes. */
export function verificationCaptureSource({cli,repo,base,owner,marker,output,projectObserver}){
 if(!/^[a-f0-9]{32}$/.test(marker))throw Error('Invalid verification capture marker');
 if(projectObserver){
  if(output)throw Error('Project command observation does not use product output files');
  return `import {observeProjectVerification} from ${JSON.stringify(projectObserver)};
let result;
try { const value=observeProjectVerification(${JSON.stringify({repo,base,owner})});result={status:value.passed?0:1,error:null,stdout:JSON.stringify(value),stderr:''}; }
catch(error){result={status:1,error:'PROJECT_VERIFICATION_FAILED',stdout:'',stderr:String(error.message)};}
process.stdout.write('\\nASC_VERIFY_${marker}_BEGIN\\n'+JSON.stringify(result)+'\\nASC_VERIFY_${marker}_END\\n');
process.exitCode=result.status;
`;
 }

 return `import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const argv=${JSON.stringify([cli,'worktree-verify',repo,base,owner])};
${output?`argv.push('--output',${JSON.stringify(output)}+'-'+randomUUID()+'.json');`:''}
const p=spawnSync(process.execPath,argv,{encoding:'utf8',maxBuffer:16*1024*1024});
const result={status:p.status,error:p.error?.code??null,stdout:p.stdout??'',stderr:p.stderr??''};
process.stdout.write('\\nASC_VERIFY_${marker}_BEGIN\\n'+JSON.stringify(result)+'\\nASC_VERIFY_${marker}_END\\n');
process.exitCode=p.error||p.status!==0?1:0;
`;
}
export function capturedVerification(content,marker){
 // Hosts may trim the leading newline; keep marker matching at a line boundary.
 content='\n'+content;
 const begin=`\nASC_VERIFY_${marker}_BEGIN\n`,end=`\nASC_VERIFY_${marker}_END`;
 if(content.split(begin).length!==2||content.split(end).length!==2)return null;
 const start=content.indexOf(begin)+begin.length,stop=content.indexOf(end);
 if(stop<start)return null;
 try{const value=JSON.parse(content.slice(start,stop));return value.status===0&&value.error===null&&typeof value.stdout==='string'?value.stdout:null;}catch{return null;}
}
