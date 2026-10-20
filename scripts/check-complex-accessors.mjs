/** Additional counterexample; kept separate from the original fixed performance oracle. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=process.argv[2];
const revised=process.argv[3]==='revised';
if(!source||process.argv.length>4||(process.argv[3]!==undefined&&!revised))throw Error('Expected synthetic complex source directory');
const {BillingService}=await import(pathToFileURL(path.resolve(source,'billing/service.mjs')));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-accessor-oracle-'));
let service;
try{
 service=new BillingService(path.join(temp,'state.sqlite'));
 const actor={tenant:'alpha',role:'admin'};
 let reads=0;
 const event={id:'accessor-reservation',tenant:'alpha',sku:'seat',quantity:1,
  get amountCents(){return ++reads<=2?50:-1;},status:'reserved',version:1,...(revised?{currency:'JPY'}:{})};
 let result,error;
 try{result=service.issue(actor,{key:'accessor-issue',event});}catch(e){error=e;}
 if(error){
  assert.equal(error.code,'VALIDATION','Reject unsupported accessor values as validation errors');
  assert.deepEqual(service.list(actor,{page:1,pageSize:10}),{items:[],total:0},'Rejected input changed stored state');
  result=service.issue(actor,{key:'accessor-issue',event:{...event,amountCents:50}});
 }
 const persisted=service.get(actor,result.id);
 assert(Number.isSafeInteger(persisted.amountCents)&&persisted.amountCents>=0,'Unvalidated negative amount persisted');
 assert.equal(persisted.amountCents,result.amountCents);
 assert.equal(service.list(actor,{page:1,pageSize:10}).total,1);
 console.log(JSON.stringify({passed:true,scope:'Accessor-backed event cannot persist an unvalidated negative billing amount; rejection preserves retry key.'}));
}finally{service?.close();fs.rmSync(temp,{recursive:true,force:true});}
