/** Post-trial counterexample: not part of the frozen comparison fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.argv.length!==3)throw Error('Expected synthetic complex source directory');
const {ReservationService}=await import(pathToFileURL(path.resolve(process.argv[2],'reservation/service.mjs')));
const actor={tenant:'alpha',role:'admin'};
for(const validReads of [1,2,3,4]){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-reservation-accessor-'));
 let service;
 try{
  service=new ReservationService(path.join(temp,'state.sqlite'));
  service.seed(actor,{sku:'seat',available:10,unitCents:25});
  let reads=0,result,error;
  try{result=service.reserve(actor,{key:'changing-quantity',sku:'seat',get quantity(){return ++reads<=validReads?2:-1;}});}catch(e){error=e;}
  if(error){
   assert.equal(error.code,'VALIDATION');
   assert.equal(service.inventory(actor,'seat').available,10,'Rejected input altered inventory');
   assert.deepEqual(service.list(actor,{page:1,pageSize:10}),{items:[],total:0});
   result=service.reserve(actor,{key:'changing-quantity',sku:'seat',quantity:2});
  }
  const persisted=service.get(actor,result.id);
  assert.equal(persisted.quantity,2,'Unvalidated reservation quantity persisted');
  assert.equal(persisted.amountCents,50);
  assert.equal(service.inventory(actor,'seat').available,8,'Reservation corrupted inventory');
  assert.equal(service.list(actor,{page:1,pageSize:10}).total,1);
 }finally{service?.close();fs.rmSync(temp,{recursive:true,force:true});}
}
console.log(JSON.stringify({passed:true,scope:'Changing quantity accessor cannot corrupt persisted reservation/inventory; rejection preserves state and retry key.'}));
