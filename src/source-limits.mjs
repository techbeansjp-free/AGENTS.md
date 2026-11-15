import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
/* Git batch size is an I/O chunk, not a repository or individual file limit. */
export const SOURCE_BATCH_BYTES=12_000_000;

/* Bounds of one local Git child (no prompt, hook or network) and how a bounded child failed.
   They live here because a new runtime file needs a staged package inventory change (#1679, #1685). */
/* No call has been observed near this limit; a longer one does not cure the stdin hang of #1682. */
export const LOCAL_GIT_TIMEOUT_MILLISECONDS=20000;
export const GIT_STDERR_EXCERPT_CHARACTERS=512;

/* Best-effort redaction. Git quotes a malformed repo-local config value in its error (for example
   "bad numeric config value '<value>' for 'core.compression'"), so any config value can reach stderr; a remote URL
   or a header copied from config could also carry a credential. Patterns run on the raw stderr with its line breaks,
   after other control characters become spaces, so a header is hidden up to the end of its line.
   A config value can hold a newline or a quote, so a quoted value is hidden up to the first quote that is followed by
   the rest of Git's wording, and an unquoted or unclosed one up to the next line that starts a Git message (fatal:,
   error:, warning:, hint:, usage:). The cost: lines after an unquoted value are hidden until that message line.
   Known gaps (#1691, #1696): a later line of a multi-line value that itself starts like a Git message is shown; a
   quoted value that contains the rest of Git's wording (such as "' for ") shows what follows that part; a wording
   that another Git version adds, or that a key read only under a subsection name, value shape or argument not in the
   survey produces (scripts/survey-git-config-stderr.mjs); a URL password with both '/' and ':'; credential formats
   not listed here. Over-redaction: long words after 'basic' or 'token', and an authority with a ':' before a '/' and
   a later '@' (https://h:443/a@b). */
const messageLine=String.raw`\n[^\S\n]*(?:fatal|error|warning|hint|usage):`;
// Text up to (not into) the next line that starts a Git message. The lookahead per character is bounded.
const toMessageLine=String.raw`(?:(?!${messageLine})[\s\S])*`,toMessageLineLazy=toMessageLine+'?';
// What follows the closing quote of a value in Git's own wording, including the end of the line.
const afterQuote=String.raw`(?: for | value for|: |, possible values|[^\S\n]*(?:\n|$))`;
const secretPatterns=[
 // Config values quoted by Git. The forms below are every one that the survey produced on Git 2.54 (#1691): all 992
 // documented config keys, three value shapes (words with a space, '~nouser/...', a bad regex) and the 20 argument forms
 // that Controller and candidate pass. A value after a colon runs to the next Git message line.
 [new RegExp(String.raw`(\b(?:value|component|mode|parameter|orderfile|algorithm|chdir to|user dir in:|include path|unknown) )'(?:(${toMessageLineLazy})'(?=${afterQuote})|${toMessageLine})`,'gi'),
  (_,lead,closed)=>closed===undefined?`${lead}'***`:`${lead}'***'`],
 [new RegExp(String.raw`(\bvalue for (?:config )?'?[^'\s]{1,256}'?(?: config (?:variable|option))?: )${toMessageLine}`,'gi'),'$1***'],
 [new RegExp(String.raw`(\b(?:invalid color value|invalid mode for object creation|bad --ignore-submodules argument): )${toMessageLine}`,'gi'),'$1***'],
 // Userinfo up to the last '@' of the authority, so a literal '@' in a password does not end it early.
 [/([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#]*@/gi,'$1***@'],
 // A password with '/' is not valid userinfo, but Git still prints such a URL: a ':' before the first '/' and an '@'
 // later in the same word are taken as userinfo. Neither run crosses a ':', so a word of many '://' stays linear; a
 // password that holds both '/' and ':' is not hidden.
 [/([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#@:]{0,128}:[^\s@:]{0,128}@/gi,'$1***@'],
 [/\b((?:proxy-)?authorization)[^\S\n]*:[^\n]*/gi,'$1: ***'],
 // Query or form parameters and "password: value" pairs. Short or common names (auth, code, sig) count only after
 // '?', '&' or ';', so "exit code=128" stays readable.
 [/(?<![A-Za-z0-9_])((?:access_?token|refresh_?token|id_?token|token|password|passwd|pwd|pass|secret|client_?secret|api_?key|apikey|private_?token|signature)=)[^\s&#;'"]+/gi,'$1***'],
 [/([?&;](?:auth|code|sig)=)[^\s&#;'"]+/gi,'$1***'],
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
   Every pattern starts at a literal or a bounded scheme. A match ends at a separator, a line end or the next Git
   message line, and a failed attempt scans no further than the match that follows it, so redacting the whole stderr
   (at most maxBuffer) stays linear. */
export function gitStderrExcerpt(stderr,limit=GIT_STDERR_EXCERPT_CHARACTERS){
 if(stderr===null||stderr===undefined)return '';
 let text=Buffer.isBuffer(stderr)?stderr.toString('utf8'):String(stderr);
 // A carriage return ends a line like a newline (progress output); other control characters separate words, so
 // "Bearer\0<token>" is still a Bearer token.
 text=text.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,' ');
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
