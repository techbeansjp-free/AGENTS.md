// Run with the source checkout as cwd. Before the refusal fix, this exits 1
// because rollback changes 04751 to 0751. After the fix it refuses preflight.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {projectAssets,uninstallProjectAssets}=await import(new URL('./src/project-assets.mjs',`file://${process.cwd()}/`));
const work=fs.mkdtempSync(path.join(os.tmpdir(),'asc-uninstall-special-mode-'));
try {
 projectAssets(work,{apply:true,registerSkill:true,registerClaudeSkill:true});
 const first=uninstallProjectAssets(work).changes[0].path,target=path.join(work,first);
 fs.chmodSync(target,0o4751);
 const before=fs.statSync(target).mode&0o7777;
 const original=fs.unlinkSync;let count=0;
 try {
  fs.unlinkSync=function(file){if(++count===2)throw Error('Injected unlink failure');return original.call(fs,file);};
  try {uninstallProjectAssets(work,{apply:true});}catch(error){console.log('rollback error:',error.message);}
 } finally {fs.unlinkSync=original;}
 const after=fs.statSync(target).mode&0o7777;
 console.log(JSON.stringify({first,before:before.toString(8),after:after.toString(8),exactModeRestored:before===after}));
 if(before!==after)process.exitCode=1;
} finally {fs.rmSync(work,{recursive:true,force:true});}
