/** Permit an ordinary project directory without weakening existing Git boundaries. */
import fs from 'node:fs';
import path from 'node:path';
import {assertWorkLocation} from './migration.mjs';
function exists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export function projectLocation(directory){
 const repo=fs.realpathSync.native(directory);
 if(!fs.statSync(repo).isDirectory())throw Error('Project directory required');
 // Inspect ancestors, not project contents. Broken Git metadata must never turn
 // a repository into the non-Git path, nor may a subdirectory escape its boundary.
 for(let current=repo;;current=path.dirname(current)){
  if(exists(path.join(current,'.git')))return {...assertWorkLocation(repo),gitManaged:true};
  if(['HEAD','objects','refs'].filter(name=>exists(path.join(current,name))).length>=2)throw Error('Git metadata directory is not a project workspace');
  if(path.dirname(current)===current)break;
 }
 return {repo,mode:'directory',gitManaged:false};
}
