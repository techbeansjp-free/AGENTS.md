import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {setTimeout} from 'node:timers/promises';
import {interruptSavedAttempt,readInterruptionEvidence} from '../scripts/native-interrupted-attempt.mjs';
test('synthetic interruption preserves edits, stops setsid children, and rejects pre-edit exit',async t=>{
 if(process.platform!=='linux'){t.skip('Linux-only fault-injection fixture');return;}
 const env={PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
 if(spawnSync('/usr/bin/systemctl',['--user','show','--property=Version'],{env}).status!==0){t.skip('User service unavailable');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-native-interrupt-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'service.mjs'),beat=path.join(root,'heartbeat');fs.writeFileSync(file,'original');
 const worker=`const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(beat)},'x'),10);`;
 const code=`const fs=require('fs');require('child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}],{detached:true,stdio:'ignore'});setTimeout(()=>fs.writeFileSync(${JSON.stringify(file)},'saved unfinished work'),200);setInterval(()=>{},1000);`;
 const result=await interruptSavedAttempt({directory:path.join(root,'interrupted'),executable:process.execPath,argv:['-e',code],env,input:'',files:[file]});
 assert.equal(result.checkpoint,true);assert.equal(result.stopped,true);assert.equal(fs.readFileSync(file,'utf8'),'saved unfinished work');const before=fs.readFileSync(beat,'utf8');await setTimeout(100);assert.equal(fs.readFileSync(beat,'utf8'),before);
 await assert.rejects(interruptSavedAttempt({directory:path.join(root,'early'),executable:process.execPath,argv:['-e','process.exit(0)'],env,input:'',files:[file]}),/No verified/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'early/result.json'))).checkpoint,false);
});

test('required interruption evidence cannot fall back to a normal trial when missing',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-required-interruption-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(readInterruptionEvidence(root,false),null);assert.throws(()=>readInterruptionEvidence(root,true),/ENOENT/);
 const dir=path.join(root,'interrupted-attempt');fs.mkdirSync(dir);const checkpoint={checkpoint:true,stopped:true,interrupted:true,signalSent:true,seconds:1};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(checkpoint));
 assert.throws(()=>readInterruptionEvidence(root,true),/ENOENT/);fs.writeFileSync(path.join(dir,'usage.json'),JSON.stringify({complete:false,observation:{observedProcessedTokens:null}}));assert.equal(readInterruptionEvidence(root,true).checkpoint.seconds,1);
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({...checkpoint,stopped:false}));assert.throws(()=>readInterruptionEvidence(root,true),/invalid/);
});
