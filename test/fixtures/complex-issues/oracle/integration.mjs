import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(process.argv[2]);
const [{ReservationService},{BillingService}]=await Promise.all([
 import(pathToFileURL(path.join(root,'reservation/service.mjs'))),
 import(pathToFileURL(path.join(root,'billing/service.mjs'))),
]);
const alpha={tenant:'alpha',role:'admin'},alphaReader={tenant:'alpha',role:'reader'},beta={tenant:'beta',role:'admin'};
const code=(fn,expected)=>assert.throws(fn,error=>error.code===expected);

test('reservation output drives durable tenant-isolated billing and cancellation restores stock',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reservation-billing-oracle-')),file=path.join(dir,'state.sqlite');
 let reservations,billing;
 try{
  reservations=new ReservationService(file);billing=new BillingService(file);
  reservations.seed(alpha,{sku:'seat',available:5,unitCents:25});
  reservations.seed(beta,{sku:'seat',available:4,unitCents:10});
  const reserved=reservations.reserve(alpha,{key:'reserve',sku:'seat',quantity:2});
  const invoice=billing.issue(alpha,{key:'issue',event:reserved});
  assert.deepEqual(invoice,{id:invoice.id,tenant:'alpha',reservationId:reserved.id,amountCents:reserved.amountCents,status:'open',version:1});
  const paid=billing.pay(alpha,{key:'pay',id:invoice.id,expectedVersion:1});
  const refunded=billing.refund(alpha,{key:'refund',id:invoice.id,expectedVersion:2});
  assert.equal(paid.status,'paid');assert.equal(refunded.status,'refunded');
  code(()=>reservations.get(beta,reserved.id),'NOT_FOUND');
  code(()=>billing.get(beta,invoice.id),'NOT_FOUND');
  code(()=>billing.refund(beta,{key:'cross-tenant',id:invoice.id,expectedVersion:2}),'NOT_FOUND');
  const betaReserved=reservations.reserve(beta,{key:'reserve',sku:'seat',quantity:3});
  const betaInvoice=billing.issue(beta,{key:'issue',event:betaReserved});
  assert.equal(betaInvoice.tenant,'beta');assert.equal(betaInvoice.amountCents,30);
  const canceled=reservations.cancel(alpha,{key:'cancel',id:reserved.id,expectedVersion:1});
  assert.equal(canceled.status,'canceled');
  assert.deepEqual(reservations.inventory(alphaReader,'seat'),{sku:'seat',available:5,unitCents:25});
  assert.deepEqual(billing.get(alphaReader,invoice.id),refunded);
  assert.deepEqual(reservations.list(alphaReader,{page:1,pageSize:10}),{items:[canceled],total:1});
  assert.deepEqual(billing.list(alphaReader,{page:1,pageSize:10}),{items:[refunded],total:1});
  reservations.close();reservations=undefined;billing.close();billing=undefined;
  reservations=new ReservationService(file);billing=new BillingService(file);
  assert.deepEqual(reservations.reserve(alpha,{key:'reserve',sku:'seat',quantity:2}),reserved);
  assert.deepEqual(billing.issue(alpha,{key:'issue',event:reserved}),invoice);
  assert.deepEqual(billing.pay(alpha,{key:'pay',id:invoice.id,expectedVersion:1}),paid);
  assert.deepEqual(billing.refund(alpha,{key:'refund',id:invoice.id,expectedVersion:2}),refunded);
  assert.equal(reservations.get(alpha,reserved.id).status,'canceled');
  assert.equal(reservations.inventory(alpha,'seat').available,5);
  assert.equal(billing.get(alpha,invoice.id).status,'refunded');
  assert.equal(reservations.list(beta,{page:1,pageSize:10}).total,1);
  assert.equal(billing.list(beta,{page:1,pageSize:10}).total,1);
 }finally{
  reservations?.close();billing?.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
