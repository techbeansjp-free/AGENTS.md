/* Run only inside an enclosing evaluation sandbox. Explicit installed driver, no downloads. */
import fs from 'node:fs';import os from 'node:os';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.argv[3]??'/tools/node_modules/playwright-core/index.mjs'));
import {spawn} from 'node:child_process';import readline from 'node:readline';import {once} from 'node:events';import assert from 'node:assert/strict';import path from 'node:path';
const root=path.resolve(process.argv[2]),temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-system-browser-'));
const server=spawn(process.execPath,[path.join(root,'web/server.mjs')],{env:{...process.env,PORT:'0',DATA_FILE:path.join(temp,'state.sqlite')},stdio:['ignore','pipe','inherit']});
let browser;
try{
 const lines=readline.createInterface({input:server.stdout});
 const port=await new Promise((resolve,reject)=>{server.once('error',reject);server.once('exit',code=>reject(Error('Server exited before ready: '+code)));lines.once('line',line=>{try{const v=JSON.parse(line);assert.ok(Number.isInteger(v.port)&&v.port>0&&v.port<=65535);resolve(v.port);}catch(e){reject(e);}});});lines.close();
 const origin='http://127.0.0.1:'+port;
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-session':'alpha-admin'}}),page=await context.newPage();
 const seeded=await context.request.post(origin+'/api/reservations/seed',{data:{sku:'seat',available:10,unitCents:25}});assert.equal(seeded.status(),200);
 await page.goto(origin);
 const contains=async(selector,text)=>page.waitForFunction(([s,t])=>globalThis.document.querySelector(s)?.textContent.includes(t),[selector,text]);
 for(let i=1;i<=3;i++){
  await page.locator('#sku').fill('seat');await page.locator('#quantity').fill('1');const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/reservations');await page.locator('#reserve').click();assert.equal((await response).status(),201);await page.waitForFunction(n=>globalThis.document.querySelectorAll('#reservations [data-id]').length===Math.min(n,2),i);const listed=await context.request.get(origin+'/api/reservations');assert.equal((await listed.json()).total,i);
 }
 const firstPage=await page.locator('#reservation-pagination').textContent();assert.ok(firstPage?.trim());assert.ok((await page.locator('#invoice-pagination').innerText()).trim());await page.locator('#reservation-next').click();await page.waitForFunction(old=>{const text=globalThis.document.querySelector('#reservation-pagination')?.textContent;return text?.trim()&&text!==old;},firstPage);await page.waitForFunction(()=>globalThis.document.querySelectorAll('#reservations [data-id]').length===1);
 const row=page.locator('#reservations [data-id]').first(),id=await row.getAttribute('data-id');assert.ok(id);
 const issuedResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/invoices');await row.getByRole('button',{name:'Invoice',exact:true}).click();const issued=await issuedResponse;assert.equal(issued.status(),201);const issuedBody=await issued.json();assert.equal(issuedBody.reservationId,id);await page.waitForFunction(()=>globalThis.document.querySelectorAll('#invoices [data-id]').length===1);
 const invoice=page.locator('#invoices [data-id]').first();assert.equal(await invoice.getAttribute('data-id'),issuedBody.id);
 const invoicePath='/api/invoices/'+encodeURIComponent(issuedBody.id);
 const paying=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===invoicePath+'/pay');await invoice.getByRole('button',{name:'Pay',exact:true}).click();const paid=await paying;assert.equal(paid.status(),200);assert.equal((await paid.json()).status,'paid');await contains('#invoices','paid');
 const refunding=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===invoicePath+'/refund');await invoice.getByRole('button',{name:'Refund',exact:true}).click();const refunded=await refunding;assert.equal(refunded.status(),200);assert.equal((await refunded.json()).status,'refunded');await contains('#invoices','refunded');
 await row.getByRole('button',{name:'Cancel',exact:true}).click();await contains('#reservations','canceled');
 await page.reload();await contains('#invoices','refunded');const persisted=await context.request.get(origin+invoicePath);assert.equal(persisted.status(),200);assert.equal((await persisted.json()).status,'refunded');await page.locator('#reservation-next').click();await contains('#reservations','canceled');
 // Invalid SKU is a server rejection; fields must remain correctable.
 await page.locator('#sku').fill('missing');await page.locator('#quantity').fill('1');const rejected=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/reservations');await page.locator('#reserve').click();const failed=await rejected;assert.equal(failed.status(),404);await contains('#message',(await failed.json()).message);assert.equal(await page.locator('#sku').inputValue(),'missing');
 const inventory=await context.request.get(origin+'/api/inventory?sku=seat');assert.equal((await inventory.json()).available,8);
 console.log('Browser reservation → invoice → pay → refund → cancel → reload journey passed');
}finally{await browser?.close();if(server.exitCode===null&&server.signalCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}fs.rmSync(temp,{recursive:true,force:true});}
