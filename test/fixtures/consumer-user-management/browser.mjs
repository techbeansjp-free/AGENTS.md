import {chromium} from '/tools/node_modules/playwright-core/index.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
const started=performance.now(),results=[];
let server;
async function start(){server=spawn(process.execPath,[process.argv[2]+'/server.mjs'],{env:{...process.env,DATA_FILE:'/work/users.sqlite'},stdio:['ignore','pipe','inherit']});const [chunk]=await once(server.stdout,'data');return 'http://127.0.0.1:'+JSON.parse(chunk).port;}
async function stop(){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}
let origin=await start();
// Browser subprocess sandbox is provided by the enclosing network-isolated bwrap.
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-session':'dummy-admin'}}),page=await context.newPage();
const check=async(id,fn)=>{const began=performance.now();await fn();results.push({id,status:'passed',seconds:(performance.now()-began)/1000});console.log(id);};
const text=async(selector,value)=>{await page.waitForFunction(([s,v])=>globalThis.document.querySelector(s)?.textContent.includes(v),[selector,value]);};
const add=async(name,email)=>{await page.locator('#name').fill(name);await page.locator('#email').fill(email);await page.getByRole('button',{name:'保存',exact:true}).click();};
const request=async(method,route,body,session='dummy-admin')=>globalThis.fetch(origin+route,{method,headers:{'content-type':'application/json',...(session?{'x-fixture-session':session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
try{
 await page.goto(origin);
 await check('J01 list-create-pagination-edit-cancel-delete-reload',async()=>{
  for(const [name,email,count] of [['Alice','alice@example.test',1],['Bob','bob@example.test',2],['Carol','carol@example.test',3]]){await add(name,email);await text('#pagination',`${count}件`);}
  await page.locator('#next').click();await text('#pagination','2頁');await text('#users','Carol');
  await page.getByRole('button',{name:'編集',exact:true}).click();await page.locator('#name').fill('Caroline');await page.getByRole('button',{name:'保存',exact:true}).click();await text('#users','Caroline');
  await page.reload();await page.locator('#next').click();await text('#users','Caroline');
  await page.getByRole('button',{name:'編集',exact:true}).click();await page.locator('#name').fill('discarded');await page.locator('#cancel').click();assert.equal(await page.locator('#name').inputValue(),'');
  await page.getByRole('button',{name:'削除',exact:true}).click();await text('#pagination','1頁 / 2件');assert.equal(await page.locator('#users li').count(),2);
 });
 await check('J02 invalid-and-duplicate-input-recovers-without-losing-fields',async()=>{
  await add('   ','new@example.test');await text('#message','名前は1〜80文字');assert.equal(await page.locator('#email').inputValue(),'new@example.test');
  await add('New','ALICE@example.test');await text('#message','登録済み');assert.equal(await page.locator('#name').inputValue(),'New');
  await add('<img src=x onerror="window.injected=true">','new@example.test');await text('#pagination','3件');await page.locator('#next').click();await text('#users','<img');assert.equal(await page.locator('#users img').count(),0);assert.equal(await page.evaluate(()=>globalThis.window.injected),undefined);
 });
 await check('J03 direct-api-validation-and-authorization',async()=>{
  for(const body of [{name:[],email:'x@y.test'},{name:'x',email:8},{name:'x',email:'x@y.test',role:'admin'},{name:'x'.repeat(81),email:'x@y.test'}])assert.equal((await request('POST','/api/users',body)).status,400);
  const before=await (await request('GET','/api/users')).json();
  for(const email of ['a'.repeat(65)+'@example.com','a(b@example.com','a..b@example.com','.a@example.com','a.@example.com','a@@b.com','a@.com','a@b..com','a@b.','a@bad!.example','a@-bad.example','a@bad-.example','a@'+ 'a'.repeat(64)+'.example']){
   assert.equal((await request('POST','/api/users',{name:'bad',email})).status,400);
   assert.equal((await request('PUT','/api/users/1',{name:'bad',email,version:1})).status,400);
  }
  for(const email of ['a'.repeat(64)+'@example.com','a+b.c@example.test','a@X.EXAMPLE','a@valid-label.example','a@'+'a'.repeat(63)+'.example']){
   const created=await request('POST','/api/users',{name:'valid',email});assert.equal(created.status,201);
   assert.equal((await request('DELETE','/api/users/'+(await created.json()).id)).status,200);
  }
  assert.deepEqual(await (await request('GET','/api/users')).json(),before);
  assert.equal((await request('POST','/api/users',{name:'bad',email:'bad@y.test'},'dummy-reader')).status,403);
  assert.equal((await request('GET','/api/users',undefined,null)).status,401);
  assert.equal((await request('GET','/api/users?page=0')).status,400);
  assert.equal((await request('PUT','/api/users/999',{name:'missing',email:'m@y.test',version:1})).status,404);
  assert.equal((await request('DELETE','/api/users/999')).status,404);
 });
 await check('J04 stale-edit-rejection-and-user-recovery',async()=>{
  await page.locator('#prev').click();await text('#users','Alice');await page.locator('#users li').first().getByRole('button',{name:'編集',exact:true}).click();
  const body={name:'Alice newer',email:'alice@example.test',version:1};assert.equal((await request('PUT','/api/users/1',body)).status,200);
  await page.locator('#name').fill('Alice stale');await page.getByRole('button',{name:'保存',exact:true}).click();await text('#message','他の操作で更新');assert.equal(await page.locator('#name').inputValue(),'Alice stale');
  await page.reload();await text('#users','Alice newer');
 });
 await check('J05 connection-failure-keeps-input-for-retry',async()=>{
  await page.route('**/api/users',route=>route.abort(),{times:1});await add('Retry','retry@example.test');await text('#message','fetch');assert.equal(await page.locator('#name').inputValue(),'Retry');
  await page.getByRole('button',{name:'保存',exact:true}).click();await text('#pagination','4件');
 });
 await check('J06 persistence-after-server-restart',async()=>{
  await stop();origin=await start();await page.goto(origin);await text('#pagination','4件');await text('#users','Alice newer');
 });
 await page.screenshot({path:'/work/user-journey.png',fullPage:true});
}finally{
 fs.writeFileSync('/work/journey-results.json',JSON.stringify({results,seconds:(performance.now()-started)/1000,browser:await browser.version(),claims:'synthetic business journey; dummy sessions, not authentication audit'},null,2));
 await browser.close();await stop();
}
