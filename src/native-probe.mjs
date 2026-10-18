/** Model-free native sandbox diagnostics. Results never authorize a development run. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout,clearTimeout} from 'node:timers';
import {performance} from 'node:perf_hooks';
import {codexRuntimeRoots,nodeRuntimeRoots} from './codex-runtime.mjs';

export function probeVerdict({positive,negative,hostUnchanged,connections}) {
 return positive?.completed===true && positive.read==='allowed' && positive.write==='allowed' && positive.network==='connected' &&
  negative?.completed===true && negative.read==='denied' && ['denied','private-copy'].includes(negative.write) && negative.network==='denied' &&
  hostUnchanged===true && connections.positive===1 && connections.negative===0;
}

// Only fixed host-authored Node code is launched here, never candidate scripts or model output.
const diagnostic=`const fs=require('node:fs'),net=require('node:net');
const [file,port]=process.argv.slice(1);let read='denied',write='denied';
try{fs.readFileSync(file);read='allowed';}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
try{fs.writeFileSync(file,'probe');write='allowed';}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
const s=net.connect({host:'127.0.0.1',port:Number(port)});let done=false;
function finish(network){if(done)return;done=true;s.destroy();fs.writeSync(1,JSON.stringify({completed:true,read,write,network})+'\\n');}
s.setTimeout(2000,()=>finish('timeout'));s.on('connect',()=>finish('connected'));s.on('error',e=>finish(['EPERM','EACCES','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','ENETDOWN'].includes(e.code)?'denied':'error:'+e.code));`;

function run(binary,args,env,cwd) {
 return new Promise((resolve,reject)=>{
  const script=/\.m?js$/i.test(binary);
  const p=spawn(script?process.execPath:binary,script?[binary,...args]:args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true});let output='',errors='',size=0,done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);p.stdin.destroy();p.kill();p.stdout.destroy();p.stderr.destroy();if(error)reject(error);else if(!output.trim())reject(Error(`Native diagnostic produced no observation: ${errors.slice(-2048)}`));else resolve(output);};
  const timer=setTimeout(()=>finish(Error('Native diagnostic timed out')),15000);
  p.stdout.on('data',b=>{size+=b.length;if(size>65536)finish(Error('Native diagnostic output limit'));else output+=b.toString();});
  p.stderr.on('data',b=>{size+=b.length;if(size>65536)finish(Error('Native diagnostic output limit'));else errors+=b.toString();});
  p.on('error',()=>finish(Error('Native diagnostic executable could not start')));
  p.on('close',code=>finish(code===0?undefined:Error(`Native diagnostic command failed (exit=${code}): ${errors.slice(-2048)}`)));
 });
}

export async function probeNativeSandbox(executable) {
 if(!path.isAbsolute(executable)||!fs.statSync(executable).isFile())throw Error('Absolute native Codex executable required (not a shell command)');
 const binary=fs.realpathSync(executable),node=fs.realpathSync(process.execPath);
 if(/\.(cmd|bat)$/i.test(binary))throw Error('Use the native codex.exe or npm package bin/codex.js, not a command shell wrapper');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-native-probe-'));
 const workspace=path.join(root,'workspace'),sentinel=path.join(root,'host-dummy');
 fs.mkdirSync(workspace);fs.writeFileSync(sentinel,'trusted',{mode:0o600});
 const env={};
 // Deliberately omit credentials, sockets and the developer's PATH.
 for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.platform==='win32'&&process.env[key])env[key]=process.env[key];
 env.PATH=[path.dirname(node),...(process.platform==='win32'?[path.join(process.env.SystemRoot??'C:\\Windows','System32')]:['/usr/bin','/bin'])].join(path.delimiter);
 Object.assign(env,{HOME:workspace,USERPROFILE:workspace,CODEX_HOME:workspace,TMPDIR:workspace,TEMP:workspace,TMP:workspace});
 const roots=codexRuntimeRoots(binary);
 if(roots.some(r=>path.parse(r).root===r)){fs.rmSync(root,{recursive:true,force:true});throw Error('Codex runtime root is too broad');}
 const permissions={':root':'deny',':minimal':'read',...Object.fromEntries(nodeRuntimeRoots().map(p=>[p,'read'])),...Object.fromEntries(roots.map(r=>[r,'read'])),[node]:'read',[workspace]:'write'};
 const table='{ '+Object.entries(permissions).map(([k,v])=>JSON.stringify(k)+'='+JSON.stringify(v)).join(', ')+' }';
 const options=['-c',`permissions.asc_native_probe.filesystem=${table}`,'-c','permissions.asc_native_probe.network.enabled=false'];
 const server=net.createServer(s=>{connections++;s.end();});let connections=0;
 const started=performance.now();
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const argv=['-e',diagnostic,sentinel,String(server.address().port)];
  const positiveRaw=await run(node,argv,env,workspace);
  if(!positiveRaw.trim())throw Error('Native positive control produced no observation');
  const positive=JSON.parse(positiveRaw);const positiveConnections=connections;
  fs.writeFileSync(sentinel,'trusted');
  const negativeRaw=await run(binary,['sandbox','-P','asc_native_probe',...options,'-C',workspace,'--',node,...argv],env,workspace);
  if(!negativeRaw.trim())throw Error('Native sandbox produced no observation');
  const negative=JSON.parse(negativeRaw);
  const hostUnchanged=fs.readFileSync(sentinel,'utf8')==='trusted';
  if(negative.write==='allowed'&&negative.read==='denied'&&hostUnchanged)negative.write='private-copy';
  const observations={positive,negative,hostUnchanged,connections:{positive:positiveConnections,negative:connections-positiveConnections}};
  return {schema:'asc-native-probe/v1',platform:process.platform,modelCalls:0,seconds:(performance.now()-started)/1000,
   passed:probeVerdict(observations),observations,executionAuthorized:false,
   scope:'Fixed dummy filesystem and loopback probe only; not Agent lifecycle or development E2E acceptance'};
 }finally{
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(root,{recursive:true,force:true});
 }
}
