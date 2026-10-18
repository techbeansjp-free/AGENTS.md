import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {BillingService}=await import(pathToFileURL(path.resolve(process.argv[2],'billing/service.mjs')));
const admin={tenant:'alpha',role:'admin'},reader={tenant:'alpha',role:'reader'},other={tenant:'beta',role:'admin'};
const code=(fn,expected)=>assert.throws(fn,error=>error.code===expected);
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billing-oracle-')),file=path.join(dir,'state.sqlite');let service;
 try{service=new BillingService(file);fn(service,file);}finally{service?.close();fs.rmSync(dir,{recursive:true,force:true});}
}
const event=(id='reservation-1',tenant='alpha')=>({id,tenant,sku:'seat',quantity:2,amountCents:50,status:'reserved',version:1});
const issue=(service,key='issue-1',value=event())=>service.issue(admin,{key,event:value});

test('billing lifecycle, listing, immutable results and tenant boundaries',()=>fixture(service=>{
 const invoice=issue(service);assert.equal(typeof invoice.id,'string');assert(invoice.id.length);
 assert.deepEqual(invoice,{id:invoice.id,tenant:'alpha',reservationId:'reservation-1',amountCents:50,status:'open',version:1});
 try{invoice.amountCents=999;}catch(error){assert.ok(error instanceof TypeError);}assert.equal(service.get(reader,invoice.id).amountCents,50);
 code(()=>service.get(other,invoice.id),'NOT_FOUND');
 code(()=>service.pay(other,{key:'cross-tenant',id:invoice.id,expectedVersion:1}),'NOT_FOUND');
 code(()=>service.pay(reader,{key:'reader-pay',id:invoice.id,expectedVersion:1}),'FORBIDDEN');
 const second=issue(service,'issue-2',event('reservation-2'));
 assert.deepEqual(service.list(reader,{page:2,pageSize:1}),{items:[second],total:2});
 assert.deepEqual(service.list(other,{page:1,pageSize:1}),{items:[],total:0});
 assert.deepEqual(service.list(reader,{page:99,pageSize:1}),{items:[],total:2});
 code(()=>service.pay(admin,{key:'stale-pay',id:invoice.id,expectedVersion:9}),'CONFLICT');
 const paid=service.pay(admin,{key:'pay-1',id:invoice.id,expectedVersion:1});
 assert.deepEqual(paid,{...service.get(admin,invoice.id),status:'paid',version:2});
 code(()=>service.pay(admin,{key:'pay-again',id:invoice.id,expectedVersion:2}),'CONFLICT');
 const refunded=service.refund(admin,{key:'refund-1',id:invoice.id,expectedVersion:2});
 assert.equal(refunded.status,'refunded');assert.equal(refunded.version,3);
 code(()=>service.refund(admin,{key:'refund-again',id:invoice.id,expectedVersion:3}),'CONFLICT');
}));

test('billing durable idempotency replays before versions and works across instances',()=>fixture((service,file)=>{
 const open=issue(service),second=new BillingService(file);
 try{
  assert.deepEqual(issue(second),open);
  code(()=>second.issue(admin,{key:'issue-1',event:event('reservation-different')}),'CONFLICT');
  code(()=>second.issue(admin,{key:'another-issue',event:event()}),'CONFLICT');
  const paid=second.pay(admin,{key:'pay-1',id:open.id,expectedVersion:1});
  const refunded=service.refund(admin,{key:'refund-1',id:open.id,expectedVersion:2});
  assert.deepEqual(second.pay(admin,{key:'pay-1',id:open.id,expectedVersion:1}),paid);
  assert.deepEqual(issue(second),open);
  assert.equal(second.get(admin,open.id).status,'refunded');
  assert.deepEqual(second.refund(admin,{key:'refund-1',id:open.id,expectedVersion:2}),refunded);
  code(()=>second.pay(reader,{key:'pay-1',id:open.id,expectedVersion:1}),'FORBIDDEN');
  const beta=second.issue(other,{key:'issue-1',event:event('reservation-1','beta')});
  assert.equal(beta.tenant,'beta');assert.equal(beta.amountCents,50);
 }finally{second.close();}
 const reopened=new BillingService(file);
 try{
  assert.deepEqual(issue(reopened),open);
  assert.equal(reopened.get(admin,open.id).status,'refunded');
  assert.deepEqual(reopened.pay(admin,{key:'pay-1',id:open.id,expectedVersion:1}),{...open,status:'paid',version:2});
 }finally{reopened.close();}
}));

test('billing rejects invalid inputs without changing records or consuming keys',()=>fixture(service=>{
 for(const actor of [null,{}, {tenant:'',role:'admin'}, {tenant:'alpha',role:'owner'}])code(()=>service.list(actor,{page:1,pageSize:2}),'AUTH');
 code(()=>service.issue(reader,{key:'reader',event:event()}),'FORBIDDEN');
 code(()=>service.issue(admin,{key:'wrong-tenant',event:event('reservation-x','beta')}),'FORBIDDEN');
 const invalidEvents=[
  {...event(),extra:true},{...event(),id:''},{...event(),tenant:''},{...event(),sku:''},
  {...event(),quantity:0},{...event(),quantity:'2'},{...event(),amountCents:-1},
  {...event(),amountCents:Number.MAX_SAFE_INTEGER+1},{...event(),status:'canceled'},
  {...event(),version:0},{...event(),version:1.5},
 ];
 for(const invalid of invalidEvents)code(()=>service.issue(admin,{key:'retry-issue',event:invalid}),'VALIDATION');
 code(()=>service.issue(admin,{key:'retry-issue',event:event(),extra:true}),'VALIDATION');
 const invoice=issue(service,'retry-issue');
 code(()=>service.issue(admin,{key:'duplicate',event:event()}),'CONFLICT');
 assert.deepEqual(service.get(admin,invoice.id),invoice);
 code(()=>service.pay(admin,{key:'retry-pay',id:invoice.id,expectedVersion:9}),'CONFLICT');
 code(()=>service.pay(admin,{key:'retry-pay',id:'missing',expectedVersion:1}),'NOT_FOUND');
 code(()=>service.pay(admin,{key:'retry-pay',id:invoice.id,expectedVersion:1,extra:true}),'VALIDATION');
 const paid=service.pay(admin,{key:'retry-pay',id:invoice.id,expectedVersion:1});assert.equal(paid.version,2);
 code(()=>service.refund(admin,{key:'retry-refund',id:invoice.id,expectedVersion:Number.MAX_SAFE_INTEGER+1}),'VALIDATION');
 assert.equal(service.refund(admin,{key:'retry-refund',id:invoice.id,expectedVersion:2}).status,'refunded');
 for(const query of [{page:0,pageSize:1},{page:1,pageSize:51},{page:'1',pageSize:1},{page:1,pageSize:1,secret:true}])code(()=>service.list(admin,query),'VALIDATION');
 for(const id of ['',42,null])code(()=>service.get(admin,id),'VALIDATION');
}));
