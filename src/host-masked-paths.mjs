/** Observe kernel-enforced read-only null masks, never filename-based exclusions. */
import fs from 'node:fs';
import path from 'node:path';
export function hostMaskedPaths(repo){
 if(process.platform!=='linux')return [];
 let mounts;
 try{mounts=fs.readFileSync('/proc/self/mountinfo','utf8');}catch{return [];}
 const nullStat=fs.statSync('/dev/null'),result=[];
 if(!nullStat.isCharacterDevice())return [];
 for(const line of mounts.split('\n')){
  const fields=line.split(' ');
  if(!fields[5]?.split(',').includes('ro'))continue;
  const target=fields[4].replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
  const relative=path.relative(repo,target);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;
  try{
   const stat=fs.lstatSync(target);
   if(stat.isCharacterDevice()&&stat.rdev===nullStat.rdev&&fs.realpathSync(target)===target){
    result.push({path:relative,device:stat.dev,inode:stat.ino,mountId:fields[0],rdev:stat.rdev});
   }
  }catch{/* Unavailable paths cannot qualify for an exclusion. */}
 }
 return result.sort((a,b)=>a.path.localeCompare(b.path));
}
