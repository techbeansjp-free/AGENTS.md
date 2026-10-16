/** Explicit owner-selected Host transport; candidate code cannot select execution authority. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout,clearTimeout} from 'node:timers';
import {authorityCommandValidator,authorityCommandRootsValidator} from './authority-command.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
function validateHostCommand(controller,command,additionalRoots=[]){
 authorityCommandValidator(controller)(command);
 // Other registered worktrees are candidate code, not Host authority.
 const records=controller.git('worktree','list','--porcelain','-z').toString().split('\0');
 const roots=[...additionalRoots,...records.filter(r=>r.startsWith('worktree ')).map(r=>r.slice(9))];
 authorityCommandRootsValidator(roots)(command);
 return [...roots,...['--absolute-git-dir','--git-common-dir'].map(arg=>path.resolve(controller.repo,controller.git('rev-parse','--path-format=absolute',arg).toString().trim()))];
}

export function hostExecution(controller,configuration,authorityRoots=[]){
 if(configuration===undefined)return undefined;
 demand(configuration&&Object.keys(configuration).sort().join(',')==='command,protocol'&&configuration.protocol==='asc-host-execution/v1','Invalid Host execution configuration');
 validateHostCommand(controller,configuration.command,authorityRoots);
 const command=[...configuration.command];
 for(const [index,value] of command.entries())if(index===0||!value.startsWith('-'))demand(fs.statSync(value).isFile(),'Host command file missing');
 const temporaryRoot=fs.realpathSync(os.tmpdir());
 const env={PATH:path.dirname(command[0])+path.delimiter+path.dirname(process.execPath),TMPDIR:temporaryRoot,TEMP:temporaryRoot,TMP:temporaryRoot};
 // Host configuration is explicit; never forward credentials, SSH sockets, NODE_OPTIONS or shell startup state.
 if(process.platform==='win32')for(const name of ['SystemRoot','WINDIR'])if(process.env[name])env[name]=process.env[name];
 const invoke=(operation,payload,timeout,asynchronous)=>{
  demand(timeout===null||(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=2147483647),'Invalid Host execution timeout');
  const roots=validateHostCommand(controller,command,authorityRoots);
  const id=randomUUID(),message={schema:'asc-host-execution/v1',id,operation,payload,authorityRoots:roots};
  const input=JSON.stringify(message)+'\n';demand(Buffer.byteLength(input)<=8*1024*1024,'Host request limit exceeded');
  const decode=(code,stdout,stderr='')=>{
   if(code!==0)throw Object.assign(Error(`Host execution failed (exit=${code})`),{hostStderr:String(stderr).slice(-8192)});
   let response;try{response=JSON.parse(stdout);}catch{throw Error('Host response missing or invalid');}
   demand(response?.schema===message.schema&&response.id===id&&response.operation===operation,'Host response binding mismatch');
   demand(response.result&&typeof response.result==='object','Host result missing');return response.result;
  };
  const options={cwd:path.dirname(command[0]),env,windowsHide:true,maxBuffer:8*1024*1024};
  if(!asynchronous){const p=spawnSync(command[0],command.slice(1),{...options,input,timeout:timeout??0,killSignal:'SIGKILL'});demand(!p.error,'Host verification transport failed');return decode(p.status,p.stdout,p.stderr);}
  return new Promise((resolve,reject)=>{
   const p=spawn(command[0],command.slice(1),{...options,stdio:['pipe','pipe','pipe']});const output=[],errors=[];let bytes=0,settled=false;
   const finish=(error,code)=>{if(settled)return;settled=true;clearTimeout(timer);p.stdin.destroy();p.stdout.destroy();p.stderr.destroy();p.kill();if(error)reject(error);else{try{resolve(decode(code,Buffer.concat(output).toString(),Buffer.concat(errors).toString()));}catch(e){reject(e);}}};
   const timer=timeout===null?undefined:setTimeout(()=>finish(Object.assign(Error('Host execution deadline exceeded'),{code:'ASC_HOST_TRANSPORT_TIMEOUT'})),timeout);
   p.stdout.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024)finish(Error('Host output limit'));else output.push(b);});
   p.stderr.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024)finish(Error('Host output limit'));else errors.push(b);});
   p.on('error',()=>finish(Error('Host transport could not start')));p.stdin.on('error',()=>finish(Error('Host request failed')));
   p.on('close',code=>finish(undefined,code));p.stdin.end(input);
  });
 };
 return {
  agent:request=>invoke('agent',request,request.timeout??null,true),
  verify:request=>{
   try{
   const result=invoke('verify',request,request.timeout,false);
   demand(Number.isInteger(result.exit)&&result.exit>=0&&result.exit<=255&&typeof result.stdout==='string'&&typeof result.stderr==='string','Invalid Host verification result');
   return {status:result.exit,stdout:Buffer.from(result.stdout),stderr:Buffer.from(result.stderr)};
   }catch(cause){throw Object.assign(Error('Host verification could not execute: '+cause.message,{cause}),{code:'ASC_HOST_VERIFICATION_UNAVAILABLE',hostStderr:cause.hostStderr??''});}
  }
 };
}
