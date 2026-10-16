/** Copy owner-pinned dependencies into invocation-local storage; never install hooks. */
import fs from 'node:fs';import path from 'node:path';
import {inspectAssets} from './verification-assets.mjs';
import {safeName} from './controller.mjs';
const contains=(a,b)=>{const r=path.relative(a,b);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function demand(ok,message){if(!ok)throw Error(message);}
export function stageHostVerificationAssets(assets,{workspace,runtime,authorityRoots}){
 if(assets===undefined)return {readOnlyRoots:[],runtimeRoot:null};
 demand(assets&&Object.keys(assets).sort().join(',')==='dependencies,runtime'&&Array.isArray(assets.dependencies),'Invalid verification assets');
 const readOnlyRoots=[],targets=[];
 const copy=(entry,destination,isRuntime)=>{
  demand(entry&&Object.keys(entry).sort().join(',')===(isRuntime?'digest,source':'digest,source,target')&&typeof entry.source==='string'&&path.isAbsolute(entry.source)&&/^[a-f0-9]{64}$/.test(entry.digest),'Invalid asset pin');
  const source=fs.realpathSync(entry.source);
  demand(![workspace,runtime,...authorityRoots].some(r=>contains(r,source)||contains(source,r)),'Assets overlap candidate or authority');
  demand(!fs.existsSync(destination),'Asset shadows source');
  const relative=path.relative(workspace,path.dirname(destination));
  if(!isRuntime){let parent=workspace;for(const part of relative.split(path.sep).filter(Boolean)){parent=path.join(parent,part);if(fs.existsSync(parent))demand(fs.lstatSync(parent).isDirectory()&&!fs.lstatSync(parent).isSymbolicLink(),'Aliased asset parent');else fs.mkdirSync(parent);}}
  const observed=inspectAssets(source,destination);demand(observed.digest===entry.digest,'Verification asset digest changed');readOnlyRoots.push(destination);
 };
 const runtimeRoot=path.join(runtime,'verification-runtime');copy(assets.runtime,runtimeRoot,true);
 for(const entry of assets.dependencies){
  safeName(entry.target);demand(!['.git','.codex','.agents'].includes(entry.target.split('/')[0].toLowerCase()),'Asset cannot be control data');
  const destination=path.join(workspace,entry.target);
  demand(!targets.some(t=>contains(t,destination)||contains(destination,t)),'Overlapping asset targets');targets.push(destination);copy(entry,destination,false);
 }
 return {readOnlyRoots,runtimeRoot};
}
