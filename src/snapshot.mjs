/** Descriptor-based reads without mutable symlink parents (Linux adapter). */
import {SOURCE_FILE_BYTES} from './source-limits.mjs';
import fs from 'node:fs';import {createHash} from 'node:crypto';
import {safeName} from './controller.mjs';
function withFile(root,name,maxBytes,read){
 if(process.platform!=='linux')throw Error('Safe snapshot export unsupported on this host');
 safeName(name);
 const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK;
 let dir=fs.openSync(root,flags|fs.constants.O_DIRECTORY);
 try{
  const parts=name.split('/');
  for(const part of parts.slice(0,-1)){
   const next=fs.openSync(`/proc/self/fd/${dir}/${part}`,flags|fs.constants.O_DIRECTORY);fs.closeSync(dir);dir=next;
  }
  const fd=fs.openSync(`/proc/self/fd/${dir}/${parts.at(-1)}`,flags);
  try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>maxBytes)throw Error('Unsafe snapshot file');return read(fd,stat);}
  finally{fs.closeSync(fd);}
 }finally{fs.closeSync(dir);}
}
export function readSnapshotFile(root,name,maxBytes=SOURCE_FILE_BYTES) {
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>SOURCE_FILE_BYTES)throw Error('Invalid source bound');
 return withFile(root,name,maxBytes,(fd,stat)=>{
  const data=Buffer.alloc(stat.size+1);let size=0,n;
  while(size<data.length && (n=fs.readSync(fd,data,size,data.length-size,null))>0)size+=n;
  if(size!==stat.size)throw Error('Snapshot changed during observation');return data.subarray(0,size);
 });
}
/** Larger host-pinned runtimes use a bounded stream; Agent output stays bounded by SOURCE_FILE_BYTES. */
export function pinAssetFile(root,name,destination){
 return withFile(root,name,536870912,(fd,stat)=>{
  const output=destination?fs.openSync(destination,'wx',stat.mode&0o777):undefined;
  try{
   const buffer=Buffer.alloc(1048576),hash=createHash('sha256');let bytes=0,n;
   while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0){bytes+=n;if(bytes>536870912)throw Error('Asset byte limit exceeded');const chunk=buffer.subarray(0,n);hash.update(chunk);if(output!==undefined)fs.writeFileSync(output,chunk);}
   if(bytes!==stat.size)throw Error('Asset changed during observation');if(output!==undefined)fs.fchmodSync(output,stat.mode&0o777);
   return {bytes,mode:stat.mode&0o777,digest:hash.digest('hex')};
  }finally{if(output!==undefined)fs.closeSync(output);}
 });
}
