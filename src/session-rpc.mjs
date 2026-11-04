/** Small stdio client for the public Codex app-server protocol. No session-store access. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout,clearTimeout} from 'node:timers';

export function sessionRpc(executable,cwd,{env,record,stderr,timeout}){
 const child=spawn(executable,['app-server'],{cwd,env,stdio:['pipe','pipe','pipe']});
 const pending=new Map(),events=[];let nextId=0,failure,waiter;
 const closed=new Promise(resolve=>child.once('close',resolve));
 const fail=error=>{failure??=error;for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(failure);}pending.clear();if(waiter){clearTimeout(waiter.timer);waiter.reject(failure);waiter=null;}};
 const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
 const lines=createInterface({input:child.stdout});
 child.stderr.on('data',stderr);
 child.on('error',fail);child.stdin.on('error',fail);
 child.on('close',()=>fail(Error('Codex app-server closed')));
 lines.on('line',line=>{
  try{
   record(line+'\n');const message=JSON.parse(line);
   if(message.method&&Object.hasOwn(message,'id')){
    // This unattended reader never grants server-initiated approvals or tools.
    send({id:message.id,error:{code:-32601,message:'ASC session does not accept server requests'}});return;
   }
   if(Object.hasOwn(message,'id')){
    const call=pending.get(message.id);if(!call)return;
    pending.delete(message.id);clearTimeout(call.timer);
    if(message.error)call.reject(Error(message.error.message??'Codex RPC failed'));else call.resolve(message.result);
   }else if(message.method){
    if(waiter&&waiter.match(message)){const current=waiter;waiter=null;clearTimeout(current.timer);current.resolve(message);}
    else if(message.method==='turn/completed')events.push(message);
   }
  }catch(error){fail(error);child.kill();}
 });
 return {
  async initialize(){await this.call('initialize',{clientInfo:{name:'asc_session',version:'0.5.0'}});send({method:'initialized',params:{}});},
  call(method,params){
   if(failure)return Promise.reject(failure);
   const id=++nextId;
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Codex RPC timeout: ${method}`));},Math.min(timeout,60000));pending.set(id,{resolve,reject,timer});send({id,method,params});});
  },
  wait(match){
   const index=events.findIndex(match);if(index>=0)return Promise.resolve(events.splice(index,1)[0]);
   if(failure)return Promise.reject(failure);
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiter=null;reject(Error('Codex turn timeout'));},timeout);waiter={match,resolve,reject,timer};});
  },
  async close(){
   fail(Error('ASC transport closed'));child.stdin.destroy();child.kill();
   const timer=setTimeout(()=>child.kill('SIGKILL'),1000);
   try{await closed;}finally{clearTimeout(timer);lines.close();}
  }
 };
}
