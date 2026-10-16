import {test} from 'node:test';import assert from 'node:assert/strict';
import {runHostProcess} from '../src/host-process.mjs';
test('native Host transport handles output, failure and timeout without a shell',async()=>{
 const run=(code,timeout=3000)=>runHostProcess(process.execPath,['-e',code],{env:{},input:'',timeout});
 assert.equal((await run("process.stdout.write('日本語')")).stdout,'日本語');
 await assert.rejects(run('process.exit(3)'),/failed: 3/);
 await assert.rejects(run('setInterval(()=>{},1000)',100),/deadline/);
});


test('unspecified Host time budget does not create an immediate deadline',async()=>{
 const result=await runHostProcess(process.execPath,['-e','setTimeout(()=>console.log("completed"),30)'],{env:{},input:''});
 assert.equal(result.stdout.trim(),'completed');
});
