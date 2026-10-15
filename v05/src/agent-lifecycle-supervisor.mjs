/** Trusted transient-service main process. Not an Agent tool or persistent daemon. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

let buffer=Buffer.alloc(0),started=false,child;
const fail=()=>process.exit(125);
// Private stdin writer belongs exclusively to the Controller. EOF includes SIGKILL.
// Service main exit causes systemd to kill all descendants, including setsid children.
process.stdin.on('end',fail);process.stdin.on('error',fail);
process.stdin.on('data',chunk=>{
 if(started) return fail();
 buffer=Buffer.concat([buffer,chunk]);if(buffer.length>8*1024*1024+1)return fail();
 const end=buffer.indexOf(10);if(end<0)return;
 if(end!==buffer.length-1)return fail();
 let request;
 try{
  request=JSON.parse(buffer.subarray(0,end));buffer=Buffer.alloc(0);
  if(typeof request.executable!=='string'||!path.isAbsolute(request.executable)||!Array.isArray(request.argv)||request.argv.some(v=>typeof v!=='string')||typeof request.input!=='string'||!request.env||Object.values(request.env).some(v=>typeof v!=='string'))return fail();
  // A user service must be a real exclusive cgroup, never a plain-process fallback.
  const relative=fs.readFileSync('/proc/self/cgroup','utf8').trim().match(/^0::(\/[^\n]+)$/)?.[1];
  if(!relative||!/^asc-agent-[a-f0-9-]+\.service$/.test(path.basename(relative)))return fail();
  const processes=fs.readFileSync(path.join('/sys/fs/cgroup',relative,'cgroup.procs'),'utf8').trim().split(/\s+/).map(Number);
  if(processes.length!==1||processes[0]!==process.pid)return fail();
  started=true;
  child=spawn(request.executable,request.argv,{env:request.env,stdio:['pipe',1,2]});
  child.once('error',fail);child.stdin.on('error',fail);
  child.once('exit',code=>process.exit(Number.isInteger(code)&&code>=0&&code<=255?code:125));
  child.stdin.end(request.input);
 }catch{fail();}
});
