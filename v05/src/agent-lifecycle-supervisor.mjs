/** Trusted transient-service main process. Not an Agent tool or persistent daemon. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

let buffer=Buffer.alloc(0),started=false,child;
const fail=label=>{fs.writeSync(2,`ASC_LIFECYCLE:${label}\n`);process.exit(125);};
// Private stdin writer belongs exclusively to the Controller. EOF includes SIGKILL.
// Service main exit causes systemd to kill all descendants, including setsid children.
process.stdin.on('end',()=>fail('controller-eof'));process.stdin.on('error',()=>fail('controller-pipe-error'));
process.stdin.on('data',chunk=>{
 if(started) return fail('request-after-start');
 buffer=Buffer.concat([buffer,chunk]);if(buffer.length>8*1024*1024+1)return fail('request-invalid');
 const end=buffer.indexOf(10);if(end<0)return;
 if(end!==buffer.length-1)return fail('request-invalid');
 let request;
 try{
  request=JSON.parse(buffer.subarray(0,end));buffer=Buffer.alloc(0);
  if(typeof request.executable!=='string'||!path.isAbsolute(request.executable)||!Array.isArray(request.argv)||request.argv.some(v=>typeof v!=='string')||typeof request.input!=='string'||!request.env||Object.values(request.env).some(v=>typeof v!=='string'))return fail('request-invalid');
  // A user service must be a real exclusive cgroup, never a plain-process fallback.
  const relative=fs.readFileSync('/proc/self/cgroup','utf8').trim().match(/^0::(\/[^\n]+)$/)?.[1];
  if(!relative||!/^asc-agent-[a-f0-9-]+\.service$/.test(path.basename(relative)))return fail('cgroup-name');
  const processes=fs.readFileSync(path.join('/sys/fs/cgroup',relative,'cgroup.procs'),'utf8').trim().split(/\s+/).map(Number);
  if(processes.length!==1||processes[0]!==process.pid)return fail('cgroup-not-exclusive');
  started=true;
  // No payload means no stdin write: an empty end() can race a fast child's exit
  // and produce EPIPE despite successful execution. Real prompt write errors remain fatal.
  child=spawn(request.executable,request.argv,{env:request.env,stdio:[request.input===''?'ignore':'pipe',1,2]});
  child.once('error',()=>fail('provider-spawn'));child.stdin?.on('error',()=>fail('provider-input'));
  child.once('exit',(code,signal)=>{
   const status=Number.isInteger(code)&&code>=0&&code<=255?code:125;
   if(status!==0)fs.writeSync(2,`ASC_LIFECYCLE:provider-exit code=${status} signal=${signal??'none'}\n`);
   process.exit(status);
  });
  child.stdin?.end(request.input);
 }catch{fail('supervisor-exception');}
});
