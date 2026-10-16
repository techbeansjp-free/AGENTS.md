/** Owner-pinned browser/API/SQLite oracle; execute only within formal isolation. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const {performance,setTimeout,clearTimeout,fetch,AbortSignal}=globalThis;
const app=path.resolve(process.argv[2] || 'app.py');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-vertical-'));
const db=path.join(root,'tasks.db'), chrome='/work/browser/chrome';
const uiRequests=[],externalRequests=[],networkRequests=new Map(),finishedRequests=new Set();
const checks=[], started=performance.now();
const check=(name,passed)=>{checks.push({name,passed:!!passed});if(!passed)throw Error(`Assertion failed: ${name}`);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,session,serverDiagnostic='',browserDiagnostic='',origin;
const pending=new Map();let sequence=0,buffer='',intercept='continue',held=[],interceptionError;
function send(method,params={},sessionId=session){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},10000);pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
function rejectPending(error){for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');for(let n=0;n<20&&child.exitCode===null&&child.signalCode===null;n++)await delay(25);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(500)]);}}
async function startServer(){
 const launcher=path.join(root,'observe.py');fs.writeFileSync(launcher,"import sys,time,runpy,json,io\nfrom pathlib import Path\nfrom http.server import BaseHTTPRequestHandler\nlatch=Path(sys.argv.pop(1));sys.argv=sys.argv[1:]\noriginal=BaseHTTPRequestHandler.parse_request\nclass ReplayBody:\n def __init__(self,stream,data):self.stream=stream;self.prefix=io.BytesIO(data)\n def __getattr__(self,name):return getattr(self.stream,name)\n def read(self,size=-1):\n  first=self.prefix.read(size)\n  if size<0:return first+self.stream.read()\n  return first if len(first)==size else first+self.stream.read(size-len(first))\ndef observe(handler):\n ok=original(handler)\n if ok and handler.command=='PATCH' and handler.path=='/api/tasks/1' and (latch/'arm-update').exists():\n  length=int(handler.headers['Content-Length']);assert 0<length<64\n  body=handler.rfile.read(length);payload=json.loads(body)\n  assert payload=={'completed':True} and type(payload['completed']) is bool\n  handler.rfile=ReplayBody(handler.rfile,body)\n  (latch/'arm-update').unlink();(latch/'update-received').touch()\n  deadline=time.monotonic()+10\n  while not (latch/'release-update').exists():\n   if time.monotonic()>deadline:raise TimeoutError('owner pre-handler probe timeout')\n   time.sleep(.01)\n return ok\nBaseHTTPRequestHandler.parse_request=observe\nrunpy.run_path(sys.argv[0],run_name='__main__')\n");
 server=spawn('/usr/bin/python3',[launcher,root,app,'--port','0','--db',db],{cwd:path.dirname(app),stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
 server.stderr.on('data',chunk=>{serverDiagnostic=(serverDiagnostic+chunk.toString()).slice(-1400);});
 const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Server readiness timeout')),8000);const done=(err,value)=>{clearTimeout(timer);if(err)reject(err);else resolve(value);};server.once('error',err=>done(err));server.once('exit',(code,signal)=>done(Error(`Server exited (${code}/${signal})`)));server.stdout.on('data',chunk=>{text+=chunk.toString();if(text.length>4096)return done(Error('Server readiness exceeds bound'));if(!text.includes('\n'))return;try{const value=JSON.parse(text.slice(0,text.indexOf('\n')));if(Object.keys(value).length!==1||!Number.isInteger(value.port)||value.port<1||value.port>65535)throw Error('Invalid readiness record');done(null,value.port);}catch(err){done(err);}});});
 origin=`http://127.0.0.1:${port}`;
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Browser evaluation: '+JSON.stringify(r.exceptionDetails).slice(0,700));return r.result.value;}
async function waitFor(expression){for(let i=0;i<150;i++){if(interceptionError)throw interceptionError;try{if(await evaluate(expression))return;}catch(e){if(!/context|navigation/i.test(String(e)))throw e;}await delay(25);}throw Error(`Condition timeout: ${expression.slice(0,180)}`);}
const visible=`(e=>!!e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&e.getClientRects().length>0)`;
const rows=`[...document.querySelectorAll('#tasks [data-task-id]')].filter(${visible})`;
async function api(route,method='GET',body){const response=await fetch(origin+route,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000),redirect:'error'});const text=await response.text();return {status:response.status,body:response.status>=400?text:JSON.parse(text)};}
const task=(completed=false)=>({id:1,name:'Review inventory',completed});
const sameTask=(a,b)=>a&&Object.keys(a).sort().join(',')==='completed,id,name'&&a.id===b.id&&a.name===b.name&&a.completed===b.completed;
function stored(){return JSON.parse(execFileSync('/usr/bin/python3',['-I','-c',"import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps(c.execute('SELECT id,name,completed FROM tasks ORDER BY id').fetchall()))",db],{encoding:'utf8',timeout:3000,maxBuffer:4096}));}
async function navigate(hash){const navigation=await send('Page.navigate',{url:origin+'/'+hash});if(navigation.errorText)throw Error('Navigation failed: '+navigation.errorText);await waitFor(`location.href===${JSON.stringify(origin+'/'+hash)}&&document.readyState==='complete'`);}
async function release(){intercept='continue';for(const requestId of held.splice(0))await send('Fetch.continueRequest',{requestId});}
try{
 await startServer();check('server announces ephemeral port',true);
 const initial=await api('/api/tasks');check('API initial exact tasks',initial.status===200&&Array.isArray(initial.body)&&initial.body.length===2&&sameTask(initial.body[0],task())&&sameTask(initial.body[1],{id:2,name:'Pack order',completed:false}));
 const detail=await api('/api/tasks/1');check('API detail',detail.status===200&&sameTask(detail.body,task()));
 const initialDB=stored();check('SQLite initial seed',JSON.stringify(initialDB)===JSON.stringify([[1,'Review inventory',0],[2,'Pack order',0]]));
 const schema=JSON.parse(execFileSync('/usr/bin/python3',['-I','-c',`import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]); cols={r[1]:r for r in c.execute('PRAGMA table_info(tasks)')}
assert cols['id'][5]==1 and cols['name'][3]==1 and cols['completed'][3]==1
for name,completed in [(None,0),('invalid',None),('invalid',2),('invalid',-1)]:
 try: c.execute('INSERT INTO tasks(id,name,completed) VALUES(99,?,?)',(name,completed))
 except sqlite3.IntegrityError: c.rollback()
 else: raise AssertionError('Schema constraint missing')
print(json.dumps(True))`,db],{encoding:'utf8',timeout:3000,maxBuffer:4096}));check('SQLite required constraints enforced',schema===true);
 check('source file is not served',(await fetch(origin+'/app.py',{signal:AbortSignal.timeout(3000)})).status===404);
 const portHex=Number(new URL(origin).port).toString(16).toUpperCase().padStart(4,'0');
 const listeners=fs.readFileSync('/proc/net/tcp','utf8').split('\n').slice(1).map(line=>line.trim().split(/\s+/)).filter(row=>row[3]==='0A'&&row[1]?.endsWith(':'+portHex));
 check('API listener binds loopback only',listeners.length===1&&listeners[0][1]==='0100007F:'+portHex);
 browser=spawn(chrome,['--headless','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${path.join(root,'profile')}`,'--remote-debugging-pipe'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 browser.stderr.on('data',chunk=>{browserDiagnostic=(browserDiagnostic+chunk.toString()).slice(-1400);});
 browser.on('error',rejectPending);browser.on('exit',(code,signal)=>rejectPending(Error(`Browser exited (${code}/${signal})`)));
 browser.stdio[4].on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>2*1024*1024){rejectPending(Error('CDP response exceeds bound'));browser.kill();return;}let end;while((end=buffer.indexOf('\0'))>=0){let msg;try{msg=JSON.parse(buffer.slice(0,end));}catch(err){rejectPending(err);return;}buffer=buffer.slice(end+1);const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.reject(Error(JSON.stringify(msg.error)));else p.resolve(msg.result);}else if(msg.method==='Network.requestWillBeSent'){networkRequests.set(msg.params.requestId,{...msg.params.request,resourceType:msg.params.type,loaderId:msg.params.loaderId});
 }else if(msg.method==='Network.loadingFinished'){finishedRequests.add(msg.params.requestId);
 }else if(msg.method==='Fetch.requestPaused'){
 const {requestId,request}=msg.params;const allowed=request.url.startsWith(origin+'/');if(!allowed)externalRequests.push(request.url);else uiRequests.push({url:request.url,method:request.method,postData:request.postData});
 if(!allowed)send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},msg.sessionId).catch(e=>{interceptionError=e;});
 else if(new URL(request.url).pathname.startsWith('/api/')&&(intercept==='hold'||(intercept==='hold-patch'&&request.method==='PATCH')))held.push(requestId);
 else send(intercept==='fail'&&new URL(request.url).pathname.startsWith('/api/')?'Fetch.failRequest':'Fetch.continueRequest',{requestId,...(intercept==='fail'&&new URL(request.url).pathname.startsWith('/api/')?{errorReason:'Failed'}:{})},msg.sessionId).catch(e=>{interceptionError=e;});
 }}});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);({sessionId:session}=await send('Target.attachToTarget',{targetId,flatten:true},null));
 await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Browser.setDownloadBehavior',{behavior:'deny'},null);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 intercept='hold';await navigate('#list');await waitFor(`${visible}(document.querySelector('#status'))&&document.querySelector('#status').getAttribute('role')==='status'&&/Loading/i.test(document.querySelector('#status').innerText)`);for(let i=0;i<100&&!held.length;i++)await delay(10);check('initial Loading status while HTTP held',held.length>0);await release();
 await waitFor(`${rows}.length===2`);check('list renders API rows',await evaluate(`${rows}.map(e=>e.dataset.taskId).sort().join(',')==='1,2'&&${rows}.some(e=>e.innerText.includes('Review inventory'))&&${rows}.some(e=>e.innerText.includes('Pack order'))`));
 check('labelled search and hidden empty',await evaluate(`document.querySelector('#search').labels.length>0&&!${visible}(document.querySelector('#empty'))`));
 check('demo disclosure and design tokens',await evaluate(`document.body.innerText.includes('Synthetic demo')&&getComputedStyle(document.documentElement).getPropertyValue('--text').trim()!==''&&getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()!==''`));
 check('list fits 390px viewport',await evaluate('innerWidth===390&&document.documentElement.scrollWidth<=innerWidth'));
 await evaluate(`document.querySelector('#search').value='INVENTORY';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);await waitFor(`${rows}.length===1&&${rows}[0].dataset.taskId==='1'`);check('case insensitive filter',true);
 await evaluate(`document.querySelector('#search').value='not-a-task';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);await waitFor(`${rows}.length===0&&${visible}(document.querySelector('#empty'))`);check('empty filter state',true);
 await evaluate(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);await waitFor(`${rows}.length===2`);
 intercept='hold';await evaluate(`document.querySelector('#tasks [data-task-id="1"] a[href="#task/1"]').click()`);await waitFor(`location.hash==='#task/1'&&${visible}(document.querySelector('#status'))&&/Loading/i.test(document.querySelector('#status').innerText)`);for(let i=0;i<100&&!held.length;i++)await delay(10);check('detail navigation Loading',held.length>0);await release();
 await waitFor(`${visible}(document.querySelector('#detail'))&&document.querySelector('#detail').dataset.taskId==='1'&&document.querySelector('#detail').dataset.completed==='false'`);
 check('detail native toggle and back link',await evaluate(`document.querySelector('#detail').innerText.includes('Review inventory')&&document.querySelector('#toggle').tagName==='BUTTON'&&document.querySelector('#back').getAttribute('href')==='#list'`));
 check('detail fits 390px viewport',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
 const beforeToggle=uiRequests.length;await evaluate(`document.querySelector('#toggle').click()`);await waitFor(`document.querySelector('#detail').dataset.completed==='true'`);check('UI uses PATCH boolean true',uiRequests.slice(beforeToggle).some(r=>r.url===origin+'/api/tasks/1'&&r.method==='PATCH'&&JSON.stringify(JSON.parse(r.postData??'null'))===JSON.stringify({completed:true})));check('UI toggle updates API and SQLite',(await api('/api/tasks/1')).body.completed===true&&stored()[0][2]===1);
 await evaluate('window.__oracleBeforeReload=true');await send('Page.reload',{ignoreCache:true});await waitFor(`!window.__oracleBeforeReload&&document.readyState==='complete'&&document.querySelector('#detail')?.dataset.completed==='true'`);check('completion survives browser reload',true);
 await evaluate(`document.querySelector('#toggle').click()`);await waitFor(`document.querySelector('#detail').dataset.completed==='false'`);check('UI toggle reverses persisted state',(await api('/api/tasks/1')).body.completed===false&&stored()[0][2]===0);
 await evaluate(`document.querySelector('#back').click()`);await waitFor(`location.hash==='#list'&&${rows}.length===2`);check('back returns to list',true);
 // Reproduce toggle followed by Back while PATCH is held; execute actual page JS.
 await evaluate(`document.querySelector('#tasks [data-task-id="1"] a').click()`);
 await waitFor(`document.querySelector('#detail')?.dataset.completed==='false'&&${visible}(document.querySelector('#detail'))`);
 const beforeRacePatch=new Set(networkRequests.keys());
 intercept='hold-patch';await evaluate(`document.querySelector('#toggle').click()`);
 for(let i=0;i<100&&!held.length;i++)await delay(10);check('race PATCH held before commit',held.length===1);
 const priorGetIds=new Set([...networkRequests].filter(([,r])=>r.url===origin+'/api/tasks').map(([id])=>id));
 check('pending Back remains native visible link',await evaluate(`document.querySelector('#back').tagName==='A'&&document.querySelector('#back').getAttribute('href')==='#list'&&${visible}(document.querySelector('#back'))`));
 await evaluate(`document.querySelector('#back').click()`);await waitFor(`${visible}(document.querySelector('#status'))&&document.querySelector('#status').getAttribute('role')==='status'&&/Loading/i.test(document.querySelector('#status').innerText)`);
 // A correct page may defer its GET until PATCH completes. If it starts one,
 // wait for its actual response completion rather than assuming elapsed time proves ordering.
 // Requests already seen after Back are included by URL and completion below.
 let premature=[...networkRequests].filter(([id,r])=>r.url===origin+'/api/tasks'&&r.method==='GET'&&!priorGetIds.has(id));
 for(let i=0;i<20&&!premature.length;i++){await delay(25);premature=[...networkRequests].filter(([id,r])=>r.url===origin+'/api/tasks'&&r.method==='GET'&&!priorGetIds.has(id));}
 if(premature.length){for(let i=0;i<120&&premature.some(([id])=>!finishedRequests.has(id));i++)await delay(25);check('premature list GET finished before PATCH release',premature.every(([id])=>finishedRequests.has(id)));}
 await release();
 const racePatches=[...networkRequests].filter(([id,r])=>!beforeRacePatch.has(id)&&r.method==='PATCH');
 for(let i=0;i<150&&racePatches.some(([id])=>!finishedRequests.has(id));i++)await delay(25);check('race PATCH browser response complete',racePatches.length===1&&racePatches.every(([id])=>finishedRequests.has(id)));
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await waitFor(`location.hash==='#list'&&${rows}.length===2&&(!${visible}(document.querySelector('#status'))||!/Loading/i.test(document.querySelector('#status').innerText))`);
 check('immediate Back committed completion',(await api('/api/tasks/1')).body.completed===true&&stored()[0][2]===1);
 const settledList=await evaluate(`${rows}.map(e=>e.innerText)`);
 await evaluate('window.__raceReload=true');await send('Page.reload',{ignoreCache:true});
 await waitFor(`!window.__raceReload&&${rows}.length===2&&(!${visible}(document.querySelector('#status'))||!/Loading/i.test(document.querySelector('#status').innerText))`);
 check('Back list agrees with persisted reload without prescribed wording',JSON.stringify(settledList)===JSON.stringify(await evaluate(`${rows}.map(e=>e.innerText)`)));
 await api('/api/tasks/1','PATCH',{completed:false});
 for(const value of ['true',1,null]){const invalid=await api('/api/tasks/1','PATCH',{completed:value});check(`API rejects nonboolean ${JSON.stringify(value)}`,invalid.status===400);}
 for(const payload of [{},{completed:true,extra:1},[]]){check('API rejects invalid object '+JSON.stringify(payload),(await api('/api/tasks/1','PATCH',payload)).status===400);}
 check('invalid updates preserve state',(await api('/api/tasks/1')).body.completed===false&&stored()[0][2]===0);
 check('missing GET returns 404',(await api('/api/tasks/999')).status===404);check('missing PATCH returns 404',(await api('/api/tasks/999','PATCH',{completed:true})).status===404);
 for(const id of ['9223372036854775808','9'.repeat(5000)]){for(const method of ['GET','PATCH'])check(`missing oversized ID ${id.length} digits ${method} returns 404`,(await api('/api/tasks/'+id,method,method==='PATCH'?{completed:true}:undefined)).status===404);}
 for(let i=0;i<2;i++){const updated=await api('/api/tasks/1','PATCH',{completed:true});check(`idempotent PATCH true attempt ${i+1}`,updated.status===200&&sameTask(updated.body,task(true)));}
 check('SQLite contains updated completion',stored()[0][2]===1&&stored()[1][2]===0);
 intercept='fail';await send('Page.reload',{ignoreCache:true});await waitFor(`${visible}(document.querySelector('#error'))&&document.querySelector('#error').innerText.trim().length>0`);check('HTTP failure shows visible Error state',true);intercept='continue';
 await stop(server);await startServer();check('completion survives server restart',sameTask((await api('/api/tasks/1')).body,task(true))&&stored()[0][2]===1);
 await navigate('#task/1');await waitFor(`document.querySelector('#detail')?.dataset.completed==='true'`);check('restarted server renders persisted detail',true);check('UI attempts no external requests',externalRequests.length===0);
 // Third-screen acceptance extends, rather than replaces, the two-screen checks above.
 const summaryResponse=async(expected,total=2)=>{
  const response=await api('/api/summary');
  const value=response.body;
  check('summary API exact counts '+expected,response.status===200&&value&&Object.keys(value).sort().join(',')==='completed,pending,total'&&value.total===total&&value.completed===expected&&value.pending===total-expected);
  const records=stored();check('summary agrees with SQLite '+expected,records.length===total&&records.reduce((sum,row)=>sum+row[2],0)===expected);
 };
 const summaryDOM=(expected,total=2)=>`location.hash==='#summary'&&${visible}(document.querySelector('#summary'))&&document.querySelector('#summary').dataset.total==='${total}'&&document.querySelector('#summary').dataset.completed==='${expected}'&&document.querySelector('#summary').dataset.pending==='${total-expected}'`;
 const assertSummary=async(expected,label,total=2)=>{
  await waitFor(summaryDOM(expected,total));await summaryResponse(expected,total);
  // Count occurrences as well as values: 2/1/1 requires two visible 1s.
  const textCounts=await evaluate(`(document.querySelector('#summary').innerText.match(/\\b[0-9]+\\b/g)||[]).map(Number)`);
  const remaining=[...textCounts];let visibleCounts=true;
  for(const value of [total,expected,total-expected]){const index=remaining.indexOf(value);if(index<0){visibleCounts=false;break;}remaining.splice(index,1);}
  check(label+' visible counts',visibleCounts);
  check(label+' list link',await evaluate(`${visible}(document.querySelector('#summary-list'))&&document.querySelector('#summary-list').tagName==='A'&&document.querySelector('#summary-list').getAttribute('href')==='#list'`));
  check(label+' fits 390px viewport',await evaluate('innerWidth===390&&document.documentElement.scrollWidth<=innerWidth'));
 };
 const openSummary=async(expected,from,total=2)=>{
  check(from+' visible summary link',await evaluate(`${visible}(document.querySelector('#summary-link'))&&document.querySelector('#summary-link').tagName==='A'&&document.querySelector('#summary-link').getAttribute('href')==='#summary'`));
  const before=uiRequests.length;await evaluate(`document.querySelector('#summary-link').click()`);
  await assertSummary(expected,from+' to summary',total);
  check(from+' summary fetches real API',uiRequests.slice(before).some(r=>r.method==='GET'&&r.url===origin+'/api/summary'));
 };
 await summaryResponse(1);
 const beforeSummaryMutation=JSON.stringify(stored());
 for(const method of ['PATCH','POST','DELETE']){const response=await api('/api/summary',method,{completed:true});check('summary rejects '+method,[404,405,501].includes(response.status));check('rejected summary '+method+' preserves SQLite',JSON.stringify(stored())===beforeSummaryMutation);}
 await openSummary(1,'detail');
 await evaluate(`document.querySelector('#summary-list').click()`);await waitFor(`location.hash==='#list'&&${rows}.length===2`);check('summary returns to list',true);
 await openSummary(1,'list');
 await evaluate(`document.querySelector('#summary-list').click()`);await waitFor(`location.hash==='#list'&&${rows}.length===2`);
 await evaluate(`document.querySelector('#tasks [data-task-id="1"] a').click()`);await waitFor(`location.hash==='#task/1'&&${visible}(document.querySelector('#detail'))&&document.querySelector('#detail').dataset.completed==='true'`);
 const beforeSummaryToggle=uiRequests.length;await evaluate(`document.querySelector('#toggle').click()`);await waitFor(`document.querySelector('#detail').dataset.completed==='false'`);
 check('summary journey toggle uses PATCH false',uiRequests.slice(beforeSummaryToggle).some(r=>r.url===origin+'/api/tasks/1'&&r.method==='PATCH'&&JSON.stringify(JSON.parse(r.postData??'null'))===JSON.stringify({completed:false})));
 check('summary journey toggle persisted',(await api('/api/tasks/1')).body.completed===false&&stored()[0][2]===0);
 await openSummary(0,'detail after toggle');
 const beforeSummaryReload=uiRequests.length;await evaluate('window.__summaryReload=true');await send('Page.reload',{ignoreCache:true});await waitFor('!window.__summaryReload&&document.readyState===\'complete\'');
 await assertSummary(0,'summary reload');check('summary reload fetches API',uiRequests.slice(beforeSummaryReload).some(r=>r.method==='GET'&&r.url===origin+'/api/summary'));
 for(const route of ['/api/summary/unknown','/api/summaryx'])check('unknown summary route returns 404 '+route,(await api(route)).status===404);
 await stop(server);await startServer();await summaryResponse(0);
 const beforeSummaryRestart=uiRequests.length;await navigate('#summary');await assertSummary(0,'summary after server restart');check('restarted summary fetches API',uiRequests.slice(beforeSummaryRestart).some(r=>r.method==='GET'&&r.url===origin+'/api/summary'));

 // Challenge aggregation independently of task 1 and the original two-row seed.
 const secondTask=await api('/api/tasks/2','PATCH',{completed:true});
 check('summary includes completion of task 2',secondTask.status===200&&sameTask(secondTask.body,{id:2,name:'Pack order',completed:true}));
 await summaryResponse(1);
 await evaluate(`document.querySelector('#summary-list').click()`);await waitFor(`location.hash==='#list'&&${rows}.length===2`);
 await openSummary(1,'list after task 2 update');
 // Mutate only this oracle's disposable DB through parameterized SQL.
 execFileSync('/usr/bin/python3',['-I','-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('INSERT INTO tasks(id,name,completed) VALUES(?,?,?)',(3,'Audit returns',1)); c.commit(); c.close()",db],{encoding:'utf8',timeout:3000,maxBuffer:4096});
 await summaryResponse(2,3);
 const threeRows=`location.origin===${JSON.stringify(origin)}&&location.hash==='#list'&&${rows}.length===3&&${rows}.map(e=>e.dataset.taskId).sort().join(',')==='1,2,3'&&${rows}.find(e=>e.dataset.taskId==='3').innerText.includes('Audit returns')`;
 await evaluate(`document.querySelector('#summary-list').click()`);await waitFor(threeRows);check('list fetches added SQLite task',true);
 await openSummary(2,'list after third task insertion',3);
 await evaluate('history.back()');await waitFor(threeRows);
 check('same-origin history Back restores list',await evaluate(`!${visible}(document.querySelector('#summary'))`));
 await evaluate('history.forward()');await assertSummary(2,'history Forward summary',3);
 check('history Forward remains same origin',await evaluate(`location.origin===${JSON.stringify(origin)}`));
 // Exercise optional controls after the user-history scenario, so probes cannot alter its history.
  // Read-only controls (refresh/filter/navigation) are allowed. Exercise clicks;
  // forbid writes, not HTML element types. This is bounded interaction evidence.
  const controls=`[...document.querySelectorAll('#summary button,#summary input,#summary a,#summary [role="button"],#summary [onclick]')].filter(e=>e.id!=='summary-list'&&e.getClientRects().length>0)`;
  const describe=`(e=>JSON.stringify([e.tagName,e.id,e.getAttribute('type'),e.getAttribute('href'),e.getAttribute('aria-label'),e.textContent]))`;
  const inventory=await evaluate(`${controls}.map(${describe})`);
  for(let index=0;index<inventory.length;index++){
   // Reload the original state before every click: a prior refresh/removal must
   // not shift indices or silently skip a later control. No product count cap.
   await navigate('#summary');
   await evaluate('window.__controlProbeReload=true');await send('Page.reload',{ignoreCache:true});
   await waitFor("!window.__controlProbeReload&&document.readyState==='complete'");await waitFor(summaryDOM(2,3));
   const current=await evaluate(`${controls}.map(${describe})`);
   if(JSON.stringify(current)!==JSON.stringify(inventory))throw Error('Incomplete optional-control coverage: inventory changed after reload');
   const database=JSON.stringify(stored()),requests=uiRequests.length;
   await evaluate(`${controls}[${index}].click()`);await delay(150);
   check('final summary'+' summary control preserves SQLite',JSON.stringify(stored())===database);
   check('final summary'+' summary control makes no mutation request',uiRequests.slice(requests).every(r=>['GET','HEAD'].includes(r.method)));
  }


 await api('/api/tasks/1','PATCH',{completed:false});
 await navigate('#task/1');await waitFor("document.querySelector('#detail')?.dataset.completed==='false'");
 fs.writeFileSync(path.join(root,'arm-update'),'');
 await evaluate("document.querySelector('#toggle').click()");
 for(let i=0;i<150&&!fs.existsSync(path.join(root,'update-received'));i++)await delay(20);
 check('server received full known-valid PATCH body before reload',fs.existsSync(path.join(root,'update-received')));
 await evaluate("history.replaceState(null,'','#summary')");await evaluate('window.__heldReload=true');
 const beforeReloadRequests=new Set(networkRequests.keys());
 const reloading=send('Page.reload',{ignoreCache:true});reloading.catch(()=>{});
 // A correctly ordered server may delay the entire new document. Do not await
 // navigation while the owner is intentionally holding its earlier mutation.
 let reloadDocument;
 for(let n=0;n<150;n++){reloadDocument=[...networkRequests].find(([id,r])=>!beforeReloadRequests.has(id)&&r.resourceType==='Document'&&r.url.startsWith(origin+'/'));if(reloadDocument)break;await delay(25);}
 check('probe observed new Document request before mutation release',!!reloadDocument);
 await delay(2500);
 const summaryFinishedBeforeRelease=[...finishedRequests].some(id=>!beforeReloadRequests.has(id)&&networkRequests.get(id)?.method==='GET'&&networkRequests.get(id)?.loaderId===reloadDocument[1].loaderId&&networkRequests.get(id)?.url===origin+'/api/summary');
 checks.push({name:'reload ordering observation',passed:true,summaryFinishedBeforeRelease});
 fs.writeFileSync(path.join(root,'release-update'),'');
 await reloading;
 await waitFor("!window.__heldReload&&document.readyState==='complete'&&location.hash==='#summary'");
 for(let i=0;i<150&&stored()[0][2]!==1;i++)await delay(20);
 check('server UPDATE committed after reload request started',stored()[0][2]===1);
 let converged=false;
 for(let i=0;i<200;i++){if(await evaluate(summaryDOM(3,3))){converged=true;break;}await delay(25);}
 const observedDOM=await evaluate(`({hash:location.hash,counts:{...document.querySelector('#summary')?.dataset},status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent})`);
 checks.push({name:'post-commit DOM observation',passed:true,observedDOM,expectedCounts:{total:'3',completed:'3',pending:'0'},schedule:{stallLocation:'BaseHTTPRequestHandler.parse_request before application do_PATCH and its lock',holdAfterNewDocumentRequestMilliseconds:2500,postCommitObservationMilliseconds:5000},priorMutation:{method:'PATCH',path:'/api/tasks/1',body:{completed:true},committed:true}});
 check('reloaded summary converges within observation deadline; a received valid update committed but the new document must refresh or wait without browser storage',converged);

 await api('/api/tasks/1','PATCH',{completed:false});
 await navigate('#task/1');await waitFor("document.querySelector('#detail')?.dataset.completed==='false'&&!document.querySelector('#toggle').disabled");
 intercept='hold-patch';await evaluate("document.querySelector('#toggle').click()");
 for(let i=0;i<100&&!held.length;i++)await delay(10);
 check('stale history probe holds original toggle',held.length===1);
 await evaluate("location.hash='#summary'");await waitFor("location.hash==='#summary'");
 await release();await waitFor(summaryDOM(3,3));
 await evaluate("location.hash='#task/1'");await waitFor("document.querySelector('#detail')?.dataset.completed==='true'&&!document.querySelector('#toggle').disabled");
 await evaluate("document.querySelector('#toggle').click()");
 await waitFor("document.querySelector('#detail')?.dataset.completed==='false'&&!document.querySelector('#toggle').disabled");
 check('stale history probe newer opposite toggle committed',stored()[0][2]===0);
 const historyRequestStart=uiRequests.length;
 await evaluate('history.back()');await waitFor(summaryDOM(2,3));
 await evaluate('history.back()');await waitFor("location.hash==='#task/1'");
 await evaluate('window.__staleHistoryReload=true');await send('Page.reload',{ignoreCache:true});
 await waitFor("!window.__staleHistoryReload&&document.readyState==='complete'&&document.querySelector('#detail')?.dataset.taskId==='1'");
 await delay(1000);
 const historyWrites=uiRequests.slice(historyRequestStart).filter(r=>r.method==='PATCH');
 checks.push({name:'stale history observation',passed:true,schedule:['hold true PATCH','navigate summary','release and commit true','toggle and commit false','back to summary','back to earlier detail','reload earlier detail'],expected:{persistedCompleted:0,mutationRequests:0},url:await evaluate('location.href'),persistedCompleted:stored()[0][2],writes:historyWrites.map(r=>({method:r.method,body:r.postData}))});
 check('history traversal followed by reload does not replay obsolete intent',historyWrites.length===0&&stored()[0][2]===0);


 // Keep the previous checks unchanged; this separately forces GET-before-PATCH transport order.
 await api('/api/tasks/1','PATCH',{completed:false});
 await navigate('#task/1');await waitFor("document.querySelector('#detail')?.dataset.completed==='false'&&!document.querySelector('#toggle').disabled");
 intercept='hold-patch';await evaluate("document.querySelector('#toggle').click()");
 for(let i=0;i<100&&!held.length;i++)await delay(10);
 check('transport probe holds PATCH before server acceptance',held.length===1);
 const originalHeldPatch=held[0]; intercept='hold';
 await evaluate("history.replaceState(null,'','#summary');window.__transportReload=true");
 await send('Page.reload',{ignoreCache:true});
 await waitFor("!window.__transportReload&&document.readyState==='complete'&&location.hash==='#summary'");
 await delay(100);
 await evaluate("location.hash='#list'");await waitFor("location.hash==='#list'");
 await delay(100); await evaluate("location.hash='#summary'");await waitFor("location.hash==='#summary'"); await delay(100);
 intercept='hold-patch';
 for(const id of held.filter(id=>id!==originalHeldPatch)){held.splice(held.indexOf(id),1);await send('Fetch.continueRequest',{requestId:id});}
 await delay(100);
 checks.push({name:'transport pre-release observation',passed:true,oldSummaryVisible:await evaluate(summaryDOM(2,3)),dom:await evaluate("({counts:{...document.querySelector('#summary')?.dataset},status:document.querySelector('#status')?.textContent})"),heldRequests:held.length});
 check('transport probe original update remains uncommitted before release',stored()[0][2]===0);
 await release();
 for(let i=0;i<150&&stored()[0][2]!==1;i++)await delay(20);
 check('transport probe PATCH commits after new summary rendered',stored()[0][2]===1);
 let transportConverged=false;
 for(let i=0;i<200;i++){if(await evaluate(summaryDOM(3,3))){transportConverged=true;break;}await delay(25);}
 checks.push({name:'transport probe DOM observation',passed:true,expected:{total:3,completed:3,pending:0},actual:await evaluate("({...document.querySelector('#summary')?.dataset})")});
 check('transport reordered reload converges after committed update',transportConverged);

 await navigate('#summary');await waitFor("document.querySelector('#summary')?.dataset.total==='3'");
 await evaluate("location.hash='#task/1'");await waitFor("document.querySelector('#detail')?.dataset.taskId==='1'&& !document.querySelector('#toggle').disabled");
 intercept='hold-patch';await evaluate("document.querySelector('#toggle').click()");
 for(let i=0;i<100&&!held.length;i++)await delay(10);check('history probe PATCH held',held.length===1);
 await evaluate('history.back()');await delay(100);await release();
 await waitFor("location.hash==='#summary'&&document.querySelector('#summary')?.dataset.total==='3'");
 await evaluate('history.forward()');
 let returned=false;for(let i=0;i<150;i++){if(await evaluate("location.hash==='#task/1'&&document.querySelector('#detail')?.dataset.taskId==='1'")){returned=true;break;}await delay(25);}
 check('pending mutation preserves browser Forward destination',returned);
 check('multi-screen UI attempts no external requests',externalRequests.length===0);

}catch(error){checks.push({name:'oracle execution',passed:false,error:String(error).slice(0,1200)});}
finally{await stop(browser);await stop(server);rejectPending(Error('Oracle closed'));}
const result={schema:'asc-multi-screen-browser-v1',appSha256:createHash('sha256').update(fs.readFileSync(app)).digest('hex'),wallSeconds:(performance.now()-started)/1000,checks,diagnostics:checks.some(c=>!c.passed)?{server:serverDiagnostic,browser:browserDiagnostic}:undefined,limitations:['Requires formal namespace/resource enforcement by caller; oracle itself is not an isolation boundary','Synthetic localhost application; no external provider or production authorization','DOM-dispatched input/click, headless 390px viewport; no physical input, visual audit, or full accessibility validation','Optional summary controls present in the initial inventory are clicked once each from a reloaded summary; dynamic inventories (including benign generated IDs or changing labels) are inconclusive rather than proof of a product defect; controls appearing only after interaction and same-descriptor behavior changes are not covered; 150ms observation does not prove absence of delayed writes or cover all input interactions','Persistence oracle requires SQLite tasks(id,name,completed) schema','Loading/Error use CDP request interception; real HTTP is used for successful interactions']};
console.log(JSON.stringify({schema:result.schema,appSha256:result.appSha256,checks:result.checks.filter(c=>!c.passed||/server received|server UPDATE|reloaded summary|post-commit DOM|reload ordering|probe observed|transport/.test(c.name)),totalChecks:result.checks.length},null,2));
if(checks.some(c=>!c.passed))process.exitCode=1;
