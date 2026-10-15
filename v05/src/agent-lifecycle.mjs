/** Transient provider lifetime only. Tool permissions remain the provider's sandbox. */
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout,clearTimeout} from 'node:timers';
import {StringDecoder} from 'node:string_decoder';
import {performance} from 'node:perf_hooks';

const supervisor=fileURLToPath(new URL('./agent-lifecycle-supervisor.mjs',import.meta.url));
const managerEnvironment=()=>({PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`});
export function runServiceProcess(executable,argv,{env,input,timeout}){
 if(process.platform!=='linux'||typeof process.getuid!=='function')throw Error('Agent lifecycle requires Linux user services');
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>360000)throw Error('Invalid Agent deadline');
 if(typeof executable!=='string'||!executable.startsWith('/')||!Array.isArray(argv)||argv.some(v=>typeof v!=='string')||typeof input!=='string'||!env||Object.values(env).some(v=>typeof v!=='string'))throw Error('Invalid provider request');
 const request=JSON.stringify({executable,argv,env,input});
 if(Buffer.byteLength(request)>8*1024*1024)throw Error('Provider request limit exceeded');
 const deadline=performance.now()+timeout;
 const unit=`asc-agent-${randomUUID()}.service`,managerEnv=managerEnvironment();
 const control=(args,limit=5000)=>spawnSync('/usr/bin/systemctl',['--user',...args],{env:managerEnv,encoding:'utf8',timeout:limit,maxBuffer:65536});
 const probe=control(['show','--property=Version'],Math.min(5000,timeout));
 if(probe.error||probe.status!==0)throw Error('Agent lifecycle user service unavailable');
 const remaining=Math.ceil(deadline-performance.now());
 if(remaining<=0)throw Error('Agent deadline exceeded');
 return new Promise((resolve,reject)=>{
  // No source, prompt, token or provider environment is placed in process argv or journal.
  // stdin is a private request/lifetime pipe: leave its writer open until completion.
  const p=spawn('/usr/bin/systemd-run',['--user','--quiet','--wait','--pipe',`--unit=${unit}`,'--service-type=exec','--working-directory=/',
   '--property=KillMode=control-group','--property=ExitType=main','--property=Restart=no','--property=TimeoutStopSec=1s',
   `--property=RuntimeMaxSec=${Math.ceil(remaining/1000)+2}s`,process.execPath,supervisor],{env:managerEnv,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',outBytes=0,errBytes=0,settled=false;
  const out=new StringDecoder('utf8'),err=new StringDecoder('utf8');
  const finish=error=>{
   if(settled)return;settled=true;clearTimeout(timer);
   p.stdin.destroy();
   // Only our random invocation service is stopped; no session/global failure state.
   const stopped=control(['stop',unit]);
   control(['reset-failed',unit]);
   const state=control(['show',unit,'--property=ActiveState','--property=SubState']);
   const gone=!state.error&&state.status===0&&/^ActiveState=inactive$/m.test(state.stdout)&&/^SubState=dead$/m.test(state.stdout);
   if(!gone)error=Error('Agent lifecycle cleanup unconfirmed');
   if(stopped.error)error=Error('Agent lifecycle stop failed');
   p.kill('SIGKILL');p.stdout.destroy();p.stderr.destroy();
   stdout+=out.end();stderr+=err.end();
   if(error)reject(Object.assign(error,{stdout,stderr}));else resolve({stdout,stderr});
  };
  const timer=setTimeout(()=>finish(Error('Agent deadline exceeded')),remaining);
  p.stdout.on('data',data=>{if(settled)return;outBytes+=data.length;if(outBytes>8*1024*1024){finish(Error('Agent output limit exceeded'));return;}stdout+=out.write(data);});
  p.stderr.on('data',data=>{if(settled)return;errBytes+=data.length;if(errBytes>1048576){finish(Error('Agent error output limit exceeded'));return;}stderr+=err.write(data);});
  p.once('error',()=>finish(Error('Agent lifecycle launch failed')));
  p.stdin.on('error',()=>finish(Error('Agent lifecycle request pipe failed')));
  p.once('close',code=>finish(code===0?undefined:Error('Fresh Agent failed')));
  p.stdin.write(request+'\n');
 });
}
