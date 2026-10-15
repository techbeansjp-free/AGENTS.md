/** Host authority inputs must never resolve to candidate code, including future aliases. */
import fs from 'node:fs';import path from 'node:path';
function demand(ok,message){if(!ok)throw Error(message);}
export function authorityCommandValidator(c){
 const authorityRoots=[c.repo,...['--absolute-git-dir','--git-common-dir'].map(arg=>fs.realpathSync.native(c.git('rev-parse','--path-format=absolute',arg).toString().trim()))];
 return authorityCommandRootsValidator(authorityRoots);
}
export function authorityCommandRootsValidator(authorityRoots){
 const normalize=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
 const roots=authorityRoots.map(normalize);
 return argv=>{
  if(argv===undefined)return;
  demand(Array.isArray(argv)&&argv.length&&argv.every(x=>typeof x==='string')&&path.isAbsolute(argv[0]),'Explicit owner authority command required');
  for(const [index,value] of argv.entries()){
   if(index>0&&/^-{1,2}[a-zA-Z][a-zA-Z0-9-]*$/.test(value))continue;
   demand(path.isAbsolute(value),'Owner authority operands must be absolute paths or bare flags');
   const file=path.resolve(value),inside=value=>{const file=normalize(value);return roots.some(root=>file===root||file.startsWith(root+path.sep));};
   demand(!inside(file),'Candidate or Git metadata cannot supply owner authority');
   let ancestor=file;const suffix=[];
   while(true){
    try{fs.lstatSync(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=path.dirname(ancestor);demand(parent!==ancestor,'Unresolvable authority path');suffix.unshift(path.basename(ancestor));ancestor=parent;
   }
   let physical;try{physical=fs.realpathSync.native(ancestor);}catch{throw Error('Unresolvable owner authority alias');}
   demand(!inside(path.resolve(physical,...suffix)),'Candidate or Git metadata cannot supply owner authority');
  }
 };
}
