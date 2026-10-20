/** Run inside the existing network-isolated browser environment (/tools, /work). */
import {chromium} from '/tools/node_modules/playwright-core/index.mjs';
import {spawn} from 'node:child_process';import readline from 'node:readline';import {once} from 'node:events';import assert from 'node:assert/strict';import path from 'node:path';
const root=path.resolve(process.argv[2]);
const server=spawn(process.execPath,[path.join(root,'web/server.mjs')],{env:{...process.env,PORT:'0',DATA_FILE:'/work/system-browser.sqlite'},stdio:['ignore','pipe','inherit']});
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
  await page.locator('#sku').fill('seat');await page.locator('#quantity').fill('1');await page.locator('#reserve').click();await contains('#reservation-pagination',String(i));
 }
 await page.locator('#reservation-next').click();await page.waitForFunction(()=>globalThis.document.querySelectorAll('#reservations [data-id]').length===1);
 const row=page.locator('#reservations [data-id]').first(),id=await row.getAttribute('data-id');assert.ok(id);
 await row.getByRole('button',{name:'Invoice',exact:true}).click();await page.waitForFunction(()=>globalThis.document.querySelectorAll('#invoices [data-id]').length===1);
 const invoice=page.locator('#invoices [data-id]').first();
 await invoice.getByRole('button',{name:'Pay',exact:true}).click();await contains('#invoices','paid');
 await invoice.getByRole('button',{name:'Refund',exact:true}).click();await contains('#invoices','refunded');
 await row.getByRole('button',{name:'Cancel',exact:true}).click();await contains('#reservations','canceled');
 await page.reload();await contains('#invoices','refunded');await page.locator('#reservation-next').click();await contains('#reservations','canceled');
 // Invalid SKU is a server rejection; fields must remain correctable.
 await page.locator('#sku').fill('missing');await page.locator('#quantity').fill('1');await page.locator('#reserve').click();await page.waitForFunction(()=>Boolean(globalThis.document.querySelector('#message')?.textContent.trim()));assert.equal(await page.locator('#sku').inputValue(),'missing');
 const inventory=await context.request.get(origin+'/api/inventory?sku=seat');assert.equal((await inventory.json()).available,8);
 console.log('Browser reservation → invoice → pay → refund → cancel → reload journey passed');
}finally{await browser?.close();if(server.exitCode===null&&server.signalCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}}
