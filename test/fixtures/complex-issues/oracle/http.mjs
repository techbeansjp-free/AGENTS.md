/** Real HTTP/persistence oracle; never supplies an implementation. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import readline from 'node:readline';
const root=path.resolve(process.argv[2]),dir=fs.mkdtempSync(path.join(os.tmpdir(),'asc-system-http-'));
let server,origin;
async function start(){
 server=spawn(process.execPath,[path.join(root,'web/server.mjs')],{env:{...process.env,PORT:'0',DATA_FILE:path.join(dir,'state.sqlite')},stdio:['ignore','pipe','inherit']});
 const lines=readline.createInterface({input:server.stdout});
 const port=await new Promise((resolve,reject)=>{server.once('error',reject);server.once('exit',code=>reject(Error('Server exited before ready: '+code)));lines.once('line',line=>{try{const v=JSON.parse(line);assert.ok(Number.isInteger(v.port)&&v.port>0&&v.port<=65535);resolve(v.port);}catch(e){reject(e);}});});
 lines.close();origin='http://127.0.0.1:'+port;
}
async function stop(){if(server&&server.exitCode===null&&server.signalCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}server=undefined;}
async function call(method,route,body,session='alpha-admin',status=200){
 const response=await globalThis.fetch(origin+route,{method,headers:{'content-type':'application/json',...(session?{'x-fixture-session':session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal(response.status,status,`${method} ${route}`);const value=await response.json();
 if(status>=400){assert.equal(typeof value.code,'string');assert.ok(typeof value.message==='string'&&value.message.trim());}
 return value;
}
try{
 await start();
 await call('GET','/api/reservations',undefined,null,401);
 await call('POST','/api/reservations/seed',{sku:'seat',available:10,unitCents:25});
 for(const body of [null,[],{key:'bad',sku:'seat',quantity:'1'},{key:'bad',sku:'seat',quantity:1,tenant:'beta'},{key:'bad',sku:'seat',quantity:0}])await call('POST','/api/reservations',body,'alpha-admin',400);
 await call('POST','/api/reservations',{key:'reader',sku:'seat',quantity:1},'alpha-reader',403);
 const first=await call('POST','/api/reservations',{key:'first',sku:'seat',quantity:2},'alpha-admin',201);
 assert.deepEqual(await call('POST','/api/reservations',{key:'first',sku:'seat',quantity:2},'alpha-admin',201),first);
 for(const key of ['second','third'])await call('POST','/api/reservations',{key,sku:'seat',quantity:1},'alpha-admin',201);
 assert.equal((await call('GET','/api/inventory?sku=seat')).available,6);
 const page=await call('GET','/api/reservations?page=2&pageSize=2',undefined,'alpha-reader');assert.equal(page.total,3);assert.equal(page.items.length,1);
 await call('GET','/api/reservations?page=0',undefined,'alpha-admin',400);
 await call('GET','/api/reservations/'+encodeURIComponent(first.id),undefined,'beta-admin',404);
 await call('POST','/api/invoices',{key:'forged',event:first},'alpha-admin',400);
 await call('POST','/api/invoices',{key:'cross',reservationId:first.id},'beta-admin',404);
 const invoice=await call('POST','/api/invoices',{key:'issue',reservationId:first.id},'alpha-admin',201);
 assert.equal(invoice.reservationId,first.id);assert.equal(invoice.amountCents,50);
 const endpoint='/api/invoices/'+encodeURIComponent(invoice.id);
 const paid=await call('POST',endpoint+'/pay',{key:'pay',expectedVersion:1});assert.equal(paid.status,'paid');
 await call('POST',endpoint+'/refund',{key:'stale',expectedVersion:1},'alpha-admin',409);
 assert.deepEqual(await call('GET',endpoint),paid);
 const refunded=await call('POST',endpoint+'/refund',{key:'refund',expectedVersion:2});assert.equal(refunded.status,'refunded');
 const canceled=await call('POST','/api/reservations/'+encodeURIComponent(first.id)+'/cancel',{key:'cancel',expectedVersion:1});assert.equal(canceled.status,'canceled');
 assert.equal((await call('GET','/api/inventory?sku=seat')).available,8);
 await stop();await start();
 assert.deepEqual(await call('GET',endpoint),refunded);
 assert.deepEqual(await call('POST',endpoint+'/pay',{key:'pay',expectedVersion:1}),paid);
 assert.deepEqual(await call('POST','/api/reservations',{key:'first',sku:'seat',quantity:2},'alpha-admin',201),first);
 assert.equal((await call('GET','/api/inventory?sku=seat')).available,8);
 console.log('HTTP journeys, rejection invariants and restart persistence passed');
}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
