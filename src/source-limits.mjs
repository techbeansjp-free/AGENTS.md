import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
/* Git batch size is an I/O chunk, not a repository or individual file limit. */
export const SOURCE_BATCH_BYTES=12_000_000;

/* Bounds of one local Git child (no prompt, hook or network) and how a bounded child failed.
   They live here because a new runtime file needs a staged package inventory change (#1679, #1685). */
/* No call has been observed near this limit; a longer one does not cure the stdin hang of #1682. */
export const LOCAL_GIT_TIMEOUT_MILLISECONDS=20000;
export const GIT_STDERR_EXCERPT_CHARACTERS=512;
/* Null device for Git config, hooks and attributes paths given to local Git children (#1711). */
export const GIT_NULL_DEVICE=process.platform==='win32'?'NUL':'/dev/null';

/* Best-effort redaction. Git quotes a malformed repo-local config value in its error (for example
   "bad numeric config value '<value>' for 'core.compression'"), so any config value can reach stderr; a remote URL
   or a header copied from config could also carry a credential. Patterns run on the raw stderr, before line breaks
   are folded, so a header is hidden up to the end of its line.
   Known gaps: a quoted config value that itself contains "'" shows the part after it; a wording that another Git
   version adds, or that a key read only under a matching subsection name, value shape or argument not in the sweep
   produces; credential formats not listed here (#1691). Long words after 'basic' or 'token' are hidden even
   when they are not secrets. */
const secretPatterns=[
 // Config values quoted by Git. The forms below are every one that a sweep produced on Git 2.54 (#1691): all 992
 // documented config keys, three value shapes (words with a space, '~nouser/...', a bad regex) and the 20 argument forms
 // that Controller and candidate pass. A value after a colon runs to the line end.
 [/(\b(?:value|component|mode|parameter|orderfile|algorithm|chdir to|user dir in:|include path) )'[^']*'/gi,"$1'***'"],
 [/(\bunknown )'[^']*'( value for)/gi,"$1'***'$2"],
 [/(\bvalue for (?:config )?'?[^'\s]{1,256}'?(?: config (?:variable|option))?: )[^\n]*/gi,'$1***'],
 [/(\b(?:invalid color value|invalid mode for object creation|bad --ignore-submodules argument): )[^\n]*/gi,'$1***'],
 // Userinfo up to the last '@' of the authority, so a literal '@' in a password does not end it early.
 [/([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#]*@/gi,'$1***@'],
 [/\b((?:proxy-)?authorization)[^\S\n]*:[^\n]*/gi,'$1: ***'],
 // Query or form parameters and "password: value" pairs.
 [/(?<![A-Za-z0-9_])((?:access_?token|refresh_?token|id_?token|token|password|passwd|pwd|pass|secret|client_?secret|api_?key|apikey|private_?token|auth|sig|signature|code)=)[^\s&#;'"]+/gi,'$1***'],
 [/\b(password|passwd|secret)[^\S\n]*:[^\S\n]*\S+/gi,'$1: ***'],
 [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=_-]{8,}/gi,'$1 ***'],
 [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,'***'],
];

/** Name why a Git child failed, so that a timeout under load can be told apart from an error reported by Git. */
export function gitFailureReason(result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 if(result.error?.code==='ETIMEDOUT')return `timed out after ${timeoutMilliseconds} ms`;
 if(result.error?.code==='ENOBUFS')return 'output exceeded the buffer limit';
 if(result.error)return `could not run: ${result.error.code??result.error.message}`;
 if(result.signal)return `terminated by ${result.signal}`;
 return `exit status ${result.status}`;
}

/** The end of stderr on one line, where Git prints its fatal message. Credential-like values are removed before it is cut.
   Every pattern starts at a literal or a bounded scheme and stops at a quote, a separator or the end of a line, so
   redacting the whole stderr (at most maxBuffer) stays linear. */
export function gitStderrExcerpt(stderr,limit=GIT_STDERR_EXCERPT_CHARACTERS){
 if(stderr===null||stderr===undefined)return '';
 let text=Buffer.isBuffer(stderr)?stderr.toString('utf8'):String(stderr);
 for(const [pattern,replacement] of secretPatterns)text=text.replace(pattern,replacement);
 text=text.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g,' ').trim();
 // A code point takes at most two code units, so this tail holds more than limit code points when text is longer.
 const characters=[...text.slice(-(limit*2+2))];
 return characters.length>limit?'…'+characters.slice(-limit).join(''):characters.join('');
}

/** `<label> (<reason>[; stderr: <excerpt>])`. The label stays first so existing callers can still match it. */
export function gitFailureMessage(label,result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 const excerpt=gitStderrExcerpt(result.stderr);
 return `${label} (${gitFailureReason(result,timeoutMilliseconds)}${excerpt?`; stderr: ${excerpt}`:''})`;
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
