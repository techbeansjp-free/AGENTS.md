import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
/* Git batch size is an I/O chunk, not a repository or individual file limit. */
export const SOURCE_BATCH_BYTES=12_000_000;

/* Bounds of one local Git child (no prompt, hook or network) and how a bounded child failed.
   They live here because a new runtime file needs a staged package inventory change (#1679, #1685). */
/* No call has been observed near this limit; a longer one does not cure the stdin hang of #1682. */
export const LOCAL_GIT_TIMEOUT_MILLISECONDS=20000;
/* Null device for Git config, hooks and attributes paths given to local Git children (#1711). */
export const GIT_NULL_DEVICE=process.platform==='win32'?'NUL':'/dev/null';
/** A path Git printed on one line: strip only its line ending, since a path may end with a space (#1731). */
export function gitPathOutput(output){return String(output).replace(/\r?\n$/,'');}

/** Name why a Git child failed, so that a timeout under load can be told apart from an error reported by Git. */
export function gitFailureReason(result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 if(result.error?.code==='ETIMEDOUT')return `timed out after ${timeoutMilliseconds} ms`;
 if(result.error?.code==='ENOBUFS')return 'output exceeded the buffer limit';
 if(result.error)return `could not run: ${result.error.code??result.error.message}`;
 if(result.signal)return `terminated by ${result.signal}`;
 return `exit status ${result.status}`;
}

/** `<label> (<reason>)`. Git's stderr is left out: Git quotes repo-local config values and remote URLs in it, a
   message reaches the Agent that runs the CLI, and no redaction of free text is complete (#1734). The label stays
   first so existing callers can still match it; to see Git's own words, run the Git command again. */
export function gitFailureMessage(label,result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 return `${label} (${gitFailureReason(result,timeoutMilliseconds)})`;
}

/** Run `run(stdin)` with `input` as a child's stdin: a private regular file opened for reading, or 'ignore' without input.
   A large spawnSync input was seen leaving a loaded macOS child blocked on its stdin pipe until the timeout (#1669, #1682);
   a regular file cannot block that way. The child still reads stdin, so its arguments and protocol do not change.
   It lives with the Git child bounds only because a new runtime file needs a staged package inventory change (see above);
   it also serves the Host transport and the owner approval command. */
export function withStdinFile(input,run){
 if(input===undefined)return run('ignore');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asc-stdin-')),file=path.join(dir,'input');
 try{
  fs.writeFileSync(file,input,{flag:'wx',mode:0o600});
  const fd=fs.openSync(file,'r');try{return run(fd);}finally{fs.closeSync(fd);}
 }finally{
  // The child's result or failure reason matters more than a leftover 0600 file: on Windows a descendant that
  // outlived a timeout may still hold the file open, so a failed cleanup must not replace what run returned or threw.
  try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});}catch{ /* Leave the private directory for later cleanup. */ }
 }
}
