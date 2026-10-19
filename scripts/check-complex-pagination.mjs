/** Additional synthetic requirement counterexample, kept outside the fixed comparison fixture. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=process.argv[2];if(!root||process.argv.length!==3)throw Error('Expected synthetic complex source root');
const {ReservationService}=await import(pathToFileURL(path.resolve(root,'reservation/service.mjs')));
const {BillingService}=await import(pathToFileURL(path.resolve(root,'billing/service.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asc-pagination-'));let reservation,billing;
try{
 reservation=new ReservationService(path.join(dir,'reservation.sqlite'));billing=new BillingService(path.join(dir,'billing.sqlite'));
 const actor={tenant:'alpha',role:'admin'},reader={tenant:'alpha',role:'reader'},other={tenant:'beta',role:'reader'};
 reservation.seed(actor,{sku:'seat',available:2,unitCents:25});const event=reservation.reserve(actor,{key:'r1',sku:'seat',quantity:1});billing.issue(actor,{key:'b1',event});
 for(const service of [reservation,billing]){
  for(const pageSize of [1,2,50]){
   assert.deepEqual(service.list(reader,{page:Number.MAX_SAFE_INTEGER,pageSize}),{items:[],total:1});
   assert.deepEqual(service.list(other,{page:Number.MAX_SAFE_INTEGER,pageSize}),{items:[],total:0});
  }
  assert.equal(service.list(reader,{page:1,pageSize:50}).items.length,1);
 }
 console.log(JSON.stringify({passed:true,scenario:'Maximum safe page with valid page sizes, tenant isolation and unchanged ordinary listing'}));
}finally{reservation?.close();billing?.close();fs.rmSync(dir,{recursive:true,force:true});}
