/** Owner-pinned runtime/dependency inputs. No install hooks or candidate config. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Controller,digest,safeName} from './controller.mjs';import {pinAssetFile} from './snapshot.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
const contains=(a,b)=>{const r=path.relative(a,b);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
export function inspectAssets(source,destination){
 demand(path.isAbsolute(source),'Absolute asset directory required');
 const root=fs.realpathSync(source);demand(fs.lstatSync(root).isDirectory(),'Asset directory missing');
 const entries=[],links=[];let bytes=0;
 if(destination){demand(path.isAbsolute(destination)&&!contains(root,destination)&&!contains(destination,root),'Asset snapshot overlaps source');fs.mkdirSync(destination,{mode:0o700});}
 const walk=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  const name=prefix+e.name,file=path.join(dir,e.name);safeName(name);demand(entries.length<50000,'Asset entry limit exceeded');
  if(e.isSymbolicLink()){
   const link=fs.readlinkSync(file);demand(!path.isAbsolute(link)&&contains(root,fs.realpathSync(file)),'Asset link escapes inventory');entries.push([name,'link',link]);if(destination){const out=path.join(destination,name);fs.symlinkSync(link,out);links.push(out);}
  }else if(e.isDirectory()){entries.push([name,'directory']);if(destination)fs.mkdirSync(path.join(destination,name));walk(file,name+'/');}
  else{
   const pinned=pinAssetFile(root,name,destination?path.join(destination,name):undefined);bytes+=pinned.bytes;demand(bytes<=536870912,'Asset byte limit exceeded');
   entries.push([name,pinned.mode,pinned.digest]);
  }
 }};walk(root);if(destination)for(const link of links)demand(contains(destination,fs.realpathSync(link)),'Copied asset link escapes snapshot');return {source:root,digest:digest(entries),entries:entries.length,bytes};
}
export class AssetController extends Controller{
 constructor(input){super(input);demand(this.contract.verificationResourceProfile===undefined||this.contract.verificationResourceProfile==='browser-cgroup-v1','Unknown verification resource profile');if(this.contract.verificationAssets)this.assetProfile(false);}
 sandboxProfile(){const profile=this.assetProfile(true);return this.contract.verificationResourceProfile==='browser-cgroup-v1'?{...profile,addressLimit:8796093022208}:profile;}
 assetProfile(snapshot){
  const p=this.contract.verificationAssets;if(!p)return super.sandboxProfile();
  demand(p&&typeof p==='object'&&Object.keys(p).sort().join(',')==='dependencies,runtime'&&Array.isArray(p.dependencies),'Invalid verification assets');
  const bindings=[],directories=[],targets=new Set();
  const temp=snapshot?fs.mkdtempSync(path.join(os.tmpdir(),'asc-verification-assets-')):undefined;let ordinal=0;
  try{
  const tracked=this.blobs(this.git('rev-parse','HEAD').toString().trim());
  const gitDirs=['--absolute-git-dir','--git-common-dir'].map(arg=>path.resolve(this.repo,this.git('rev-parse','--path-format=absolute',arg).toString().trim()));
  const bind=(entry,target,isRuntime)=>{
   demand(entry&&Object.keys(entry).sort().join(',')===(isRuntime?'digest,source':'digest,source,target')&&typeof entry.source==='string'&&/^[a-f0-9]{64}$/.test(entry.digest),'Invalid asset pin');
   if(!isRuntime){safeName(target);demand(!['.codex','.agents'].includes(target.split('/')[0].toLowerCase()),'Asset cannot be Agent control data');
    demand(![...tracked.keys()].some(name=>name===target||name.startsWith(target+'/')||target.startsWith(name+'/')),'Asset shadows tracked source');
    demand(![...targets].some(name=>name===target||name.startsWith(target+'/')||target.startsWith(name+'/')),'Overlapping asset targets');targets.add(target);directories.push(target);
   }
   const source=fs.realpathSync(entry.source);
   demand(![this.repo,...gitDirs].some(dir=>contains(dir,source)||contains(source,dir)),'Assets overlap source or Git authority');
   const destination=temp?path.join(temp,String(ordinal++)):undefined;
   const observed=inspectAssets(source,destination);
   demand(observed.digest===entry.digest,'Verification asset digest changed');bindings.push('--ro-bind',destination??observed.source,isRuntime?'/runtime':'/work/'+target);
  };
  bind(p.runtime,'/runtime',true);for(const dependency of p.dependencies)bind(dependency,dependency.target,false);
  return {directories,bindings,runtimePath:'/runtime:/usr/bin:/bin',addressLimit:17179869184,readOnly:false,cleanup:()=>{if(temp)fs.rmSync(temp,{recursive:true,force:true});}};
  }catch(error){if(temp)fs.rmSync(temp,{recursive:true,force:true});throw error;}
 }
}
