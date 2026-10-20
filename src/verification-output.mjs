import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// This is a transport for the existing result, not a signed attestation.
export function saveVerification(worktree,output,run){
  const root=fs.realpathSync(worktree),absolute=path.resolve(output);
  const file=path.join(fs.realpathSync(path.dirname(absolute)),path.basename(absolute));
  const relative=path.relative(root,file);
  if(relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Verification output must be outside the worktree');
  // Reserve before executing commands: never overwrite or follow an existing file.
  const fd=fs.openSync(file,'wx+',0o600),identity=fs.fstatSync(fd);
  const sameFile=()=>{try{const stat=fs.lstatSync(file);return stat.isFile()&&stat.dev===identity.dev&&stat.ino===identity.ino&&stat.nlink===1;}catch{return false;}};
  let complete=false;
  try{
    const result=run(),bytes=Buffer.from(`${JSON.stringify(result,null,2)}\n`);
    if(!sameFile()||fs.fstatSync(fd).size!==0)throw Error('Verification output destination changed');
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
    const stored=Buffer.alloc(bytes.length);
    if(fs.fstatSync(fd).size!==bytes.length||fs.readSync(fd,stored,0,stored.length,0)!==stored.length||!stored.equals(bytes))throw Error('Verification output content changed');
    if(!sameFile())throw Error('Verification output destination changed');
    complete=true;
    return {schema:'asc-worktree-verification-summary/v1',output:file,sha256:createHash('sha256').update(bytes).digest('hex'),
      repo:result.repo,base:result.base,head:result.head,contractSha256:result.contractSha256,contextSha256:result.contextSha256,
      passed:result.passed,checks:result.results.length,independentReview:result.independentReview,deliveryAuthorized:result.deliveryAuthorized};
  }finally{
    fs.closeSync(fd);
    if(!complete&&sameFile())fs.unlinkSync(file);
  }
}
