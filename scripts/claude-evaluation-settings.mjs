import fs from 'node:fs';import path from 'node:path';
const contains=(parent,child)=>child===parent||child.startsWith(parent+path.sep);
/** Resolve symlink ancestors even when a protected leaf does not exist yet. */
function physical(name){
 if(typeof name!=='string'||!path.isAbsolute(name)||path.normalize(name)!==name)throw Error('Absolute normalized evaluation path required');
 try{return fs.realpathSync(name);}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(name);if(parent===name)throw e;return path.join(physical(parent),path.basename(name));}
}
/** Evaluation only. Historical temporary trees are denied as trees, not thousands of leaves. */
export function claudeEvaluationSettings({root,origin,distribution,owner,captureFile,fixture,home,previousRoots=[],historyRoots=['/tmp','/var/tmp']}){
 const current=fs.realpathSync(root),write=fs.realpathSync(origin);
 const protectedNames=[distribution,owner,captureFile];
 for(const name of [root,origin,...protectedNames,fixture,home])physical(name);
 const protectedPaths=protectedNames.map(name=>fs.realpathSync(name));
 const denyNames=[...historyRoots,...previousRoots,fixture,...['Projects','.ssh','.codex','.claude'].map(n=>path.join(home,n))];
 const denyRead=[...new Set(denyNames.flatMap(name=>[name,physical(name)]))];
 if(!contains(current,write)||protectedPaths.some(p=>!contains(current,p)||contains(write,p))||denyRead.some(p=>contains(p,current)||contains(write,p)))throw Error('Evaluation workspace overlaps protected data');
 return {disableAllHooks:true,sandbox:{enabled:true,failIfUnavailable:true,allowUnsandboxedCommands:false,autoAllowBashIfSandboxed:true,filesystem:{allowWrite:[write],denyRead,denyWrite:protectedPaths},network:{allowedDomains:[]}}};
}
