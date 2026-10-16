/** Disposable exact-HEAD shallow repository. Never copies source Git configuration. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
export function createVerificationGit(root,head,commit,blobs) {
 const algorithm=head.length===40?'sha1':head.length===64?'sha256':null;
 if(!algorithm||!/^[a-f0-9]+$/.test(head))throw Error('Invalid verification commit');
 const nullDevice=process.platform==='win32'?'NUL':'/dev/null';
 const dir=path.join(root,'.git');fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'objects'));fs.mkdirSync(path.join(dir,'refs'));
 const object=(type,bytes)=>{
  const raw=Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`),bytes]);
  const oid=createHash(algorithm).update(raw).digest('hex'),folder=path.join(dir,'objects',oid.slice(0,2));
  fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,oid.slice(2));
  if(!fs.existsSync(file))fs.writeFileSync(file,deflateSync(raw),{flag:'wx'});
  return oid;
 };
 if(object('commit',commit)!==head)throw Error('Verification commit identity mismatch');
 const tree=new Map();
 for(const [name,{mode,oid,bytes}] of blobs){
  // Input comes from Controller.blobs; refuse invalid components at this boundary too.
  const parts=name.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'||p.includes('\\')||p.includes('\0'))||!['100644','100755'].includes(mode))throw Error('Invalid verification tree');
  if(object('blob',bytes)!==oid)throw Error('Verification blob identity mismatch');
  let node=tree;
  for(const part of parts.slice(0,-1)){if(!node.has(part))node.set(part,new Map());node=node.get(part);if(!(node instanceof Map))throw Error('Conflicting verification tree');}
  if(node.has(parts.at(-1)))throw Error('Duplicate verification tree');node.set(parts.at(-1),{mode,oid});
 }
 const writeTree=node=>{
  const entries=[...node].map(([name,value])=>({name,mode:value instanceof Map?'40000':value.mode,oid:value instanceof Map?writeTree(value):value.oid,directory:value instanceof Map}));
  entries.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.directory?'/':'')),Buffer.from(b.name+(b.directory?'/':''))));
  return object('tree',Buffer.concat(entries.map(e=>Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`),Buffer.from(e.oid,'hex')]))));
 };
 const treeOid=writeTree(tree);
 if(commit.toString('utf8').split('\n')[0]!==`tree ${treeOid}`)throw Error('Verification tree identity mismatch');
 fs.writeFileSync(path.join(dir,'HEAD'),head+'\n');fs.writeFileSync(path.join(dir,'shallow'),head+'\n');
 fs.writeFileSync(path.join(dir,'config'),`[core]\n repositoryformatversion = ${algorithm==='sha256'?1:0}\n bare = false\n hooksPath = ${nullDevice}\n${algorithm==='sha256'?'[extensions]\n objectFormat = sha256\n':''}`);
 const env={PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:nullDevice,GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'};
 if(process.platform==='win32'&&process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
 const result=spawnSync('git',['-c','core.fsmonitor=false','read-tree',head],{cwd:root,env,timeout:20000,maxBuffer:1048576});
 if(result.error||result.status!==0)throw Error('Verification Git index failed');
 return dir;
}
