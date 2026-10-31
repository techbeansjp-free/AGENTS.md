import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Read-only Docker cleanup plan for one worktree (skills/asc/references/post-merge.md).
 * The plan lists candidates only: it never deletes, stops or runs compose, and it is not a deletion permission.
 */
const PROJECT='com.docker.compose.project',WORKING_DIR='com.docker.compose.project.working_dir',ANONYMOUS='com.docker.volume.anonymous';
// The only Docker subcommands this module can reach. Anything else is rejected before the runner is called.
const READ_ONLY=new Set(['version','container ls','container inspect','volume ls','volume inspect','image ls','image inspect','network ls','network inspect']);

export function defaultDockerRunner(args){
 const p=spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
 return {status:p.status,stdout:p.stdout??'',stderr:p.stderr??'',error:p.error};
}

export function readOnlyDocker(runner=defaultDockerRunner){
 return args=>{
  if(!Array.isArray(args)||!args.every(a=>typeof a==='string'))throw Error('Docker arguments must be strings');
  const key=args[0]==='version'?'version':`${args[0]} ${args[1]}`;
  if(!READ_ONLY.has(key))throw Error(`Docker subcommand is not read-only: ${key}`);
  const p=runner(args);
  if(p.error?.code==='ETIMEDOUT')throw Error(`Docker did not respond to ${key} (nothing was deleted)`);
  if(p.error)throw Error(`Docker is unavailable for ${key}: ${p.error.message} (nothing was deleted)`);
  if(p.status!==0)throw Error(`Docker ${key} failed: ${String(p.stderr).trim().slice(0,2000)||`exit ${p.status}`} (nothing was deleted)`);
  return String(p.stdout);
 };
}

/** Compose's default project name rule: lower case, keep [a-z0-9_-], drop leading '_' and '-'. */
export function composeProjectName(directory){
 return [...String(directory).toLowerCase()].filter(c=>/[a-z0-9_-]/.test(c)).join('').replace(/^[_-]+/,'');
}

function within(root,candidate){
 const relative=path.relative(root,candidate);
 return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
}

/** Observation layer: only labelled resources and those mounted or used by the project containers are listed. */
export function observeDocker({worktree,project,label,projectSource='explicit',labelSource='explicit'},runner){
 const docker=readOnlyDocker(runner);
 const lines=args=>docker(args).split('\n').map(s=>s.trim()).filter(Boolean);
 const unique=values=>[...new Set(values)].sort();
 const inspect=(kind,ids)=>ids.length?JSON.parse(docker([kind,'inspect',...ids])):[];
 const ls={
  container:filter=>unique(lines(['container','ls','-a','--no-trunc','--filter',filter,'--format','{{.ID}}'])),
  volume:filter=>unique(lines(['volume','ls','--filter',filter,'--format','{{.Name}}'])),
  image:filter=>unique(lines(['image','ls','-a','--no-trunc','--filter',filter,'--format','{{.ID}}'])),
  network:filter=>unique(lines(['network','ls','--no-trunc','--filter',filter,'--format','{{.ID}}']))
 };
 const observedAt=new Date().toISOString();
 try{docker(['version','--format','{{.Server.Version}}']);}catch(e){throw Error(`Docker is unavailable; nothing was deleted: ${e.message}`,{cause:e});}
 const byProject=`label=${PROJECT}=${project}`,byLabel=`label=${label.key}=${label.value}`;
 const composeContainers=inspect('container',ls.container(byProject));
 const labelContainers=inspect('container',ls.container(byLabel));
 const mounted=composeContainers.flatMap(c=>(c.Mounts??[]).filter(m=>m.Type==='volume'&&m.Name).map(m=>m.Name));
 const volumes=inspect('volume',unique([...ls.volume(byProject),...ls.volume(byLabel),...mounted]));
 const images=inspect('image',unique([...ls.image(byProject),...ls.image(byLabel),...composeContainers.map(c=>c.Image).filter(Boolean)]));
 const networks=inspect('network',unique([...ls.network(byProject),...ls.network(byLabel)]));
 const workingDirs={};
 for(const c of composeContainers){
  const value=c.Config?.Labels?.[WORKING_DIR];
  if(typeof value!=='string'||!path.isAbsolute(value)){workingDirs[c.Id]=null;continue;}
  let resolved=path.resolve(value);try{resolved=fs.realpathSync(resolved);}catch{ /* A removed directory is compared lexically. */ }
  workingDirs[c.Id]=resolved;
 }
 const users={
  volume:Object.fromEntries(volumes.map(v=>[v.Name,ls.container(`volume=${v.Name}`)])),
  image:Object.fromEntries(images.map(i=>[i.Id,ls.container(`ancestor=${i.Id}`)])),
  // A created (never started) container matches its network by name only, so join the ID and name filters.
  network:Object.fromEntries(networks.map(n=>[n.Id,unique([...ls.container(`network=${n.Id}`),...(n.Name?ls.container(`network=${n.Name}`):[])])]))
 };
 return {worktree,project,label,projectSource,labelSource,observedAt,composeContainers,labelContainers,volumes,images,networks,workingDirs,users};
}

/** Decision layer: a pure function of the observation. */
export function buildDockerCleanupPlan(o){
 const P=o.project,ours=labels=>labels[o.label.key]===o.label.value;
 const name=c=>String(c.Name??'').replace(/^\//,'');
 const compose=o.composeContainers.map(c=>{
  const workingDir=c.Config?.Labels?.[WORKING_DIR]??null,resolved=o.workingDirs[c.Id]??null;
  return {id:c.Id,name:name(c),workingDir,underWorktree:resolved!==null&&within(o.worktree,resolved)};
 });
 const composeIds=new Set(compose.map(c=>c.id)),outside=compose.filter(c=>!c.underWorktree).map(c=>c.id);
 const eligible=compose.length>0&&outside.length===0;
 const reason=compose.length===0?'no-project-containers':outside.length?'working-dir-outside-worktree':'all-containers-under-worktree';
 const plan={containers:{delete:[],retain:[]},volumes:{delete:[],retain:[]},images:{delete:[],retain:[]},networks:{delete:[],retain:[]}};
 const own=new Set(eligible?composeIds:[]),seen=new Set();
 for(const c of o.composeContainers)plan.containers[eligible?'delete':'retain'].push(eligible?{id:c.Id,name:name(c),via:'compose-down'}:{id:c.Id,name:name(c),reason:'compose-project-not-eligible'});
 for(const c of o.labelContainers){
  if(composeIds.has(c.Id)||seen.has(c.Id))continue;seen.add(c.Id);
  const project=c.Config?.Labels?.[PROJECT];
  if(project!==undefined)plan.containers.retain.push({id:c.Id,name:name(c),reason:'other-compose-project',project});
  else{plan.containers.delete.push({id:c.Id,name:name(c),via:'rm-v',state:c.State?.Status??null});own.add(c.Id);}
 }
 const others=ids=>(ids??[]).filter(id=>!own.has(id)).sort();
 // Shared order: worktree label, other project, project eligibility, kind rule, then use by other containers.
 const classify=(labels,users,rule)=>{
  const project=labels[PROJECT],usedBy=others(users),used=usedBy.length?{reason:'used-by-other-container',usedBy}:null;
  if(project===undefined&&ours(labels))return used??{via:'label'};
  if(project!==undefined&&project!==P)return {reason:'other-compose-project',project};
  if(!eligible)return {reason:'compose-project-not-eligible'};
  const failed=rule();return failed?{reason:failed}:used??{via:'compose'};
 };
 const place=(kind,identity,decision,via)=>{
  if(decision.reason)plan[kind].retain.push({...identity,...decision});
  else plan[kind].delete.push({...identity,via:via(decision.via)});
 };
 const mounted=new Set(o.composeContainers.flatMap(c=>(c.Mounts??[]).filter(m=>m.Type==='volume').map(m=>m.Name)));
 for(const v of o.volumes){
  const labels=v.Labels??{},anonymous=Object.hasOwn(labels,ANONYMOUS);
  place('volumes',{name:v.Name},classify(labels,o.users.volume[v.Name],()=>!mounted.has(v.Name)?'not-mounted-by-project-containers':anonymous||(v.Name.startsWith(`${P}_`)&&labels[PROJECT]===P)?null:'not-project-owned-name'),()=>'volume-rm');
 }
 for(const i of o.images){
  const labels=i.Config?.Labels??{},tags=[...(i.RepoTags??[])].sort();
  place('images',{id:i.Id,tags},classify(labels,o.users.image[i.Id],()=>labels[PROJECT]!==P?'no-project-label':tags.every(t=>t.startsWith(`${P}-`))?null:'non-project-tag'),()=>'image-rm-no-prune');
 }
 for(const n of o.networks)place('networks',{id:n.Id,name:n.Name},classify(n.Labels??{},o.users.network[n.Id],()=>null),via=>via==='compose'?'compose-down':'network-rm');
 const order=(a,b)=>String(a.id??a.name).localeCompare(String(b.id??b.name));
 for(const kind of Object.values(plan))for(const list of Object.values(kind))list.sort(order);
 const explicit=[o.projectSource==='explicit'?'--project':null,o.labelSource==='explicit'?'--label':null].filter(Boolean);
 return {schema:'asc-docker-cleanup-plan/v1',observedAt:o.observedAt,worktree:o.worktree,project:P,projectSource:o.projectSource,label:`${o.label.key}=${o.label.value}`,labelSource:o.labelSource,deletionAuthorized:false,
  compose:{project:P,eligible,reason,containers:compose.sort(order),outsideWorktree:outside.sort(),
   down:{recommended:eligible,reason,removeOrphans:eligible,volumes:false,rmi:false}},
  ...plan,
  notices:['This plan is not a deletion permission. Confirm the worktree removal decision, then delete each listed resource individually.',
   'Save this plan before compose down so the recorded volumes remain available; run down with the compose files used at startup.',
   'Build cache and unlabelled resources are not listed.',
   'Dependencies between images are not detected; if docker image rm --no-prune fails, report that image as retained.',
   ...(explicit.length?[`The correspondence between the explicit ${explicit.join(' and ')} value and this worktree was not verified.`]:[])]};
}

export function planDockerCleanup(worktree,{project,label,runner}={}){
 const root=fs.realpathSync(worktree);
 if(!fs.statSync(root).isDirectory())throw Error('Worktree must be a directory');
 const name=project??composeProjectName(path.basename(root));
 if(!/^[a-z0-9][a-z0-9_-]*$/.test(name))throw Error(`Invalid compose project name: ${JSON.stringify(name)}; pass --project <name>`);
 let parsed={key:'asc.worktree',value:root};
 if(label!==undefined){
  const at=label.indexOf('=');
  if(at<1||at===label.length-1)throw Error('Expected --label <key>=<value>');
  parsed={key:label.slice(0,at),value:label.slice(at+1)};
 }
 return buildDockerCleanupPlan(observeDocker({worktree:root,project:name,label:parsed,projectSource:project===undefined?'default':'explicit',labelSource:label===undefined?'default':'explicit'},runner));
}
