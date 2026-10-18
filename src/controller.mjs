import {performance} from 'node:perf_hooks';
/** Node evaluation engine. Host owns this object and all adapters; Agents never do. */
import {createVerificationGit} from './verification-git.mjs';
import {SOURCE_BATCH_BYTES} from './source-limits.mjs';
import {runBoundedVerification,verificationMemoryLimit} from './verification-resources.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {verifyApproval} from './approval.mjs';

export const hash = data => createHash('sha256').update(data).digest('hex');
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
}
export const digest = value => hash(JSON.stringify(canonical(value)));
function frozen(value) {
  const copy=structuredClone(value);
  const visit=v=>{if(v && typeof v==='object'){Object.values(v).forEach(visit);Object.freeze(v);}return v;};
  return visit(copy);
}
function demand(ok,message) {if(!ok) throw Error(message);}
export function safeName(name) {
  demand(typeof name==='string' && name && !name.includes('\\') && !name.includes(':') &&
    !name.includes('\0') && !path.isAbsolute(name) && name.split('/').every(p=>p && p!=='.' && p!=='..' && p.toLowerCase()!=='.git' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), 'Unsafe source path');
}
export class Controller {
  #hostVerification; #generation=0; #deliveryActive=false; #tests; #review; #approval; #trustedKeys; #events=[]; #submission;
  constructor({repo,base,contract,implementer, trustedKeys=[]}) {
    this.repo=fs.realpathSync(repo);
    this.base=this.git('rev-parse','--verify',`${base}^{commit}`).toString().trim();
    this.contract=frozen(contract);
    demand(typeof implementer==='string' && implementer.length>0,'Implementation context missing');
    this.implementer=implementer;
    this.scope=randomBytes(32).toString('hex');
    this.#trustedKeys=frozen(trustedKeys);
  }
  get events() {return structuredClone(this.#events);}
  git(...args) {return this.gitInput(undefined,...args);}
  gitInput(input,...args) {return this.gitOutput(input,args);}
  gitOutput(input,args,output='pipe') {
    const env={PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',
      GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',
      GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'};
    const p=spawnSync('git',['-c','core.fsmonitor=false','-c',`core.hooksPath=${process.platform==='win32'?'NUL':'/dev/null'}`,
      '-c','protocol.allow=never',...args],{cwd:this.repo,env,input,stdio:['pipe',output,'pipe'],timeout:20000,maxBuffer:16*1024*1024});
    demand(!p.error && p.status===0,'Git observation failed');return p.stdout;
  }
  gitLarge(...args) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asc-git-output-')),file=path.join(dir,'output');
    try{const fd=fs.openSync(file,'wx');try{this.gitOutput(undefined,args,fd);}finally{fs.closeSync(fd);}return fs.readFileSync(file);}
    finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  binding() {return {contract:digest(this.contract),base:this.base,scope:this.scope};}
  needsDesign() {return this.contract.requiresDesign || this.contract.risks?.length>0;}
  approveDesign(envelope) {
    this.#approval=undefined;
    demand(this.needsDesign(),'Approval not applicable');
    this.assertContract();
    const checked=verifyApproval(envelope,this.binding(),this.#trustedKeys);
    this.#approval=frozen(envelope);
    this.#events.push({operation:'design-approval',...checked});
  }
  verificationLimits() {
    const supplied=this.contract.verificationLimits===undefined?{}:this.contract.verificationLimits;
    demand(supplied&&typeof supplied==='object'&&!Array.isArray(supplied),'Invalid verification limits');
    demand(this.contract.verificationResourceProfile===undefined||this.contract.verificationResourceProfile==='browser-cgroup-v1','Unknown verification resource profile');
    const maximum={timeoutMilliseconds:2147483647,cpuSeconds:Number.MAX_SAFE_INTEGER,fileBytes:Number.MAX_SAFE_INTEGER,memoryBytes:4294967296};
    for(const [key,value] of Object.entries(supplied))demand(Object.hasOwn(maximum,key)&&Number.isSafeInteger(value)&&value>0&&value<=maximum[key],'Invalid verification limit');
    if(supplied.memoryBytes!==undefined){demand(this.contract.verificationResourceProfile==='browser-cgroup-v1','Memory budget requires cgroup profile');verificationMemoryLimit(supplied.memoryBytes);}
    return {timeoutMilliseconds:null,cpuSeconds:null,memoryBytes:1073741824,fileBytes:null,...supplied};
  }
  assertContract() {
    this.verificationLimits();
    const c=this.contract;
    demand(c.verificationGit===undefined||c.verificationGit==='shallow-head','Unknown verification Git mode');
    demand(typeof c.intent==='string' && c.intent.trim() && Array.isArray(c.criteria) && c.criteria.length>0 && c.criteria.every(x=>typeof x==='string' && x.trim()),'Incomplete intent or criteria');
    demand(Array.isArray(c.unresolved) && c.unresolved.length===0,'Unresolved owner questions');
    demand(typeof c.policyRevision==='string' && c.policyRevision.trim(),'Policy revision missing');
    demand(Array.isArray(c.risks) && c.risks.every(r=>['authorization','data-migration','public-contract'].includes(r)),'Unknown risk');
    demand(Array.isArray(c.allowedPaths) && c.allowedPaths.length>0,'Allowed paths missing');c.allowedPaths.forEach(safeName);
    const refs=c.policyRefs??[];demand(Array.isArray(refs)&&refs.length<=64,'Invalid owner policy references');const policyPaths=new Set();
    for(const ref of refs){demand(ref&&typeof ref==='object'&&!Array.isArray(ref)&&Object.keys(ref).sort().join(',')==='path,sha256','Invalid owner policy reference');safeName(ref.path);demand(typeof ref.sha256==='string'&&/^[a-f0-9]{64}$/.test(ref.sha256)&&!policyPaths.has(ref.path.toLowerCase())&&!c.allowedPaths.some(p=>p.toLowerCase()===ref.path.toLowerCase())&&!['.codex','.agents'].includes(ref.path.split('/')[0].toLowerCase()),'Owner policy must be unique, pinned and outside Agent write scope');policyPaths.add(ref.path.toLowerCase());}
    const argv=a=>Array.isArray(a) && a.length>0 && a.every(v=>typeof v==='string' && v.length>0 && !v.includes('\0'));
    demand(argv(c.testArgv) && Array.isArray(c.riskTestArgv) && c.riskTestArgv.every(argv),'Verification commands missing');
    demand(Array.isArray(c.requiredChecks) && c.requiredChecks.length>0 && c.requiredChecks.every(v=>typeof v==='string' && v),'Required checks missing');
    demand(!c.risks.length || c.riskTestArgv.length>0,'Risk verification missing');
    demand(!this.needsDesign() || typeof c.design==='string' && c.design.trim(),'Design rationale missing');
  }
  blobs(head) {
    const entries=this.git('ls-tree','-rlz','--full-tree',head).toString('utf8').split('\0').filter(Boolean);
    const portableNames=new Set(),objects=[];
    for(const entry of entries){
      const tab=entry.indexOf('\t'),name=entry.slice(tab+1);
      const fields=entry.slice(0,tab).trim().split(/ +/),[mode,kind,oid,sizeText]=fields;
      safeName(name);demand(!portableNames.has(name.toLowerCase()),'Case-aliased source');portableNames.add(name.toLowerCase());
      demand(fields.length===4&&kind==='blob'&&['100644','100755'].includes(mode)&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid),'Unsupported source type');
      const size=Number(sizeText);
      demand(/^\d+$/.test(sizeText)&&Number.isSafeInteger(size)&&size>=0,'Invalid source byte size');
      objects.push({name,mode,oid,size});
    }
    return this.readBlobs(objects);
  }
  readBlobs(objects,onBlob) {
    const blobs=new Map(),store=(name,blob)=>onBlob?onBlob(name,blob):blobs.set(name,blob);
    if(!objects.length)return blobs;
    // Validate the full inventory/size before requesting any contents. Object IDs,
    // never filenames or source text, form the batch protocol input.
    const batches=[];let batch=[],batchBytes=0;
    for(const object of objects){
      if(object.size>SOURCE_BATCH_BYTES){
        const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asc-blob-')),file=path.join(dir,'blob');
        try{const fd=fs.openSync(file,'wx');try{this.gitOutput(undefined,['cat-file','blob',object.oid],fd);}finally{fs.closeSync(fd);}
          demand(fs.statSync(file).size===object.size,'Truncated blob');store(object.name,{mode:object.mode,oid:object.oid,bytes:fs.readFileSync(file)});
        }finally{fs.rmSync(dir,{recursive:true,force:true});}continue;
      }
      if(batch.length&&batchBytes+object.size>SOURCE_BATCH_BYTES){batches.push(batch);batch=[];batchBytes=0;}
      batch.push(object);batchBytes+=object.size;
    }
    if(batch.length)batches.push(batch);
    for(const group of batches){
    const data=this.gitInput(group.map(o=>o.oid).join('\n')+'\n','cat-file','--batch');let offset=0;
    for(const {name,mode,oid,size} of group){
      const end=data.indexOf(10,offset);demand(end>=offset&&data.subarray(offset,end).toString('ascii')===`${oid} blob ${size}`,'Changed blob header');
      offset=end+1;demand(offset+size<data.length&&data[offset+size]===10,'Truncated blob');
      const bytes=Buffer.from(data.subarray(offset,offset+size));offset+=size+1;
      store(name,{mode,oid,bytes});
    }
    demand(offset===data.length,'Unexpected blob data');
    }
    return blobs;
  }
  // Observe immutable source without executing Git filters or granting approval.
  observeSource() {
    const head=this.git('rev-parse','HEAD').toString().trim();
    const expected=this.blobs(head);const seen=new Set();
    for(const ref of this.contract.policyRefs??[])demand(expected.has(ref.path)&&hash(expected.get(ref.path).bytes)===ref.sha256,'Owner policy changed or missing');
    // The index is independent of working bytes: staged-only edits must survive
    // even when the working file was restored to HEAD. Never refresh it here.
    const indexed=new Set();
    for(const entry of this.git('ls-files','--stage','-z').toString().split('\0').filter(Boolean)) {
      const tab=entry.indexOf('\t');const [mode,oid,stage]=entry.slice(0,tab).split(' ');const name=entry.slice(tab+1);
      const blob=expected.get(name);
      demand(blob && stage==='0' && mode===blob.mode && oid===blob.oid && !indexed.has(name),'Dirty or unmerged index');
      indexed.add(name);
    }
    demand(indexed.size===expected.size,'Missing index entry');
    // Ignored build products remain on the host; snapshots only use Git blobs.
    // Never ignore an existing path the Agent is allowed to create/replace.
    let ignored;
    const trackedDirectories=new Set();
    for(const name of expected.keys()){let parent=path.posix.dirname(name);while(parent!=='.'){trackedDirectories.add(parent);parent=path.posix.dirname(parent);}}
    const walk=(dir,prefix='')=>{
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
        if(!prefix && entry.name==='.git') continue;
        const name=prefix+entry.name;safeName(name);const file=path.join(dir,entry.name);
        demand(!entry.isSymbolicLink(),'Symlink source');
        if(!expected.has(name)&&!trackedDirectories.has(name)){
          ignored??=new Set(this.git('ls-files','--others','--ignored','--exclude-standard','--directory','-z').toString().split('\0').filter(Boolean));
        }
        if(!expected.has(name)&&ignored&&(ignored.has(name)||ignored.has(name+'/'))){
          demand(![...expected.keys()].some(p=>p.startsWith(name+'/')),'Ignored path contains tracked source');
          demand(!this.contract.allowedPaths.some(p=>p===name||p.startsWith(name+'/')||name.startsWith(p+'/')),'Ignored source overlaps allowed write scope');
          demand(entry.isFile()||entry.isDirectory(),'Special ignored source');
          continue;
        }
        if(entry.isDirectory()){walk(file,name+'/');continue;}
        demand(entry.isFile() && expected.has(name),'Untracked or special source');
        const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
        try {
          const st=fs.fstatSync(fd),blob=expected.get(name);
          demand(st.isFile() && st.nlink===1 && st.size===blob.bytes.length,'Aliased or changed source');
          demand(fs.readFileSync(fd).equals(blob.bytes),'Dirty source');
          if(process.platform!=='win32') demand(Boolean(st.mode&0o111)===(blob.mode==='100755'),'Source mode changed');
        }finally{fs.closeSync(fd);}
        seen.add(name);
      }
    };
    walk(this.repo);demand(seen.size===expected.size,'Missing source');
    demand(this.git('rev-parse','HEAD').toString().trim()===head,'HEAD changed during observation');
    return head;
  }
  target({allowEmpty=false}={}) {
    this.assertContract();
    if(this.needsDesign()) {
      try {verifyApproval(this.#approval,this.binding(),this.#trustedKeys);}
      catch(e){this.#approval=undefined;throw e;}
    }
    return this.observeTarget({allowEmpty});
  }
  // Observation grants no approval; execution continues to use target().
  observeTarget({allowEmpty=false}={}) {
    this.assertContract();
    const head=this.observeSource();
    this.git('merge-base','--is-ancestor',this.base,head);
    const changed=this.git('diff','--no-ext-diff','--no-textconv','--name-only','-z',this.base,head).toString().split('\0').filter(Boolean);
    demand((allowEmpty || changed.length>0) && changed.every(p=>this.contract.allowedPaths.includes(p)),'Empty or unauthorized change');
    const diff=this.gitLarge('diff','--no-ext-diff','--no-textconv','--binary',this.base,head);
    demand(this.git('rev-parse','HEAD').toString().trim()===head,'HEAD changed during observation');
    return {head,base:this.base,contract:digest(this.contract),diff:hash(diff),empty:changed.length===0};
  }
  setHostVerification(verify) {demand(typeof verify==='function','Host verification function required');this.#hostVerification=verify;this.#tests=undefined;this.#review=undefined;this.#generation++;}
  // Host-only extension points for pinned runtimes and immutable dependencies.
  sandboxBlobs(head) {return this.blobs(head);}
  sandboxProfile() {return {directories:[],bindings:[],runtimePath:'/usr/bin:/bin',addressLimit:1073741824,readOnly:false};}
  executeVerification(args,timeout=null) {if(this.contract.verificationResourceProfile==='browser-cgroup-v1')return runBoundedVerification(args,timeout,this.verificationLimits().memoryBytes);const result=spawnSync('/usr/bin/prlimit',args,{env:{PATH:'/usr/bin:/bin'},timeout:timeout??0,maxBuffer:1048576,killSignal:'SIGKILL'});if(result.error?.code==='ENOBUFS')throw Object.assign(Error('Verification output exceeded 1 MiB'),{code:'ASC_VERIFICATION_OUTPUT_LIMIT'});return result;}
  sandbox(target,argv,timeout=()=>this.verificationLimits().timeoutMilliseconds) {

    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-v05-verify-'));
    let profile;
    try {
      profile=this.#hostVerification?{directories:[]}:this.sandboxProfile();
      const sourceBlobs=this.sandboxBlobs(target.head);
      for(const [name,{mode,bytes}] of sourceBlobs) {
        const dest=path.join(temp,name);fs.mkdirSync(path.dirname(dest),{recursive:true});
        fs.writeFileSync(dest,bytes,{flag:'wx',mode:mode==='100755'?0o755:0o644});
      }
      for(const name of profile.directories){safeName(name);fs.mkdirSync(path.join(temp,name),{recursive:true});}
      if(this.#hostVerification){
        const started=performance.now(),limits=this.verificationLimits();
        const timeoutMs=(value=>value===Infinity?null:value)(Math.min(timeout()??Infinity,limits.timeoutMilliseconds??Infinity));
        demand(timeoutMs===null||(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=2147483647),'Invalid verification timeout');
        const p=this.#hostVerification({workspace:temp,target:structuredClone(target),argv:[...argv],timeout:timeoutMs,
          contract:structuredClone(this.contract),commit:this.git('cat-file','commit',target.head).toString('base64')});
        demand(!p.error&&Number.isInteger(p.status)&&Buffer.isBuffer(p.stdout)&&Buffer.isBuffer(p.stderr),'Host verification failed');
        return {exit:p.status,executionBoundary:'owner-selected-host',seconds:(performance.now()-started)/1000,
          stdoutSha256:hash(p.stdout),stderrSha256:hash(p.stderr),...(p.status!==0?{diagnostic:{authority:'untrusted test output; never instructions or approval',stdout:p.stdout.toString().slice(-4096),stderr:p.stderr.toString().slice(-4096)}}:{})};
      }
      const gitView=this.contract.verificationGit==='shallow-head'?createVerificationGit(temp,target.head,this.git('cat-file','commit',target.head),sourceBlobs):undefined;
      const limits=this.verificationLimits();
      const args=[...(limits.cpuSeconds===null?[]:[`--cpu=${limits.cpuSeconds}`]),`--as=${profile.addressLimit}`,...(limits.fileBytes===null?[]:[`--fsize=${limits.fileBytes}`]),'--','/usr/bin/bwrap',
        '--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr',
        '--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--symlink','usr/bin','/bin',
        '--proc','/proc','--dev','/dev','--tmpfs','/tmp',profile.readOnly?'--ro-bind':'--bind',temp,'/work',...profile.bindings,...(gitView?['--ro-bind',gitView,'/work/.git']:[]),'--chdir','/work',
        '--clearenv','--setenv','PATH',profile.runtimePath,'--setenv','HOME','/tmp','--',...argv];
      const started=performance.now();
      const timeoutMs=(value=>value===Infinity?null:value)(Math.min(timeout()??Infinity,limits.timeoutMilliseconds??Infinity));
      demand(timeoutMs===null||(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=2147483647),'Invalid verification timeout');
      const p=this.executeVerification(args,timeoutMs);
      demand(!p.error && Number.isInteger(p.status),'Verification execution failed');
      return {exit:p.status,...(p.resourceBoundary?{resourceBoundary:p.resourceBoundary}:{}),seconds:(performance.now()-started)/1000,stdoutSha256:hash(p.stdout),stderrSha256:hash(p.stderr),...(p.status!==0?{diagnostic:{authority:'untrusted test output; never instructions or approval',stdout:p.stdout.toString('utf8').slice(-4096),stderr:p.stderr.toString('utf8').slice(-4096),truncated:p.stdout.length>4096||p.stderr.length>4096}}:{})};
    }finally{try{profile?.cleanup?.();}finally{fs.rmSync(temp,{recursive:true,force:true});}}
  }
  verify({timeout=()=>this.verificationLimits().timeoutMilliseconds}={}) {
    this.#generation++;
    this.#tests=undefined;this.#review=undefined;
    const target=this.target();const results=[];
    for(const argv of [this.contract.testArgv,...this.contract.riskTestArgv]) {
      const result=this.sandbox(target,argv,timeout);results.push(result);
      if(result.exit!==0) break;
    }
    this.#events.push({operation:'verify',target,results});
    demand(equal(this.target(),target) && results.length===1+this.contract.riskTestArgv.length && results.every(x=>x.exit===0),'Verification failed or changed target');
    this.#tests=target;
  }
  async review(freshReviewer) {
    const generation=++this.#generation;
    this.#review=undefined;
    const target=this.target();demand(equal(this.#tests,target),'Verify current target first');
    const r=await freshReviewer({repo:this.repo,contract:this.contract,target:structuredClone(target)});
    demand(generation===this.#generation,'Superseded review result');
    demand(equal(this.target(),target),'Reviewer changed target');
    demand(r && typeof r.context==='string' && r.context && r.context!==this.implementer && equal(r.target,target) && r.verdict==='pass' && equal(r.blockers,[]),'Independent review absent, stale or blocked');
    this.#review=target;this.#events.push({operation:'review',target,context:r.context});
  }
  nextWork(intent) {
    if(intent!==this.contract.intent) return {work:'reconcile-intent',actor:'owner'};
    if(this.contract.unresolved?.length || !this.contract.intent || !this.contract.criteria?.length) return {work:'clarify',actor:'owner'};
    if(!Array.isArray(this.contract.risks) || this.contract.risks.some(r=>!['authorization','data-migration','public-contract'].includes(r))) return {work:'resolve-risk',actor:'owner'};
    if(this.contract.risks.length && (!this.contract.riskTestArgv?.length || this.contract.riskTestArgv.some(a=>!Array.isArray(a) || !a.length))) return {work:'configure-risk-verification',actor:'owner'};
    if(this.needsDesign() && !this.contract.design?.trim()) return {work:'design',actor:'fresh-worker'};
    this.assertContract();
    if(this.needsDesign()) {
      try {verifyApproval(this.#approval,this.binding(),this.#trustedKeys);}
      catch {this.#approval=undefined;return {work:'design-approval',actor:'owner'};}
    }
    const target=this.target({allowEmpty:true});
    if(target.empty) return {work:'implementation',actor:'fresh-worker',target};
    if(!equal(this.#tests,target)) return {work:'verify',actor:'controller',target};
    if(!equal(this.#review,target)) return {work:'independent-review',actor:'fresh-reviewer',target};
    return {work:'delivery',actor:'controller',target};
  }
  ready(intent) {
    const target=this.target();demand(intent===this.contract.intent,'Primary intent changed');
    demand(equal(this.#tests,target) && equal(this.#review,target),'Current verification or review missing');return target;
  }
  async delivery(provider) {
    demand(!this.#deliveryActive,'Delivery already in progress');
    this.#deliveryActive=true;
    try {
    const target=this.ready(await provider.intent());
    const pr=equal(this.#submission?.target,target)?this.#submission.pr:await provider.createDraft(target.head);
    this.#submission={target,pr};this.ready(await provider.intent());
    const r=await provider.observe(pr);
    demand(r && r.head===target.head && r.draft===true && r.merged===false && r.boundToPr===true && this.contract.requiredChecks.every(n=>r.checks?.[n]==='success'),'Remote PR/CI not bound to reviewed target');
    demand(equal(this.ready(await provider.intent()),target),'Delivery target changed');
    this.#events.push({operation:'delivery',target,pr,...(r.transportFailures?.length?{transportFailures:r.transportFailures}:{})});return {target,pr,events:this.events};
    } finally {this.#deliveryActive=false;}
  }
}
