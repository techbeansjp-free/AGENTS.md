/** Discover owner context without loading rule bodies into Agent output. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function name(value){
 if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0')||path.posix.isAbsolute(value)||/^[A-Za-z]:/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Project context requires project-relative paths');
 return value;
}
function read(root,relative,optional=false,contents=false){
 let current=root;
 for(const part of name(relative).split('/')){
  current=path.join(current,part);let st;
  try{st=fs.lstatSync(current);}catch(e){if((e.code==='ENOENT'||e.code==='ENOTDIR')&&optional)return null;throw e;}
  if(st.isSymbolicLink())throw Error('Project context must not traverse symlinks: '+relative);
 }
 const fd=fs.openSync(current,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  if(!fs.fstatSync(fd).isFile())throw Error('Project context must be a file: '+relative);
  if(contents)return fs.readFileSync(fd);
  const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0,count;
  while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,count));bytes+=count;}
  return {sha256:hash.digest('hex'),bytes};
 }finally{fs.closeSync(fd);}
}
export function projectContext(root,paths=[]){
 if(!Array.isArray(paths))throw Error('Expected changed paths');paths=paths.map(name);
 const manifest='.agent-skill-chain/project/context.json',bytes=read(root,manifest,true,true);
 const rules=new Map();
 const add=(p,scope=[],optional=false)=>{
  name(p);if(!Array.isArray(scope))throw Error('Expected appliesTo path prefixes');scope.forEach(name);
  const selected=!paths.length||!scope.length||paths.some(changed=>scope.some(prefix=>changed===prefix||changed.startsWith(prefix+'/')));
  if(!selected)return;
  const body=read(root,p,optional);if(body!==null)rules.set(p,{path:p,...body});
 };
 for(const p of ['AGENTS.md','CLAUDE.md','.agent-skill-chain/project/00_利用案内.md'])add(p,[],true);
 for(const changed of paths){
  const parts=changed.split('/');parts.pop();
  for(let i=1;i<=parts.length;i++)for(const file of ['AGENTS.md','CLAUDE.md'])add(parts.slice(0,i).join('/')+'/'+file,[],true);
 }
 if(bytes){
  const config=JSON.parse(bytes);
  if(config.schema!=='asc-project-context/v1'||!Array.isArray(config.rules)||Object.keys(config).some(k=>!['schema','rules'].includes(k)))throw Error('Unsupported project context manifest');
  for(const rule of config.rules){
   if(!rule||Object.keys(rule).some(k=>!['path','appliesTo'].includes(k)))throw Error('Invalid project context rule');
   add(rule.path,rule.appliesTo??[]);
  }
 }
 // Legacy configuration is an input to interpret, not an automatically executed policy engine.
 const legacy='.agent-skill-chain/project-policy.json';const old=read(root,legacy,true);
 if(old)rules.set(legacy,{path:legacy,...old});
 const projectDir=path.join(root,'.agent-skill-chain/project');
 const references=[...rules.values()];
 return {schema:'asc-project-context-selection/v1',selection:paths.length?'path-prefix':'all-manifest-scopes',paths,
  ...(bytes?{manifest:{path:manifest,sha256:digest(bytes)}}:{}),references,
  digest:digest(JSON.stringify({manifest:bytes?digest(bytes):null,paths,references})),
  notices:[...(!paths.length?['Nested AGENTS.md/CLAUDE.md are not scanned; rerun start --path for every intended and actual changed path before implementation and final review.']:[]),...(old?['Legacy project-policy.json requires Host interpretation; no automatic v0.4 policy execution or permission grant.']:[]),
   ...(!bytes&&fs.existsSync(projectDir)?['Project rules directory exists without context.json; read its index or identify applicable rules before implementation.']:[])],
  authority:'Project context does not grant permissions. Host must read applicable rules, resolve conflicts and pass the same references to independent review; selection is not semantic compliance.',
 };
}
