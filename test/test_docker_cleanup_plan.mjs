import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readOnlyDocker,composeProjectName,planDockerCleanup} from '../src/docker-cleanup-plan.mjs';
const cli=fileURLToPath(new URL('../bin/asc-v05.mjs',import.meta.url));
// Written independently of the implementation: every Docker call must be one of these read-only forms.
const READ_ONLY_CALLS=['version','container ls','container inspect','volume ls','volume inspect','image ls','image inspect','network ls','network inspect'];
const MUTATING_WORDS=['rm','rmi','down','stop','kill','prune','create','run','start','up','remove','disconnect'];
// Fake docker on PATH: answers ls/inspect from a JSON state file and logs every argv.
const FAKE=`#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.FAKE_DOCKER_LOG,JSON.stringify(args)+'\\n');
const s=JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER_STATE,'utf8'));
if(args[0]==='version'){if(s.unavailable){process.stderr.write('Cannot connect to the Docker daemon');process.exit(1);}console.log('29.0.0');process.exit(0);}
const kind=args[0],records={container:s.containers,volume:s.volumes,image:s.images,network:s.networks}[kind];
if(!records){process.stderr.write('unsupported '+args.join(' '));process.exit(1);}
const id=r=>kind==='volume'?r.Name:r.Id,labels=r=>(kind==='container'||kind==='image'?r.Config.Labels:r.Labels)??{};
if(args[1]==='ls'){
 const filter=args[args.indexOf('--filter')+1],at=filter.indexOf('='),type=filter.slice(0,at),value=filter.slice(at+1);
 let match;
 if(type==='label'){const k=value.slice(0,value.indexOf('=')),v=value.slice(value.indexOf('=')+1);match=r=>labels(r)[k]===v;}
 else if(type==='volume')match=r=>r.Mounts.some(m=>m.Name===value);
 else if(type==='ancestor')match=r=>r.Image===value;
 // Real Docker 29.7.2: a started container matches by network ID or name, a created one by name only.
 else if(type==='network')match=r=>r.networks.some(id=>id===value||s.networks.find(n=>n.Id===id)?.Name===value)||(r.createdNetworks??[]).includes(value);
 else{process.stderr.write('unsupported filter');process.exit(1);}
 for(const r of records)if(match(r))console.log(id(r));process.exit(0);
}
if(args[1]==='inspect'){const out=[];for(const want of args.slice(2)){const r=records.find(x=>id(x)===want);if(!r){process.stderr.write('No such object: '+want);process.exit(1);}out.push(r);}console.log(JSON.stringify(out));process.exit(0);}
process.stderr.write('unsupported '+args.join(' '));process.exit(1);
`;
const P='featuredocker-1';
function fixture(t,{unavailable=false,siblingContainer=false,createdOnNetwork=false,workingDir}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'asc-docker-plan-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const work=path.join(root,'Feature.Docker-1'),bin=path.join(root,'bin');fs.mkdirSync(path.join(work,'services/api'),{recursive:true});fs.mkdirSync(bin);fs.mkdirSync(`${work}-copy`);fs.symlinkSync(work,path.join(root,'alias'));
 fs.writeFileSync(path.join(bin,'docker'),FAKE,{mode:0o755});
 const project=(p,wd)=>({'com.docker.compose.project':p,'com.docker.compose.project.working_dir':wd});
 const container=(Id,Labels,Mounts,Image,networks)=>({Id,Name:`/${Id}-name`,Image,State:{Status:'exited'},Config:{Labels},Mounts:Mounts.map(Name=>({Type:'volume',Name})),networks});
 const mark={'asc.worktree':work};
 const containers=[
  container('c1',project(P,work),['anon1',`${P}_data`,'shared-db',`${P}_impostor`,`${P}_unlabelled`,`${P}-fixed`,'label-vol-other'],'sha256:img-web',['net-default','net-shared']),
  container('c2',project(P,path.join(root,'alias/services/api')),[`${P}_cache`],'sha256:img-postgres',['net-default']),
  container('x1',project('other',path.join(root,'other')),[`${P}_cache`,'label-vol-shared'],'sha256:img-dangling-used',['net-shared']),
  container('l1',mark,[],'sha256:img-label',['net-label']),
  container('l2',{...mark,'com.docker.compose.project':'other'},[],'sha256:img-host',[]),
  container('h1',{},['host-volume'],'sha256:img-host',[])
 ];
 if(createdOnNetwork)containers.push({...container('x2',project('other',path.join(root,'other')),[],'sha256:img-host',[]),State:{Status:'created'},createdNetworks:['scratch-net']});
 if(workingDir!==undefined)containers.push(container('c4',{'com.docker.compose.project':P,...(workingDir===null?{}:{'com.docker.compose.project.working_dir':workingDir})},[],'sha256:img-web',[]));
 if(siblingContainer)containers.push(container('c3',project(P,`${work}-copy`),[],'sha256:img-web',['net-default']));
 const volumes=[
  {Name:'anon1',Labels:{'com.docker.volume.anonymous':''}},{Name:`${P}_data`,Labels:{'com.docker.compose.project':P}},{Name:'shared-db',Labels:{}},
  {Name:`${P}_cache`,Labels:{'com.docker.compose.project':P}},{Name:`${P}_orphan`,Labels:{'com.docker.compose.project':P}},{Name:`${P}_impostor`,Labels:{'com.docker.compose.project':'other'}},
  {Name:`${P}_unlabelled`,Labels:{}},{Name:`${P}-fixed`,Labels:{'com.docker.compose.project':P}},{Name:'label-vol-other',Labels:{...mark,'com.docker.compose.project':'other'}},
  {Name:'label-vol',Labels:mark},{Name:'label-vol-shared',Labels:mark},{Name:'host-volume',Labels:null}
 ];
 const image=(Id,RepoTags,Labels)=>({Id,RepoTags,Config:{Labels}});
 const images=[
  image('sha256:img-web',[`${P}-web:latest`],{'com.docker.compose.project':P}),image('sha256:img-postgres',['postgres:16'],null),
  image('sha256:img-mixed',[`${P}-worker:latest`,'team/worker:1'],{'com.docker.compose.project':P}),image('sha256:img-dangling-used',[],{'com.docker.compose.project':P}),
  image('sha256:img-prefix',[`${P}0-api:1`],{'com.docker.compose.project':P}),image('sha256:img-dangling',[],{'com.docker.compose.project':P}),image('sha256:img-label',['scratch-tool:1'],mark),image('sha256:img-host',['busybox:1'],null)
 ];
 const networks=[{Id:'net-default',Name:`${P}_default`,Labels:{'com.docker.compose.project':P}},{Id:'net-shared',Name:`${P}_shared`,Labels:{'com.docker.compose.project':P}},{Id:'net-label',Name:'scratch-net',Labels:mark},{Id:'net-host',Name:'bridge',Labels:{}}];
 const state=path.join(root,'state.json'),log=path.join(root,'docker.log');fs.writeFileSync(state,JSON.stringify({unavailable,containers,volumes,images,networks}));
 const runIn=(cwd,...args)=>spawnSync(process.execPath,[cli,'docker-cleanup-plan',...args],{cwd,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,FAKE_DOCKER_STATE:state,FAKE_DOCKER_LOG:log}}),run=(...args)=>runIn(undefined,...args);
 const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
 return {root,work,run,runIn,calls};
}
const byKey=list=>Object.fromEntries(list.map(e=>[e.id??e.name,e]));
function assertReadOnly(calls){
 assert.ok(calls.length>0);
 for(const args of calls){
  assert.ok(READ_ONLY_CALLS.includes(args[0]==='version'?'version':`${args[0]} ${args[1]}`),JSON.stringify(args));
  assert.equal(args.some(a=>MUTATING_WORDS.includes(a)),false,JSON.stringify(args));
 }
}

test('CLI plans deletion candidates for an eligible compose project and worktree label without mutating Docker',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),p=f.run(f.work);assert.equal(p.status,0,p.stderr);const plan=JSON.parse(p.stdout);
 assert.equal(plan.project,P);assert.equal(plan.label,`asc.worktree=${f.work}`);assert.equal(plan.deletionAuthorized,false);
 assert.equal(plan.projectSource,'default');assert.equal(plan.labelSource,'default');assert.equal(plan.notices.some(n=>/not verified/.test(n)),false);
 assert.match(plan.observedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);assert.ok(Math.abs(Date.parse(plan.observedAt)-Date.now())<60000);
 assert.ok(plan.notices.includes('Dependencies between images are not detected; if docker image rm --no-prune fails, report that image as retained.'));
 assert.equal(plan.compose.eligible,true);assert.deepEqual(byKey(plan.compose.containers).c2,{id:'c2',name:'c2-name',workingDir:path.join(f.root,'alias/services/api'),underWorktree:true});assert.equal(plan.compose.reason,'all-containers-under-worktree');assert.deepEqual(plan.compose.outsideWorktree,[]);
 assert.deepEqual(plan.compose.down,{recommended:true,reason:'all-containers-under-worktree',removeOrphans:true,volumes:false,rmi:false});
 assert.deepEqual(byKey(plan.containers.delete),{c1:{id:'c1',name:'c1-name',via:'compose-down'},c2:{id:'c2',name:'c2-name',via:'compose-down'},l1:{id:'l1',name:'l1-name',via:'rm-v',state:'exited'}});
 assert.deepEqual(byKey(plan.containers.retain),{l2:{id:'l2',name:'l2-name',reason:'other-compose-project',project:'other'}});
 assert.deepEqual(byKey(plan.volumes.delete),{anon1:{name:'anon1',via:'volume-rm'},[`${P}_data`]:{name:`${P}_data`,via:'volume-rm'},'label-vol':{name:'label-vol',via:'volume-rm'}});
 assert.deepEqual(byKey(plan.volumes.retain),{
  'shared-db':{name:'shared-db',reason:'not-project-owned-name'},[`${P}_cache`]:{name:`${P}_cache`,reason:'used-by-other-container',usedBy:['x1']},
  [`${P}_orphan`]:{name:`${P}_orphan`,reason:'not-mounted-by-project-containers'},[`${P}_impostor`]:{name:`${P}_impostor`,reason:'other-compose-project',project:'other'},
  'label-vol-shared':{name:'label-vol-shared',reason:'used-by-other-container',usedBy:['x1']},
  [`${P}_unlabelled`]:{name:`${P}_unlabelled`,reason:'not-project-owned-name'},[`${P}-fixed`]:{name:`${P}-fixed`,reason:'not-project-owned-name'},
  'label-vol-other':{name:'label-vol-other',reason:'other-compose-project',project:'other'}});
 assert.deepEqual(byKey(plan.images.delete),{'sha256:img-web':{id:'sha256:img-web',tags:[`${P}-web:latest`],via:'image-rm-no-prune'},'sha256:img-dangling':{id:'sha256:img-dangling',tags:[],via:'image-rm-no-prune'},'sha256:img-label':{id:'sha256:img-label',tags:['scratch-tool:1'],via:'image-rm-no-prune'}});
 assert.deepEqual(byKey(plan.images.retain),{
  'sha256:img-postgres':{id:'sha256:img-postgres',tags:['postgres:16'],reason:'no-project-label'},
  'sha256:img-mixed':{id:'sha256:img-mixed',tags:['featuredocker-1-worker:latest','team/worker:1'],reason:'non-project-tag'},
  'sha256:img-dangling-used':{id:'sha256:img-dangling-used',tags:[],reason:'used-by-other-container',usedBy:['x1']},
  'sha256:img-prefix':{id:'sha256:img-prefix',tags:['featuredocker-10-api:1'],reason:'non-project-tag'}});
 assert.deepEqual(byKey(plan.networks.delete),{'net-default':{id:'net-default',name:`${P}_default`,via:'compose-down'},'net-label':{id:'net-label',name:'scratch-net',via:'network-rm'}});
 assert.deepEqual(byKey(plan.networks.retain),{'net-shared':{id:'net-shared',name:`${P}_shared`,reason:'used-by-other-container',usedBy:['x1']}});
 // Unlabelled host resources are never listed.
 const listed=['containers','volumes','images','networks'].flatMap(kind=>[...plan[kind].delete,...plan[kind].retain].map(e=>e.id??e.name));
 for(const absent of ['h1','x1','host-volume','sha256:img-host','net-host'])assert.equal(listed.includes(absent),false,absent);
 assertReadOnly(f.calls());
});

test('a project container outside the worktree (sibling path prefix) makes the compose project ineligible',{skip:process.platform==='win32'},t=>{
 const f=fixture(t,{siblingContainer:true}),p=f.run(f.work);assert.equal(p.status,0,p.stderr);const plan=JSON.parse(p.stdout);
 assert.equal(plan.compose.eligible,false);assert.equal(plan.compose.reason,'working-dir-outside-worktree');assert.deepEqual(plan.compose.outsideWorktree,['c3']);
 assert.equal(byKey(plan.compose.containers).c3.underWorktree,false);assert.equal(byKey(plan.compose.containers).c2.underWorktree,true);
 assert.equal(plan.compose.down.recommended,false);assert.equal(plan.compose.down.reason,'working-dir-outside-worktree');
 assert.deepEqual(plan.containers.delete,[{id:'l1',name:'l1-name',via:'rm-v',state:'exited'}]);
 for(const id of ['c1','c2','c3'])assert.equal(byKey(plan.containers.retain)[id].reason,'compose-project-not-eligible');
 assert.deepEqual(plan.volumes.delete,[{name:'label-vol',via:'volume-rm'}]);
 for(const name of ['anon1',`${P}_data`,`${P}_cache`,`${P}_orphan`,'shared-db'])assert.equal(byKey(plan.volumes.retain)[name].reason,'compose-project-not-eligible',name);
 assert.equal(byKey(plan.volumes.retain)[`${P}_impostor`].reason,'other-compose-project');
 assert.deepEqual(plan.images.delete.map(i=>i.id),['sha256:img-label']);assert.equal(byKey(plan.images.retain)['sha256:img-web'].reason,'compose-project-not-eligible');
 assert.deepEqual(plan.networks.delete,[{id:'net-label',name:'scratch-net',via:'network-rm'}]);assert.equal(byKey(plan.networks.retain)['net-default'].reason,'compose-project-not-eligible');
 assertReadOnly(f.calls());
});

test('explicit project and label select only those markers; a project without containers is not eligible',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),p=f.run(f.work,'--project','absent','--label','asc.worktree=/nowhere');assert.equal(p.status,0,p.stderr);const plan=JSON.parse(p.stdout);
 assert.equal(plan.project,'absent');assert.equal(plan.label,'asc.worktree=/nowhere');assert.equal(plan.projectSource,'explicit');assert.equal(plan.labelSource,'explicit');
 assert.ok(plan.notices.includes('The correspondence between the explicit --project and --label value and this worktree was not verified.'));
 assert.equal(f.calls().some(a=>a.includes(`label=com.docker.compose.project=${P}`)),false);
 const onlyLabel=JSON.parse(f.run(f.work,'--label','asc.worktree=/nowhere').stdout);assert.equal(onlyLabel.projectSource,'default');assert.equal(onlyLabel.labelSource,'explicit');
 assert.ok(onlyLabel.notices.includes('The correspondence between the explicit --label value and this worktree was not verified.'));
 assert.equal(plan.compose.eligible,false);assert.equal(plan.compose.reason,'no-project-containers');assert.equal(plan.compose.down.recommended,false);
 for(const kind of ['containers','volumes','images','networks'])assert.deepEqual(plan[kind],{delete:[],retain:[]},kind);
 for(const bad of [['--label','novalue'],['--label','=x'],['--project','Bad.Name'],['--output'],['--project','a','--project','b'],['--force','x']]){
  const r=f.run(f.work,...bad);assert.equal(r.status,1,bad.join(' '));assert.match(r.stderr,/docker-cleanup-plan|--label|Invalid compose project name|Usage/,bad.join(' '));
 }
});

test('unavailable Docker exits 1 before any observation and leaves no output file',{skip:process.platform==='win32'},t=>{
 const f=fixture(t,{unavailable:true}),output=path.join(f.root,'plan.json'),p=f.run(f.work,'--output',output);
 assert.equal(p.status,1);assert.match(p.stderr,/Docker is unavailable; nothing was deleted: .*Cannot connect to the Docker daemon/);
 assert.equal(fs.existsSync(output),false);assert.deepEqual(f.calls().map(a=>a[0]),['version']);
});

test('--output stores the plan outside the worktree without overwriting',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),output=path.join(f.root,'plan.json'),p=f.run(f.work,'--output',output);assert.equal(p.status,0,p.stderr);
 const result=JSON.parse(p.stdout),bytes=fs.readFileSync(output);
 assert.equal(result.schema,'asc-docker-cleanup-plan-output/v1');assert.equal(result.output,output);assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(JSON.parse(bytes),result.plan);
 const again=f.run(f.work,'--output',output);assert.equal(again.status,1);assert.match(again.stderr,/EEXIST/);assert.deepEqual(fs.readFileSync(output),bytes);
 const inside=f.run(f.work,'--output',path.join(f.work,'plan.json'));assert.equal(inside.status,1);assert.match(inside.stderr,/Docker cleanup plan output must be outside the worktree/);assert.equal(fs.existsSync(path.join(f.work,'plan.json')),false);
});

test('a created container joined to a network by name keeps that network',{skip:process.platform==='win32'},t=>{
 const f=fixture(t,{createdOnNetwork:true}),p=f.run(f.work);assert.equal(p.status,0,p.stderr);const plan=JSON.parse(p.stdout);
 assert.deepEqual(byKey(plan.networks.retain)['net-label'],{id:'net-label',name:'scratch-net',reason:'used-by-other-container',usedBy:['x2']});
 assert.equal(byKey(plan.networks.delete)['net-label'],undefined);assert.ok(f.calls().some(a=>a.includes('network=scratch-net')));assertReadOnly(f.calls());
});

test('a project container without an absolute working_dir label makes the compose project ineligible',{skip:process.platform==='win32'},t=>{
 // The relative value names an existing directory inside the worktree and is resolved from there if absoluteness is not checked.
 for(const workingDir of [null,'services/api']){
  const f=fixture(t,{workingDir}),p=f.runIn(f.work,f.work);assert.equal(p.status,0,p.stderr);const plan=JSON.parse(p.stdout);
  assert.equal(plan.compose.eligible,false,String(workingDir));assert.equal(plan.compose.reason,'working-dir-outside-worktree');assert.deepEqual(plan.compose.outsideWorktree,['c4']);
  assert.deepEqual(byKey(plan.compose.containers).c4,{id:'c4',name:'c4-name',workingDir,underWorktree:false});assert.equal(plan.compose.down.recommended,false);
 }
});

test('read-only guard rejects mutating subcommands before calling the runner',()=>{
 const seen=[],docker=readOnlyDocker(args=>{seen.push(args);return {status:0,stdout:'',stderr:''};});
 for(const args of [['volume','rm','x'],['container','rm','-v','c'],['compose','down'],['system','prune'],['image','rm','--no-prune','i'],['network','rm','n'],['container','stop','c'],['builder','prune']])assert.throws(()=>docker(args),/not read-only/,args.join(' '));
 assert.throws(()=>docker(['container',1]),/must be strings/);
 assert.deepEqual(seen,[]);docker(['volume','ls']);assert.deepEqual(seen,[['volume','ls']]);
 const failing=readOnlyDocker(()=>({status:null,stdout:'',stderr:'',error:Object.assign(Error('spawnSync docker ETIMEDOUT'),{code:'ETIMEDOUT'})}));
 assert.throws(()=>failing(['version']),/did not respond/);
});

test('default project name follows the compose normalization rule and empty names require --project',t=>{
 assert.equal(composeProjectName('Feature.Docker-1'),'featuredocker-1');assert.equal(composeProjectName('_My App'),'myapp');assert.equal(composeProjectName('--x_Y'),'x_y');
 assert.equal(composeProjectName('20261101_064053-1611-docker-cleanup-plan'),'20261101_064053-1611-docker-cleanup-plan');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-docker-name-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'__.'));
 let called=false;assert.throws(()=>planDockerCleanup(path.join(root,'__.'),{runner:()=>{called=true;return {status:0,stdout:'',stderr:''};}}),/Invalid compose project name: ""; pass --project/);assert.equal(called,false);
});
