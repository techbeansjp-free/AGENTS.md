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
   A config value can hold a newline or a quote, and nothing that a later line of the value shows ends it. So a quoted
   value is hidden up to the first quote that is followed by the rest of Git's wording on the same line (" for ",
   " value for", ": ", ", possible values"); failing that, up to the last quote that ends a line; failing that (an
   unclosed quote), and for an unquoted value, up to the next line that starts a Git message (fatal:, error:, warning:,
   hint:, usage:). Every case stops before that next message line. The cost: lines after an unquoted value are hidden
   until that message line.
   Known gaps (#1691, #1696): a later line of a multi-line value that itself starts like a Git message is shown; a
   quoted value that contains the rest of Git's wording (such as "' for ") shows what follows that part; a wording
   that another Git version adds, or that a key read only under a subsection name, value shape or argument not in the
   survey produces (scripts/survey-git-config-stderr.mjs); a URL password with both '/' and ':'; credential formats
   not listed here. Over-redaction: long words after 'basic' or 'token'; an authority with a ':' before a '/' and
   a later '@' (https://h:443/a@b); and any message worded 'invalid <word> value: ' or 'invalid <word> mode ', config or
   not, which is hidden up to the next message line. */
// The start of the next Git message line. Upload-pack output that Git relays (clone) starts each line with "remote: ".
const nextMessageLine=/\n[^\S\n]*(?:remote:[^\S\n]*)?(?:fatal|error|warning|hint|usage):/g;
const messageLineAfter=(text,from)=>{nextMessageLine.lastIndex=from;const next=nextMessageLine.exec(text);return next?next.index:text.length;};
// Config values that Git prints. The forms are every one that the survey produced on Git 2.54 (#1691, #1696): all
// documented config keys, the value shapes and the Controller, candidate and migration argument forms of the script.
const quotedValueStart=/\b(?:value|component|mode|parameter|orderfile|algorithm|chdir to|user dir in:|include path|unknown|invalid refspec|unsupported option) '/gi;
// A value after these runs to the next message line, quoted or not. '<key>' is a config key in the last three.
const unquotedValueStart=new RegExp(String.raw`\b(?:value for (?:config )?'?[^'\s]{1,256}'?(?: config (?:variable|option))?: |(?:invalid color value|invalid mode for object creation|bad --ignore-submodules argument): |unrecognized value [^'\s]{1,256}: |invalid [^'\s]{1,256} value: |invalid [^'\s]{1,256} mode )`,'gi');
const quoteBeforeWording=/'(?= for | value for|: |, possible values)/g,quoteAtLineEnd=/'(?=[^\S\n]*(?:\n|$))/g;
/** The last match of pattern (global) in text, or -1. */
const lastMatch=(pattern,text)=>{let last=-1;pattern.lastIndex=0;for(let m;(m=pattern.exec(text));)last=m.index;return last;};
/* The two passes below are code, not regular expressions: a backtracking expression that runs to the next message line
   overflows the stack on 16 MB of stderr, and one that searches for the closing quote turns quadratic. Each pass moves
   only forward and scans each message-line segment once, so it is linear, and it keeps only one position per kind. */
/** Hide each quoted config value as described above. */
function hideQuotedValues(text){
 let shown='',done=0,segmentStart=0,segmentEnd=-1,segment='',lastLineEnd=-1,nextWording=-1;
 quotedValueStart.lastIndex=0;
 for(let m;(m=quotedValueStart.exec(text));){
  const start=m.index+m[0].length;
  if(start>segmentEnd){
   segmentStart=start;segmentEnd=messageLineAfter(text,start);segment=text.slice(start,segmentEnd);
   const last=lastMatch(quoteAtLineEnd,segment);lastLineEnd=last<0?-1:segmentStart+last;nextWording=-1;quoteBeforeWording.lastIndex=0;
  }
  // The first quote before Git's wording at or after start; the search only moves forward within the segment.
  if(nextWording!==Infinity&&nextWording<start){
   quoteBeforeWording.lastIndex=start-segmentStart;const w=quoteBeforeWording.exec(segment);nextWording=w?segmentStart+w.index:Infinity;
  }
  const close=nextWording!==Infinity?nextWording:lastLineEnd>=start?lastLineEnd:-1;
  shown+=text.slice(done,start)+(close<0?'***':"***'");done=close<0?segmentEnd:close+1;
  quotedValueStart.lastIndex=done;
 }
 return shown+text.slice(done);
}
/** Hide each value that follows an unquotedValueStart wording, up to the next message line. */
function hideUnquotedValues(text){
 let shown='',done=0;
 unquotedValueStart.lastIndex=0;
 for(let m;(m=unquotedValueStart.exec(text));){
  const start=m.index+m[0].length;shown+=text.slice(done,start)+'***';done=messageLineAfter(text,start);
  unquotedValueStart.lastIndex=done;
 }
 return shown+text.slice(done);
}
const secretPatterns=[
 // Userinfo up to the last '@' of the authority, so a literal '@' in a password does not end it early.
 [/([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#]*@/gi,'$1***@'],
 // A password with '/' is not valid userinfo, but Git still prints such a URL: a ':' before the first '/' and the last
 // '@' within 128 characters after it are taken as userinfo. Neither run crosses a ':', so a word of many '://' stays
 // linear; a password that holds both '/' and ':' is not hidden.
 [/([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#@:]{0,128}:[^\s:]{0,128}@/gi,'$1***@'],
 [/\b((?:proxy-)?authorization)[^\S\n]*:[^\n]*/gi,'$1: ***'],
 // Query or form parameters and "password: value" pairs. Short or common names (auth, code, sig) count only after
 // '?', '&' or ';', so "exit code=128" stays readable.
 [/(?<![A-Za-z0-9_])((?:access_?token|refresh_?token|id_?token|token|password|passwd|pwd|pass|secret|client_?secret|api_?key|apikey|private_?token|signature)=)[^\s&#;'"]+/gi,'$1***'],
 [/([?&;](?:auth|code|sig)=)[^\s&#;'"]+/gi,'$1***'],
 [/\b(password|passwd|secret)[^\S\n]*:[^\S\n]*\S+/gi,'$1: ***'],
 // 'X{n}X*' rather than 'X{n,}': V8 overflows its stack on a long run under a counted open quantifier (16 MB of 'sk-').
 [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=_-]{8}[A-Za-z0-9._~+/=_-]*/gi,'$1 ***'],
 [/\b(?:gh[pousr]_[A-Za-z0-9]{20}[A-Za-z0-9]*|github_pat_[A-Za-z0-9_]{20}[A-Za-z0-9_]*|sk-[A-Za-z0-9_-]{20}[A-Za-z0-9_-]*|xox[abprs]-[A-Za-z0-9-]{10}[A-Za-z0-9-]*|AKIA[0-9A-Z]{16}\b)/g,'***'],
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
   Config values are hidden by two forward-only passes, and every pattern after them starts at a literal or a bounded
   scheme and ends at a separator or a line end, so redacting the whole stderr (at most maxBuffer, 16 MB) stays linear
   and within the regular expression stack. */
export function gitStderrExcerpt(stderr,limit=GIT_STDERR_EXCERPT_CHARACTERS){
 if(stderr===null||stderr===undefined)return '';
 let text=Buffer.isBuffer(stderr)?stderr.toString('utf8'):String(stderr);
 // A carriage return ends a line like a newline (progress output); other control characters separate words, so
 // "Bearer\0<token>" is still a Bearer token.
 text=text.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,' ');
 text=hideUnquotedValues(hideQuotedValues(text));
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
