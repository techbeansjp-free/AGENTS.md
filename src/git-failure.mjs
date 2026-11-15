/** Describe why a local Git child failed, so a timeout under load can be told apart from an error reported by Git. */

/* Upper bound for one local Git child (no prompt, hook or network). No call has been observed near it; see #1679. */
export const LOCAL_GIT_TIMEOUT_MILLISECONDS=20000;
export const GIT_STDERR_EXCERPT_CHARACTERS=512;

/* Git does not print secrets on these paths, but a remote URL or a header copied from config could carry one. */
const secretPatterns=[
 [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi,'$1***@'],
 [/\b(authorization|proxy-authorization)\s*:\s*\S+(\s+\S+)?/gi,'$1: ***'],
 [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,'$1 ***'],
 [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,'***'],
];

export function gitFailureReason(result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 if(result.error?.code==='ETIMEDOUT')return `timed out after ${timeoutMilliseconds} ms`;
 if(result.error?.code==='ENOBUFS')return 'output exceeded the buffer limit';
 if(result.error)return `could not run: ${result.error.code??result.error.message}`;
 if(result.signal)return `terminated by ${result.signal}`;
 return `exit status ${result.status}`;
}

/** One line of stderr, bounded, with control characters and credential-like values removed. Empty when there is none. */
export function gitStderrExcerpt(stderr,limit=GIT_STDERR_EXCERPT_CHARACTERS){
 if(stderr===null||stderr===undefined)return '';
 let text=(Buffer.isBuffer(stderr)?stderr.subarray(0,limit*4).toString('utf8'):String(stderr).slice(0,limit*4));
 text=text.replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ');
 for(const [pattern,replacement] of secretPatterns)text=text.replace(pattern,replacement);
 text=text.replace(/\s+/g,' ').trim();
 return [...text].length>limit?[...text].slice(0,limit).join('')+'…':text;
}

/** `<label> (<reason>[; stderr: <excerpt>])`. The label stays first so existing callers can still match it. */
export function gitFailureMessage(label,result,timeoutMilliseconds=LOCAL_GIT_TIMEOUT_MILLISECONDS){
 const excerpt=gitStderrExcerpt(result.stderr);
 return `${label} (${gitFailureReason(result,timeoutMilliseconds)}${excerpt?`; stderr: ${excerpt}`:''})`;
}
