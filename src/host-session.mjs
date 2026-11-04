/** Read-only, named Host sessions. Result artifacts are independent of display-name updates. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout,clearTimeout} from 'node:timers';
import {sessionRpc} from './session-rpc.mjs';

export function sessionOptions(args){
 const options={ephemeral:false,timeout:900000},seen=new Set();
 const names={'--name':'name','--model':'model','--rename-model':'renameModel','--executable':'executable','--prompt-file':'promptFile','--output-dir':'outputDir','--timeout-ms':'timeout'};
 [options.host,options.cwd]=args;
 for(let i=2;i<args.length;i++){
  if(args[i]==='--ephemeral'&&!options.ephemeral){options.ephemeral=true;continue;}
  const key=names[args[i]];
  if(!key||args[i+1]===undefined||seen.has(key))throw Error('Invalid or duplicate host-session option');
  seen.add(key);options[key]=args[++i];
 }
 if(!['claude','codex'].includes(options.host))throw Error('Host must be claude or codex');
 for(const key of ['cwd','name','model','promptFile','outputDir'])if(typeof options[key]!=='string'||!options[key].trim())throw Error(`Missing host-session ${key}`);
 if(/[\r\n\x00]/.test(options.name)||options.name.length>200)throw Error('Session name must be one line, at most 200 characters');
 options.timeout=Number(options.timeout);
 if(!Number.isSafeInteger(options.timeout)||options.timeout<100||options.timeout>86400000)throw Error('Invalid timeout-ms');
 if(options.renameModel!==undefined&&(options.host!=='claude'||!options.renameModel.trim()))throw Error('rename-model requires Claude and a model');
 options.executable??=options.host;
 return options;
}

function command(executable,args,{cwd,input,timeout,out,err}){
 return new Promise(resolve=>{
  const child=spawn(executable,args,{cwd,stdio:['pipe','pipe','pipe']});let error;
  const timer=setTimeout(()=>{error='Host command timeout';child.kill('SIGKILL');},timeout);
  child.stdout.on('data',out);child.stderr.on('data',err);
  child.on('error',e=>{error=e.message;});child.stdin.on('error',e=>{error??=e.message;});
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,error});});child.stdin.end(input);
 });
}

export async function runHostSession(options){
 const {host,model,ephemeral,timeout,executable}=options;
 const cwd=fs.realpathSync(options.cwd);if(!fs.statSync(cwd).isDirectory())throw Error('Expected project directory');
 const prompt=fs.readFileSync(options.promptFile,'utf8');if(!prompt.trim())throw Error('Empty session prompt');
 const outputDir=path.resolve(options.outputDir);
 // A new private directory prevents overwriting another run, symlinks, or review results.
 fs.mkdirSync(outputDir,{mode:0o700});
 const files={};for(const name of ['events.jsonl','stderr.txt','result.txt','rename.stdout','rename.stderr'])files[name]=fs.openSync(path.join(outputDir,name),'wx',0o600);
 const write=(name,data)=>fs.writeSync(files[name],data);
 const state={schema:'asc-host-session/v1',host,cwd,model,ephemeral,name:`自動: ${options.name}`,sessionId:null,status:'running',naming:ephemeral?'not-persisted':'pending',outputDir,startedAt:new Date().toISOString()};
 const save=()=>fs.writeFileSync(path.join(outputDir,'status.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});
 save();let rpc;
 try{
  if(host==='claude'){
   state.sessionId=randomUUID();save();
   const args=['-p','--model',model,'--output-format','json','--permission-mode','dontAsk','--tools','Read,Glob,Grep','--allowedTools','Read,Glob,Grep','--strict-mcp-config','--session-id',state.sessionId];
   if(ephemeral)args.push('--no-session-persistence');else args.push('-n',state.name);
   const result=await command(executable,args,{cwd,input:prompt,timeout,out:b=>write('events.jsonl',b),err:b=>write('stderr.txt',b)});
   state.process=result;
   if(result.error||result.code!==0)throw Error(result.error??`Claude exited ${result.code}`);
   const response=JSON.parse(fs.readFileSync(path.join(outputDir,'events.jsonl'),'utf8'));
   if(response.session_id!==state.sessionId||response.is_error||response.type!=='result'||typeof response.result!=='string'||!response.result.trim())throw Error('Claude did not return a successful session result');
   write('result.txt',response.result+'\n');state.status='completed';state.naming=ephemeral?'not-persisted':'started';save();
   if(!ephemeral){
    const renamed=await command(executable,['-p','--resume',state.sessionId,'-n',`済: ${state.name}`,'--model',options.renameModel??model,'--max-turns','1','--tools','','--allowedTools','','--permission-mode','dontAsk','--strict-mcp-config'],{cwd,input:'Reply OK only. Do not use tools.',timeout:Math.min(timeout,60000),out:b=>write('rename.stdout',b),err:b=>write('rename.stderr',b)});
    state.rename=renamed;state.naming=!renamed.error&&renamed.code===0?'completed':'failed';
   }
  }else{
   rpc=sessionRpc(executable,cwd,{timeout,record:line=>{
    write('events.jsonl',line);
    const message=JSON.parse(line),item=message.params?.item;
    if(message.method==='item/completed'&&message.params?.threadId===state.sessionId&&item?.type==='agentMessage'&&typeof item.text==='string')write('result.txt',item.text+'\n');
   },stderr:b=>write('stderr.txt',b)});
   await rpc.initialize();
   const response=await rpc.call('thread/start',{cwd,model,ephemeral,approvalPolicy:'never',sandbox:'read-only'});
   state.sessionId=response.thread?.id;if(typeof state.sessionId!=='string'||!state.sessionId)throw Error('Missing Codex thread ID');save();
   if(!ephemeral){await rpc.call('thread/name/set',{threadId:state.sessionId,name:state.name});state.naming='started';save();}
   const started=await rpc.call('turn/start',{threadId:state.sessionId,input:[{type:'text',text:prompt}],approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}});
   const completed=await rpc.wait(message=>message.method==='turn/completed'&&message.params?.threadId===state.sessionId&&message.params?.turn?.id===started.turn.id);
   if(completed.params.turn.status!=='completed')throw Error(`Codex turn ${completed.params.turn.status}`);
   if(!fs.readFileSync(path.join(outputDir,'result.txt'),'utf8').trim())throw Error('Codex returned no response');
   state.status='completed';save();
   if(!ephemeral){try{await rpc.call('thread/name/set',{threadId:state.sessionId,name:`済: ${state.name}`});state.naming='completed';}catch(error){state.naming='failed';state.renameError=error.message;}}
  }
 }catch(error){state.status='failed';state.error=error.message;}
 finally{await rpc?.close();state.finishedAt=new Date().toISOString();save();for(const fd of Object.values(files))fs.closeSync(fd);}
 return state;
}
