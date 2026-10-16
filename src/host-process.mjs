/** Transport lifecycle only. Tool confinement and descendant ownership belong to the selected Host. */
import {spawn} from 'node:child_process';
import {setTimeout,clearTimeout} from 'node:timers';
export function runHostProcess(binary,args,{env,input='',timeout}){
 return new Promise((resolve,reject)=>{
  const script=/\.m?js$/i.test(binary);
  const p=spawn(script?process.execPath:binary,script?[binary,...args]:args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const out=[],err=[];let size=0,done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);p.stdin.destroy();p.kill();p.stdout.destroy();p.stderr.destroy();const result={stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()};if(error){Object.assign(error,result);reject(error);}else resolve(result);};
  const timer=setTimeout(()=>finish(Error('Host process deadline exceeded')),timeout);
  for(const [stream,chunks] of [[p.stdout,out],[p.stderr,err]])stream.on('data',b=>{size+=b.length;if(size>8*1024*1024)finish(Error('Host process output limit'));else chunks.push(b);});
  p.on('error',()=>finish(Error('Host executable could not start')));p.stdin.on('error',()=>finish(Error('Host input failed')));
  p.on('close',code=>finish(code===0?undefined:Error('Host process failed: '+code)));p.stdin.end(input);
 });
}
