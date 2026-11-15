/* Git batch size is an I/O chunk, not a repository or individual file limit. */
export const SOURCE_BATCH_BYTES=12_000_000;

/* Bounds of one local Git child (no prompt, hook or network) and how a bounded child failed.
   They live here because a new runtime file needs a staged package inventory change (#1679, #1685). */
/* No call has been observed near this limit; a longer one does not cure the stdin hang of #1682. */
export const LOCAL_GIT_TIMEOUT_MILLISECONDS=20000;
export const GIT_STDERR_EXCERPT_CHARACTERS=512;

/* Git does not print secrets on these paths, but a remote URL or a header copied from config could carry one.
   Known gaps: a userinfo with a literal '@', and long words after 'basic' or 'token' are also hidden. */
const secretPatterns=[
 [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi,'$1***@'],
 [/\b(authorization|proxy-authorization)\s*:\s*\S+(\s+\S+)?/gi,'$1: ***'],
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

/** The end of stderr on one line, where Git prints its fatal message. Credential-like values are removed before it is cut. */
export function gitStderrExcerpt(stderr,limit=GIT_STDERR_EXCERPT_CHARACTERS){
 if(stderr===null||stderr===undefined)return '';
 let text=(Buffer.isBuffer(stderr)?stderr.toString('utf8'):String(stderr)).replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ');
 for(const [pattern,replacement] of secretPatterns)text=text.replace(pattern,replacement);
 const characters=[...text.replace(/\s+/g,' ').trim()];
 return characters.length>limit?'…'+characters.slice(-limit).join(''):characters.join('');
}

/** `<label> (<reason>[; stderr: <excerpt>])`. The label stays first so existing callers can still match it. */
export function gitFailureMessage(label,result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 const excerpt=gitStderrExcerpt(result.stderr);
 return `${label} (${gitFailureReason(result,timeoutMilliseconds)}${excerpt?`; stderr: ${excerpt}`:''})`;
}
