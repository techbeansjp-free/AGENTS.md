import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]);
const {ReservationService}=await import(pathToFileURL(path.join(root,'reservation/service.mjs')));
const {BillingService}=await import(pathToFileURL(path.join(root,'billing/service.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'complex-unknown-keys-'));
const actor={tenant:'alpha',role:'admin'};let r,b;
try{
 r=new ReservationService(path.join(dir,'state.sqlite'));b=new BillingService(path.join(dir,'state.sqlite'));
 r.seed(actor,{sku:'seat',available:10,unitCents:25});
 for(const key of ['hidden',Symbol('unknown')]){
  const input={key:'reservation',sku:'seat',quantity:1};Object.defineProperty(input,key,{value:true});
  assert.throws(()=>r.reserve(actor,input),e=>e.code==='VALIDATION');assert.equal(r.inventory(actor,'seat').available,10);
 }
 const event=r.reserve(actor,{key:'reservation',sku:'seat',quantity:1});
 for(const key of ['hidden',Symbol('unknown')]){
  const invalid={...event};Object.defineProperty(invalid,key,{value:true});
  assert.throws(()=>b.issue(actor,{key:'invoice',event:invalid}),e=>e.code==='VALIDATION');assert.equal(b.list(actor,{page:1,pageSize:10}).total,0);
 }
 assert.equal(b.issue(actor,{key:'invoice',event}).amountCents,25);
 console.log('unknown own keys rejected without consuming state or idempotency keys');
}finally{r?.close();b?.close();fs.rmSync(dir,{recursive:true,force:true});}
