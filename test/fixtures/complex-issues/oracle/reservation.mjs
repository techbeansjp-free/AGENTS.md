import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {ReservationService}=await import(pathToFileURL(path.resolve(process.argv[2],'reservation/service.mjs')));
const admin={tenant:'alpha',role:'admin'},reader={tenant:'alpha',role:'reader'},other={tenant:'beta',role:'admin'};
const code=(fn,expected)=>assert.throws(fn,e=>e.code===expected);
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reservation-oracle-')),file=path.join(dir,'state.sqlite');let service;
 try{service=new ReservationService(file);fn(service,file);}finally{service?.close();fs.rmSync(dir,{recursive:true,force:true});}}
const seed=s=>s.seed(admin,{sku:'seat',available:10,unitCents:25});
const reserve=s=>s.reserve(admin,{key:'request-1',sku:'seat',quantity:2});
test('reservation lifecycle, pagination, immutable results and tenant boundaries',()=>fixture(s=>{
 seed(s);const a=reserve(s);assert.equal(typeof a.id,'string');assert(a.id.length);
 assert.deepEqual(a,{id:a.id,tenant:'alpha',sku:'seat',quantity:2,amountCents:50,status:'reserved',version:1});
 assert.deepEqual(s.inventory(reader,'seat'),{sku:'seat',available:8,unitCents:25});
 try{a.quantity=999;}catch(error){assert.ok(error instanceof TypeError);}assert.equal(s.get(reader,a.id).quantity,2);
 code(()=>s.get(other,a.id),'NOT_FOUND');code(()=>s.inventory(other,'seat'),'NOT_FOUND');
 code(()=>s.reserve(reader,{key:'forbidden',sku:'seat',quantity:1}),'FORBIDDEN');
 const b=s.reserve(admin,{key:'request-2',sku:'seat',quantity:1});
 assert.deepEqual(s.list(reader,{page:2,pageSize:1}),{items:[b],total:2});
 assert.deepEqual(s.list(other,{page:1,pageSize:1}),{items:[],total:0});
 assert.deepEqual(s.list(reader,{page:99,pageSize:1}),{items:[],total:2});
 code(()=>s.cancel(admin,{key:'stale',id:b.id,expectedVersion:9}),'CONFLICT');
 const c=s.cancel(admin,{key:'cancel',id:b.id,expectedVersion:1});assert.equal(c.version,2);assert.equal(c.status,'canceled');
 assert.equal(s.inventory(admin,'seat').available,8);
 code(()=>s.cancel(admin,{key:'again',id:b.id,expectedVersion:2}),'CONFLICT');
 assert.equal(s.inventory(admin,'seat').available,8);
}));
test('reservation durable idempotency, replay authorization and shared instances',()=>fixture((s,file)=>{
 seed(s);const a=reserve(s);const second=new ReservationService(file);
 try{assert.deepEqual(reserve(second),a);assert.equal(second.inventory(admin,'seat').available,8);
 code(()=>second.reserve(admin,{key:'request-1',sku:'seat',quantity:3}),'CONFLICT');
 second.cancel(admin,{key:'cancel',id:a.id,expectedVersion:1});assert.deepEqual(reserve(second),a);
 assert.equal(s.inventory(admin,'seat').available,10);
 code(()=>second.reserve(reader,{key:'request-1',sku:'seat',quantity:2}),'FORBIDDEN');
 second.seed(other,{sku:'seat',available:3,unitCents:10});assert.equal(second.reserve(other,{key:'request-1',sku:'seat',quantity:2}).amountCents,20);
 }finally{second.close();}
 const reopened=new ReservationService(file);try{assert.deepEqual(reserve(reopened),a);assert.equal(reopened.get(admin,a.id).status,'canceled');}finally{reopened.close();}
}));
test('reservation rejects invalid inputs and failures do not consume state or keys',()=>fixture(s=>{
 seed(s);for(const quantity of [0,-1,1.5,'2',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])code(()=>s.reserve(admin,{key:'bad',sku:'seat',quantity}),'VALIDATION');
 code(()=>s.reserve(admin,{key:'bad',sku:'missing',quantity:1}),'NOT_FOUND');
 code(()=>s.reserve(admin,{key:'bad',sku:'seat',quantity:11}),'CONFLICT');
 code(()=>s.reserve(admin,{key:'bad',sku:'seat',quantity:1,admin:true}),'VALIDATION');
 assert.equal(s.reserve(admin,{key:'bad',sku:'seat',quantity:1}).quantity,1);
 assert.equal(s.inventory(admin,'seat').available,9);
 s.seed(admin,{sku:'expensive',available:3,unitCents:Number.MAX_SAFE_INTEGER});
 code(()=>s.reserve(admin,{key:'overflow',sku:'expensive',quantity:2}),'VALIDATION');assert.equal(s.inventory(admin,'expensive').available,3);
 assert.equal(s.reserve(admin,{key:'overflow',sku:'expensive',quantity:1}).amountCents,Number.MAX_SAFE_INTEGER);
 for(const actor of [null,{}, {tenant:'',role:'admin'}, {tenant:'alpha',role:'owner'}])code(()=>s.list(actor,{page:1,pageSize:2}),'AUTH');
 for(const query of [{page:0,pageSize:1},{page:1,pageSize:51},{page:'1',pageSize:1},{page:1,pageSize:1,secret:true}])code(()=>s.list(admin,query),'VALIDATION');
 code(()=>s.seed(admin,{sku:'seat',available:99,unitCents:2}),'CONFLICT');assert.equal(s.inventory(admin,'seat').available,9);
}));
