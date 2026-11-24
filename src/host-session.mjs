/** Read-only, named Host sessions. Result artifacts are independent of display-name updates. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout,clearTimeout} from 'node:timers';
import {sessionRpc} from './session-rpc.mjs';
import {GIT_NULL_DEVICE,gitPathOutput} from './source-limits.mjs';
import {codexRuntimeRoots,sandboxFilesystemBase,MACOS_MIN_CODEX_VERSION} from './codex-runtime.mjs';

export function sessionOptions(args){
 const options={ephemeral:false,timeout:900000},seen=new Set();
 const names={'--name':'name','--model':'model','--rename-model':'renameModel','--executable':'executable','--prompt-file':'promptFile','--output-dir':'outputDir','--timeout-ms':'timeout'};
 [options.host,options.cwd]=args;
 for(let i=2;i<args.length;i++){
  if(args[i]==='--ephemeral'&&!options.ephemeral){options.ephemeral=true;continue;}
  const key=names[args[i]];
  if(!key||args[i+1]===undefined||seen.has(key))throw Error('Invalid or duplicate host-session option');
  seen.add(key);options[key]=args[++i];
 }
 if(!['claude','codex'].includes(options.host))throw Error('Host must be claude or codex');
 for(const key of ['cwd','name','model','promptFile','outputDir'])if(typeof options[key]!=='string'||!options[key].trim())throw Error(`Missing host-session ${key}`);
 if(/[\r\n\x00]/.test(options.name)||options.name.length>200)throw Error('Session name must be one line, at most 200 characters');
 options.timeout=Number(options.timeout);
 if(!Number.isSafeInteger(options.timeout)||options.timeout<100||options.timeout>86400000)throw Error('Invalid timeout-ms');
 if(options.renameModel!==undefined&&(options.host!=='claude'||!options.renameModel.trim()))throw Error('rename-model requires Claude and a model');
 options.executable??=options.host;
 return options;
}

/** Resolve the primary checkout (Codex listing directory) separately from the exact checkout being reviewed. */
function sessionLocation(directory){
 const target=fs.realpathSync(directory);if(!fs.statSync(target).isDirectory())throw Error('Expected project directory');
 let gitManaged=false;
 for(let current=target;;current=path.dirname(current)){
  try{fs.lstatSync(path.join(current,'.git'));gitManaged=true;break;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(fs.existsSync(path.join(current,'HEAD'))&&fs.existsSync(path.join(current,'objects')))throw Error('Bare Git repository is not a session workspace');
  if(path.dirname(current)===current)break;
 }
 if(!gitManaged)return {cwd:target,targetDirectory:target,targetHead:null,gitCommonDir:null};
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:GIT_NULL_DEVICE,GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1'});
 const git=(cwd,args)=>{
  const result=spawnSync('git',['-c','core.fsmonitor=false','-c',`core.hooksPath=${GIT_NULL_DEVICE}`,...args],{cwd,env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw Error('Cannot resolve session repository; check the target and primary checkout');
  return result.stdout;
 };
 const first=git(target,['worktree','list','--porcelain','-z']).split('\0\0')[0].split('\0');
 if(!first[0]?.startsWith('worktree ')||first.includes('bare'))throw Error('A primary working checkout is required for session listing');
 const cwd=fs.realpathSync(first[0].slice('worktree '.length));
 const common=dir=>fs.realpathSync(gitPathOutput(git(dir,['rev-parse','--path-format=absolute','--git-common-dir'])));
 const gitCommonDir=common(target);
 if(common(cwd)!==gitCommonDir)throw Error('Session root and target must belong to the same repository');
 const readHead=()=>git(target,['rev-parse','--verify','HEAD']).trim();
 const targetHead=readHead();
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(targetHead))throw Error('Invalid target HEAD');
 return {cwd,targetDirectory:target,targetHead,readHead,gitCommonDir};
}

/**
 * Claude review launch. Read scope is enforced by launch settings, not prompt text:
 * --restricted ignores user/project/local settings (their allow rules and additionalDirectories)
 * and confines the file tools to the working directory. The caller launches in the review target itself
 * (#1800, owner decision): no --add-dir, so the primary checkout and other worktrees stay outside.
 * The session is therefore stored under the target's project, and is resumed by its ID or name.
 * No --allowedTools: a bare Read/Glob/Grep allow rule is path-unrestricted and widens reads beyond them.
 */
export function claudeReviewArguments({model,sessionId,instruction,ephemeral,name}){
 const args=['-p','--model',model,'--output-format','json','--restricted','--permission-mode','dontAsk','--tools','Read,Glob,Grep','--strict-mcp-config','--settings','{"disableAllHooks":true}','--session-id',sessionId,'--append-system-prompt',instruction];
 if(ephemeral)args.push('--no-session-persistence');else args.push('-n',name);
 return args;
}

/**
 * Codex review permissions. `sandbox: read-only` limits writes only, so the app-server gets a named profile built on
 * the shared Codex sandbox base (`:root` denied, `:minimal` read, macOS shared temporaries denied under both spellings,
 * the Codex runtime and Node read). It adds read-only grants for the given paths (shared Git metadata, developer
 * tools) and the review target; nothing is writable and the network is disabled.
 * The session cwd stays at the primary checkout for listing, so the profile names the target explicitly.
 * Project instructions are not auto-loaded: Codex reads them from that cwd, which the profile cannot read
 * (thread start fails) and which holds another revision; the Reviewer reads the target's rules itself.
 * Keys are TOML basic strings (JSON escaping is valid TOML for these paths).
 * Codex merges a same-named `[permissions.<name>]` table from user or project configuration into the `-c` table
 * (measured: a user read entry survived), so each run uses a fresh, unguessable profile name.
 */
export const CODEX_REVIEW_PROFILE_PREFIX='asc_review_';
export function codexReviewProfileName(){return CODEX_REVIEW_PROFILE_PREFIX+randomBytes(12).toString('hex');}
export function codexReviewProfileArguments({profile,targetDirectory,providerRoots,node,readablePaths=[],platform=process.platform}){
 if(typeof profile!=='string'||!/^asc_review_[a-f0-9]{24}$/.test(profile))throw Error('Codex review profile name must be generated per run');
 for(const item of [targetDirectory,node,...providerRoots,...readablePaths])if(typeof item!=='string'||!path.isAbsolute(item))throw Error('Codex review paths must be absolute');
 if(!providerRoots.length)throw Error('Codex runtime roots are required');
 // Added directories use the scoped form {"."="read"}: Codex treats a bare key with glob characters such as [ ] as a
 // glob, which it allows only for deny (measured), while the scoped base path is literal.
 const scoped={'.':'read'};
 const filesystem={...sandboxFilesystemBase({providerRoots,node,platform}),...Object.fromEntries(readablePaths.map(item=>[item,scoped])),[targetDirectory]:scoped};
 const value=access=>typeof access==='string'?JSON.stringify(access):`{${Object.entries(access).map(([key,mode])=>`${JSON.stringify(key)}=${JSON.stringify(mode)}`).join(',')}}`;
 const table=`{${Object.entries(filesystem).map(([key,access])=>`${JSON.stringify(key)}=${value(access)}`).join(',')}}`;
 return ['-c','project_doc_max_bytes=0','-c',`default_permissions=${JSON.stringify(profile)}`,'-c',`permissions.${profile}.filesystem=${table}`,'-c',`permissions.${profile}.network.enabled=false`];
}

/**
 * Resolve the Host executable to its real file: the sandboxed helper re-executes Codex, so its runtime must be readable.
 * Windows names are tried with PATHEXT; command-shell wrappers are rejected because their target is unknown.
 */
export function resolveExecutable(executable,searchPath=process.env.PATH??'',platform=process.platform,pathExt=process.env.PATHEXT??'.EXE;.CMD;.BAT'){
 // Windows never runs an extensionless file (npm also writes a POSIX shell script without one).
 const extensions=platform==='win32'&&!path.extname(executable)?pathExt.split(';').filter(Boolean):[''];
 const bases=executable.includes('/')||(platform==='win32'&&executable.includes('\\'))?[path.resolve(executable)]:searchPath.split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,executable));
 for(const base of bases)for(const extension of extensions){
  try{
   const candidate=base+extension;fs.accessSync(candidate,fs.constants.X_OK);const real=fs.realpathSync(candidate);
   if(fs.statSync(real).isFile()){if(/\.(cmd|bat)$/i.test(real))throw Error('Use the native Codex executable or the npm package bin/codex.js, not a command shell wrapper');return real;}
  }catch(error){if(/command shell wrapper/.test(error.message))throw error;/* try the next candidate */}
 }
 throw Error('Host executable not found');
}

/** Oldest Codex whose macOS sandbox denies the shared temporaries (see codex-runtime.mjs); older ones fail closed here. */
export function assertCodexVersion(versionText,platform=process.platform){
 if(platform!=='darwin')return;
 const match=/codex-cli (\d+)\.(\d+)\.(\d+)/.exec(versionText??'');
 const [major,minor,patch]=MACOS_MIN_CODEX_VERSION.split('.').map(Number);
 const version=match?match.slice(1).map(Number):null;
 const older=!version||version[0]<major||(version[0]===major&&(version[1]<minor||(version[1]===minor&&version[2]<patch)));
 if(older)throw Error(`Codex ${MACOS_MIN_CODEX_VERSION} or later is required on macOS for the review read scope`);
}

/**
 * Paths besides the target and the Codex runtime that the Reviewer needs: the shared Git metadata (history, refs,
 * config, other worktrees' index, staged objects and stash; not any checkout's working files) and, on macOS, the
 * active developer tools that /usr/bin/git runs.
 */
export function codexReviewReadablePaths({gitCommonDir}){
 const paths=gitCommonDir?[gitCommonDir]:[];
 if(process.platform==='darwin'){
  const result=spawnSync('xcode-select',['-p'],{encoding:'utf8',timeout:10000});
  const dir=result.status===0?result.stdout.trim():'';
  // Only an Xcode or Command Line Tools developer directory; never a broad path such as / or a home directory.
  if(path.isAbsolute(dir)&&fs.existsSync(dir)){const real=fs.realpathSync(dir);if(/^(?:Developer|CommandLineTools)$/.test(path.basename(real)))paths.push(real);}
 }
 return paths;
}

/** Claude completion rename: no tools at all, so it has no file access to confine. */
export function claudeRenameArguments({sessionId,name,model}){
 return ['-p','--resume',sessionId,'-n',`済: ${name}`,'--model',model,'--max-turns','1','--tools','','--allowedTools','','--permission-mode','dontAsk','--strict-mcp-config','--settings','{"disableAllHooks":true}'];
}

/** Strip inherited Git routing/config overrides without changing Host authentication or PATH. */
function hostEnvironment(){
 return Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
}

/** Run a restricted Host invocation and retain its exit status independently of its output. */
function command(executable,args,{cwd,input,timeout,out,err}){
 return new Promise(resolve=>{
  const child=spawn(executable,args,{cwd,env:hostEnvironment(),stdio:['pipe','pipe','pipe']});let error;
  const timer=setTimeout(()=>{error='Host command timeout';child.kill('SIGKILL');},timeout);
  child.stdout.on('data',out);child.stderr.on('data',err);
  child.on('error',e=>{error=e.message;});child.stdin.on('error',e=>{error??=e.message;});
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,error});});child.stdin.end(input);
 });
}

export async function runHostSession(options){
 const {host,model,ephemeral,timeout,executable}=options;
 const location=sessionLocation(options.cwd),{targetDirectory,targetHead,readHead,gitCommonDir}=location;
 // Claude confines reads to its launch directory, so it starts (and is renamed) in the target; Codex limits reads by
 // its permission profile and keeps the primary checkout as the thread cwd for listing.
 const cwd=host==='claude'?targetDirectory:location.cwd;
 const targetInstruction=`ASC session location: ${JSON.stringify({sessionRoot:cwd,targetDirectory,targetHead})}. The sessionRoot is only the launch/listing location. Review and read files in targetDirectory, never substitute the primary checkout or another worktree. Use absolute paths (or git -C targetDirectory). Read the target's applicable AGENTS.md/CLAUDE.md and nested project rules before work. Verify the target HEAD when Git is available; report a mismatch instead of reviewing another checkout. Do not modify files or use external write tools.`;
 const prompt=fs.readFileSync(options.promptFile,'utf8');if(!prompt.trim())throw Error('Empty session prompt');
 const outputDir=path.resolve(options.outputDir);
 // A new private directory prevents overwriting another run, symlinks, or review results.
 fs.mkdirSync(outputDir,{mode:0o700});
 const files={};for(const name of ['events.jsonl','stderr.txt','result.txt','rename.stdout','rename.stderr'])files[name]=fs.openSync(path.join(outputDir,name),'wx',0o600);
 const write=(name,data)=>fs.writeSync(files[name],data);
 const state={schema:'asc-host-session/v1',host,cwd,targetDirectory,targetHead,model,ephemeral,name:`自動: ${options.name}`,sessionId:null,status:'running',naming:ephemeral?'not-persisted':'pending',outputDir,startedAt:new Date().toISOString()};
 const save=()=>fs.writeFileSync(path.join(outputDir,'status.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});
 save();let rpc;
 try{
  if(host==='claude'){
   state.sessionId=randomUUID();save();
   const args=claudeReviewArguments({model,sessionId:state.sessionId,instruction:targetInstruction,ephemeral,name:state.name});
   const result=await command(executable,args,{cwd,input:prompt,timeout,out:b=>write('events.jsonl',b),err:b=>write('stderr.txt',b)});
   state.process=result;
   if(result.error||result.code!==0)throw Error(result.error??`Claude exited ${result.code}`);
   const response=JSON.parse(fs.readFileSync(path.join(outputDir,'events.jsonl'),'utf8'));
   if(response.session_id!==state.sessionId||response.is_error||response.type!=='result'||typeof response.result!=='string'||!response.result.trim())throw Error('Claude did not return a successful session result');
   write('result.txt',response.result+'\n');
   if(readHead&&readHead()!==targetHead)throw Error('Target HEAD changed during session');
   state.naming=ephemeral?'not-persisted':'started';save();
   if(!ephemeral){
    const renamed=await command(executable,claudeRenameArguments({sessionId:state.sessionId,name:state.name,model:options.renameModel??model}),{cwd,input:'Reply OK only. Do not use tools.',timeout:Math.min(timeout,60000),out:b=>write('rename.stdout',b),err:b=>write('rename.stderr',b)});
    state.rename=renamed;state.naming=!renamed.error&&renamed.code===0?'completed':'failed';
   }
  }else{
   // The npm launcher (bin/codex.js) runs under this Node; its package and native runtime become readable.
   const codex=resolveExecutable(executable),node=fs.realpathSync(process.execPath),script=/\.m?js$/i.test(codex);
   const launch=script?node:codex,prefix=script?[codex]:[];
   if(process.platform==='darwin')assertCodexVersion(spawnSync(launch,[...prefix,'--version'],{encoding:'utf8',timeout:30000,env:hostEnvironment()}).stdout);
   const permissionProfile=codexReviewProfileName();
   const profile=codexReviewProfileArguments({profile:permissionProfile,targetDirectory,providerRoots:codexRuntimeRoots(codex),node,readablePaths:codexReviewReadablePaths({gitCommonDir})});
   state.permissionProfile=permissionProfile;
   rpc=sessionRpc(launch,cwd,{prefix,args:profile,env:hostEnvironment(),timeout,record:line=>{
    write('events.jsonl',line);
    const message=JSON.parse(line),item=message.params?.item;
    if(message.method==='item/completed'&&message.params?.threadId===state.sessionId&&item?.type==='agentMessage'&&typeof item.text==='string')write('result.txt',item.text+'\n');
   },stderr:b=>write('stderr.txt',b)});
   // experimentalApi exposes the named-profile fields; the thread must report that profile before any turn.
   await rpc.initialize({experimentalApi:true});
   const response=await rpc.call('thread/start',{cwd,model,ephemeral,approvalPolicy:'never',permissions:state.permissionProfile,developerInstructions:targetInstruction});
   state.sessionId=response.thread?.id;if(typeof state.sessionId!=='string'||!state.sessionId)throw Error('Missing Codex thread ID');save();
   // A same-named profile extended elsewhere could widen reads, so only the unextended profile is accepted.
   const active=response.activePermissionProfile;
   if(active?.id!==state.permissionProfile||active.extends!=null)throw Error('Codex did not apply the review permission profile');
   if(!ephemeral){await rpc.call('thread/name/set',{threadId:state.sessionId,name:state.name});state.naming='started';save();}
   const started=await rpc.call('turn/start',{threadId:state.sessionId,input:[{type:'text',text:prompt}],approvalPolicy:'never',permissions:state.permissionProfile});
   const completed=await rpc.wait(message=>message.method==='turn/completed'&&message.params?.threadId===state.sessionId&&message.params?.turn?.id===started.turn.id);
   if(completed.params.turn.status!=='completed')throw Error(`Codex turn ${completed.params.turn.status}`);
   if(!fs.readFileSync(path.join(outputDir,'result.txt'),'utf8').trim())throw Error('Codex returned no response');
   if(readHead&&readHead()!==targetHead)throw Error('Target HEAD changed during session');
   save();
   if(!ephemeral){try{await rpc.call('thread/name/set',{threadId:state.sessionId,name:`済: ${state.name}`});state.naming='completed';}catch(error){state.naming='failed';state.renameError=error.message;}}
  }
  if(readHead&&readHead()!==targetHead)throw Error('Target HEAD changed during session (final check after naming)');
  state.status='completed';
 }catch(error){state.status='failed';state.error=error.message;}
 finally{await rpc?.close();state.finishedAt=new Date().toISOString();save();for(const fd of Object.values(files))fs.closeSync(fd);}
 return state;
}
