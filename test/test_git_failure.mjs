import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {LOCAL_GIT_TIMEOUT_MILLISECONDS,gitFailureMessage,gitFailureReason,gitStderrExcerpt} from '../src/source-limits.mjs';
import {Controller} from '../src/controller.mjs';import {assertWorkLocation} from '../src/migration.mjs';import {commitCandidate} from '../src/candidate.mjs';import {createVerificationGit} from '../src/verification-git.mjs';

test('failure reason tells a timeout, a buffer overflow, a spawn error, a signal and an exit status apart',()=>{
 assert.equal(LOCAL_GIT_TIMEOUT_MILLISECONDS,20000);
 for(const [result,reason] of [
  [{error:Object.assign(Error('spawnSync git ETIMEDOUT'),{code:'ETIMEDOUT'}),signal:'SIGTERM',status:null},'timed out after 20000 ms'],
  [{error:Object.assign(Error('spawnSync git ENOBUFS'),{code:'ENOBUFS'}),signal:'SIGTERM',status:null},'output exceeded the buffer limit'],
  [{error:Object.assign(Error('spawnSync git ENOENT'),{code:'ENOENT'}),signal:null,status:null},'could not run: ENOENT'],
  [{error:null,signal:'SIGKILL',status:null},'terminated by SIGKILL'],
  [{error:null,signal:null,status:128},'exit status 128'],
 ])assert.equal(gitFailureReason(result),reason);
});

test('a real spawnSync timeout is reported as a timeout with the limit that was applied',()=>{
 const result=spawnSync(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:200});
 assert.equal(gitFailureReason(result,200),'timed out after 200 ms');
 assert.equal(gitFailureMessage('Git observation failed',result,200),'Git observation failed (timed out after 200 ms)');
});

test('stderr excerpt is one bounded line without control characters or credential-like values',()=>{
 const secret=['fatal: unable to access \'https://user:s3cr3t-pass@example.invalid/repo.git/\'',
  'Authorization: Bearer abcdefghijklmnop','Bearer abcdefghij_REST','token ghp_'+'a'.repeat(36),'key sk-'+'b'.repeat(24),'\u001b[31mred\u001b[0m'].join('\n');
 const excerpt=gitStderrExcerpt(Buffer.from(secret));
 for(const leaked of ['s3cr3t-pass','abcdefghijklmnop','_REST','a'.repeat(36),'b'.repeat(24),'\u001b','\n'])assert.equal(excerpt.includes(leaked),false,leaked);
 assert.equal(excerpt,"fatal: unable to access 'https://***@example.invalid/repo.git/' Authorization: *** Bearer *** token *** key *** [31mred [0m");
 assert.equal(gitStderrExcerpt(null),'');assert.equal(gitStderrExcerpt(Buffer.alloc(0)),'');
 assert.equal(gitFailureMessage('Candidate Git operation failed',{error:null,signal:null,status:1,stderr:Buffer.from('  \n')}),'Candidate Git operation failed (exit status 1)');
});

// Each gap that #1690 listed as known, and each form in which Git quotes a config value (Git's own messages).
test('stderr excerpt hides config values, query and form credentials, userinfo with @ and whole Authorization lines',()=>{
 for(const [input,expected] of [
  ["fatal: bad numeric config value 'https://u:s3cret@example.invalid/x' for 'core.compression' in file .git/config: invalid unit","fatal: bad numeric config value '***' for 'core.compression' in file .git/config: invalid unit"],
  ["fatal: bad boolean config value 'password=s3cret' for 'core.filemode'","fatal: bad boolean config value '***' for 'core.filemode'"],
  ["error: invalid value for 'core.checkstat': 's3cret'","error: invalid value for 'core.checkstat': ***"],
  ["Unknown value for 'diff.submodule' config variable: 's3cret'","Unknown value for 'diff.submodule' config variable: ***"],
  ["error: unknown 's3cret' value for 'x' config option","error: unknown '***' value for 'x' config option"],
  ["error: unknown value 's3cret' for key 'x'","error: unknown value '***' for key 'x'"],
  ['error: malformed value for core.foo: abc s3cret\nfatal: end','error: malformed value for core.foo: *** fatal: end'],
  ["error: unknown value for config 'diff.algorithm': a s3cret","error: unknown value for config 'diff.algorithm': ***"],
  ['error: invalid color value: a s3cret\nfatal: bad config variable','error: invalid color value: *** fatal: bad config variable'],
  ['fatal: invalid mode for object creation: a s3cret','fatal: invalid mode for object creation: ***'],
  ['fatal: bad --ignore-submodules argument: a s3cret','fatal: bad --ignore-submodules argument: ***'],
  ["warning: ignoring unknown core.fsync component 'a s3cret'","warning: ignoring unknown core.fsync component '***'"],
  ["warning: ignoring unknown core.fsyncmethod value 'a s3cret'","warning: ignoring unknown core.fsyncmethod value '***'"],
  ["fatal: cannot chdir to 'a s3cret': No such file or directory","fatal: cannot chdir to '***': No such file or directory"],
  ["error: unknown color-moved-ws mode 'a s3cret', possible values are 'ignore-space-change'","error: unknown color-moved-ws mode '***', possible values are 'ignore-space-change'"],
  ["  Unknown dirstat parameter 'a s3cret'","Unknown dirstat parameter '***'"],
  ["fatal: failed to read orderfile 'a s3cret': No such file or directory","fatal: failed to read orderfile '***': No such file or directory"],
  ["fatal: unknown fetch negotiation algorithm 'a s3cret'","fatal: unknown fetch negotiation algorithm '***'"],
  ["fatal: failed to expand user dir in: '~nouser/s3cret'","fatal: failed to expand user dir in: '***'"],
  ["error: could not expand include path '~nouser/s3cret'\nfatal: bad config line 9 in file .git/config","error: could not expand include path '***' fatal: bad config line 9 in file .git/config"],
  ["fatal: bad boolean config value 'a\ns3cret' for 'core.filemode'","fatal: bad boolean config value '***' for 'core.filemode'"],
  ["error: unknown value for config 'pack.foo': s3cret","error: unknown value for config 'pack.foo': ***"],
  ['fatal: https://user:p@ss@s3cret@example.invalid/repo','fatal: https://***@example.invalid/repo'],
  ['fatal: https://example.invalid/repo?access_token=s3cret&x=1#a','fatal: https://example.invalid/repo?access_token=***&x=1#a'],
  ['url ?token=s3cret;client_secret=s3cret&api_key=s3cret','url ?token=***;client_secret=***&api_key=***'],
  ['password=s3cret passwd: s3cret Secret : s3cret','password=*** passwd: *** Secret: ***'],
  ['Authorization: Custom a b c s3cret\r\nfatal: end','Authorization: *** fatal: end'],
  ['Proxy-Authorization:Negotiate s3cret','Proxy-Authorization: ***'],
 ]){const shown=gitStderrExcerpt(Buffer.from(input));assert.equal(shown,expected,input);assert.equal(shown.includes('s3cret'),false,input);}
 // The cost of hiding a header to the line end: text after it on the same line is hidden too.
 assert.equal(gitStderrExcerpt('Authorization: Bearer s3cret fatal: end'),'Authorization: ***');
 // Every pattern stays linear on four megabytes built from its own start; a quadratic one would take hours.
 for(const unit of ["value '",'value for ',"value for 'k': ","unknown '","component '","chdir to '","mode '","parameter '","orderfile '","algorithm '","user dir in: '","include path '",
  "value 'x\nfatal: ","value 'x' y","value 'x'\n","value 'x' for ","value '\n'","value for 'k': x\nfatal: ",'invalid color value: x\n','invalid color value: x\nerror: ','invalid mode for object creation: x\n','bad --ignore-submodules argument: x\n',
  'a@','https://','https://a:','https://a:b/','authorization:x\n','token=','?code=','password ','secret: ','bearer ','ghp_','sk-']){
  const started=performance.now();gitStderrExcerpt(Buffer.from(unit.repeat(Math.floor(4_000_000/unit.length))));assert.ok(performance.now()-started<10000,unit);
 }
 // The worst case of a quoted value: one opening quote and no closing quote before the end.
 const unclosed=performance.now();gitStderrExcerpt(Buffer.from("value '"+'x'.repeat(4_000_000)));assert.ok(performance.now()-unclosed<10000);
});

// #1696: a config value may hold a newline or a quote, and a control character may stand between a scheme and its token.
test('stderr excerpt hides multi-line and quoted config values up to the next Git message line',()=>{
 for(const [input,expected] of [
  // Quoted: up to the first quote followed by the rest of Git's wording, across lines and quotes inside the value.
  ["fatal: bad boolean config value 'it's' for 'core.filemode'","fatal: bad boolean config value '***' for 'core.filemode'"],
  ["fatal: bad boolean config value 'a\ns3cret' it's' for 'core.filemode'","fatal: bad boolean config value '***' for 'core.filemode'"],
  ["fatal: cannot chdir to 'a\ns3cret': No such file or directory","fatal: cannot chdir to '***': No such file or directory"],
  ["error: unknown color-moved-ws mode 'a's3cret', possible values are 'x'","error: unknown color-moved-ws mode '***', possible values are 'x'"],
  ["error: could not expand include path '~nouser/a\ns3cret'\r\nfatal: bad config line 9","error: could not expand include path '***' fatal: bad config line 9"],
  // After a colon, quoted or not: up to the next line that starts a Git message.
  ["error: invalid value for 'core.checkstat': 'first\ns3cret'\nfatal: bad config variable 'core.checkstat'","error: invalid value for 'core.checkstat': *** fatal: bad config variable 'core.checkstat'"],
  ['error: invalid color value: first\ns3cret\n  more s3cret\nfatal: bad config variable','error: invalid color value: *** fatal: bad config variable'],
  ['error: malformed value for push.default: a\ns3cret\nerror: must be one of nothing\nhint: x','error: malformed value for push.default: *** error: must be one of nothing hint: x'],
  // An unclosed quote stops at the next Git message line, so a following fatal: line stays readable.
  ["fatal: bad numeric config value 'a s3cret\nfatal: the reason","fatal: bad numeric config value '*** fatal: the reason"],
  ["warning: ignoring unknown core.fsync component 'a s3cret\nusage: git diff","warning: ignoring unknown core.fsync component '*** usage: git diff"],
  // A line of the value that ends with a quote does not end the value: the wording after a later quote does, and without
  // that wording the last quote at a line end (review of #1696).
  ["fatal: bad numeric config value 'x'\ns3cret' for 'core.compression' in file .git/config","fatal: bad numeric config value '***' for 'core.compression' in file .git/config"],
  ["error: could not expand include path '~nouser/a'\ns3cret'\nfatal: bad config line 9","error: could not expand include path '***' fatal: bad config line 9"],
  ["fatal: bad boolean config value 'a' for 'core.filemode' and value 's3cret' for 'core.x'","fatal: bad boolean config value '***' for 'core.filemode' and value '***' for 'core.x'"],
 ]){const shown=gitStderrExcerpt(Buffer.from(input));assert.equal(shown,expected,input);assert.equal(shown.includes('s3cret'),false,input);}
 // Known gaps, kept visible on purpose: a later value line that starts like a Git message, and a quoted value that
 // holds the rest of Git's wording, show what follows.
 assert.equal(gitStderrExcerpt("fatal: bad boolean config value 'a\nerror: s3cret' for 'core.filemode'"),"fatal: bad boolean config value '*** error: s3cret' for 'core.filemode'");
 assert.equal(gitStderrExcerpt("fatal: bad boolean config value 'a' for s3cret' for 'core.filemode'"),"fatal: bad boolean config value '***' for s3cret' for 'core.filemode'");
});

test('stderr excerpt treats control characters as separators before it redacts, and limits short parameter names to a query',()=>{
 // Before #1696 the patterns ran before control characters were folded, so a NUL or a tab after Bearer kept the token.
 for(const separator of ['\u0000','\t','\u001b','\u0085','\r'])for(const word of ['Bearer','token','basic']){
  const shown=gitStderrExcerpt(Buffer.from(`fatal: ${word}${separator}S3CRETabcdefgh`));assert.equal(shown,`fatal: ${word} ***`,JSON.stringify(separator));
 }
 // A carriage return ends a line: a header after progress output is hidden only to that line end.
 assert.equal(gitStderrExcerpt('Receiving 10%\rAuthorization: Bearer s3cret\rfatal: end'),'Receiving 10% Authorization: *** fatal: end');
 // A password with '/' is not valid userinfo; it is hidden when a ':' comes before the first '/' and an '@' follows.
 assert.equal(gitStderrExcerpt("fatal: unable to access 'https://user:pa/ss@example.invalid/repo/'"),"fatal: unable to access 'https://***@example.invalid/repo/'");
 assert.equal(gitStderrExcerpt('https://user:pa/s@s3cret@example.invalid/'),'https://***@example.invalid/');
 // The cost: a port before a path that holds an '@' is hidden too. A path '@' without a ':' is kept.
 assert.equal(gitStderrExcerpt('https://example.invalid:443/a@b'),'https://***@b');
 assert.equal(gitStderrExcerpt('https://example.invalid/@scope/pkg'),'https://example.invalid/@scope/pkg');
 // Known gap: a password with both '/' and ':' is shown, so that no run crosses a ':' and the scan stays linear.
 assert.equal(gitStderrExcerpt('https://user:pa/s:s@example.invalid/'),'https://user:pa/s:s@example.invalid/');
 // code, auth and sig are credentials only as query or form parameters.
 assert.equal(gitStderrExcerpt('error: exit code=128 auth=none sig=none'),'error: exit code=128 auth=none sig=none');
 assert.equal(gitStderrExcerpt('https://example.invalid/cb?code=s3cret&auth=s3cret;sig=s3cret'),'https://example.invalid/cb?code=***&auth=***;sig=***');
});

// One key for each form that the survey found (scripts/survey-git-config-stderr.mjs, #1691, #1696), run through the same
// Git commands and environment as Controller, with a one-line value and a multi-line value that holds a quote.
// No key may leak on any Git. On Git 2.54 or later, where the survey ran, every key must also be quoted and shown in
// its own masked form; an older Git may word or skip a message differently, so there only two keys must be quoted.
const surveyedGit=[2,54];
const surveyedForms=[
 ['core.compression',['rev-parse','HEAD'],"bad numeric config value '***' for 'core.compression'"],
 ['core.filemode',['ls-tree','HEAD'],"bad boolean config value '***' for 'core.filemode'"],
 ['core.checkStat','diff',"invalid value for 'core.checkstat': *** fatal: bad config variable 'core.checkstat'"],
 ['color.diff.meta','diff','invalid color value: *** fatal: bad config variable'],
 ['core.createObject','diff','invalid mode for object creation: ***'],
 ['core.fsync','diff',"ignoring unknown core.fsync component '***'"],
 ['core.fsyncMethod','diff',"ignoring unknown core.fsyncMethod value '***'"],
 ['core.worktree','diff',"cannot chdir to '***': "],
 ['diff.algorithm','diff',"unknown value for config 'diff.algorithm': *** fatal: "],
 ['diff.colorMovedWS','diff',"unknown color-moved-ws mode '***', possible values are"],
 ['diff.dirstat','diff',"Unknown dirstat parameter '***'"],
 ['diff.ignoreSubmodules','diff','bad --ignore-submodules argument: ***'],
 ['diff.orderFile','diff',"failed to read orderfile '***': "],
 ['diff.submodule','diff',"Unknown value for 'diff.submodule' config variable: ***"],
 ['fetch.negotiationAlgorithm','diff',"unknown fetch negotiation algorithm '***'"],
 ['push.default','diff','malformed value for push.default: *** error: must be one of'],
 ['core.excludesFile','diff',"failed to expand user dir in: '***'",'~nouser/'],
 ['include.path','diff',"could not expand include path '***' fatal: ",'~nouser/'],
];
test('real Git output for each config value wording found by the survey shows its masked form and no value',{skip:process.platform==='win32'},t=>{
 const {root,repo,git}=repository(t);fs.writeFileSync(path.join(repo,'code.txt'),'after');git('commit','-qam','second');
 const env={PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'};
 const run=args=>spawnSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','protocol.allow=never',...args],{cwd:repo,env});
 const diff=['diff','--no-ext-diff','--no-textconv','--binary','HEAD~1','HEAD'];
 const version=execFileSync('git',['--version'],{encoding:'utf8'}).match(/(\d+)\.(\d+)/).slice(1).map(Number);
 const surveyed=version[0]>surveyedGit[0]||(version[0]===surveyedGit[0]&&version[1]>=surveyedGit[1]);
 // Through --file from outside the repository: a bad core.worktree also stops a plain 'git config' in the repository.
 const config=(...rest)=>execFileSync('git',['config','--file',path.join(repo,'.git','config'),...rest],{cwd:root,stdio:'pipe'});
 const quoted=new Set();
 for(const [key,args,form,path_=''] of surveyedForms)for(const value of [`${path_}S3CRETX https://u:S3CRETY@example.invalid/`,`${path_}S3CRETX\nS3CRETY it's`]){
  config(key,value);const p=run(args==='diff'?diff:args),stderr=p.stderr.toString();config('--unset',key);
  const shown=gitStderrExcerpt(p.stderr),label=`${key} ${JSON.stringify(value)}: ${shown}`;
  assert.equal(/S3CRET/.test(shown),false,label);
  if(stderr.includes('S3CRETX'))quoted.add(key);
  if(surveyed){assert.ok(stderr.includes('S3CRETX'),`Git ${version.join('.')} did not quote ${label}`);assert.ok(shown.includes(form),label);}
 }
 if(!surveyed)t.diagnostic(`Git ${version.join('.')} is older than the survey; it quoted ${quoted.size} of ${surveyedForms.length} keys`);
 assert.ok(quoted.size>=(surveyed?surveyedForms.length:2),`Git quoted ${quoted.size} keys`);
});

// The survey script reproduces the pinned forms; two keys keep this fast, the full run is documented in the script.
test('the config survey script finds the quoted wordings of two keys and reports no leak',{skip:process.platform==='win32'},()=>{
 const p=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/survey-git-config-stderr.mjs',import.meta.url)),'--keys','core.compression,color.diff.meta','--values','["S3CRETX\\nS3CRETY it\'s"]'],{encoding:'utf8'});
 assert.equal(p.status,0,p.stdout+p.stderr);
 const report=JSON.parse(p.stdout);assert.equal(report.keys,2);assert.deepEqual(report.leaked,[]);
 assert.ok(report.forms.some(f=>f.key==='core.compression'&&f.form.startsWith("fatal: bad numeric config value '<v>")),p.stdout);
 assert.ok(report.forms.some(f=>f.key==='color.diff.meta'&&f.form.startsWith('error: invalid color value: <v>')),p.stdout);
});

test('real Git quotes a malformed repo-local config value, and the Controller message hides it',{skip:process.platform==='win32'},t=>{
 const {c,git}=repository(t);
 git('config','core.compression','https://u:s3cret@example.invalid/x');
 assert.throws(()=>c.git('rev-parse','HEAD'),e=>/^Git observation failed \(exit status 128; stderr: .*bad numeric config value '\*\*\*' for 'core\.compression'/.test(e.message)&&!e.message.includes('s3cret'));
 git('config','--unset','core.compression');git('config','core.filemode','password=s3cret');
 assert.throws(()=>c.git('ls-tree','HEAD'),e=>/bad boolean config value '\*\*\*' for 'core\.filemode'/.test(e.message)&&!e.message.includes('s3cret'));
});

// Git prints the email only in "empty ident name (for <email>)" and "unable to auto-detect email address (got '<email>')".
// commitCandidate rejects an empty name or email and always passes both with -c, so neither path is reachable; a name
// that Git rejects is printed without the email.
test('a commit identity that Git rejects does not put the email into the candidate message',{skip:process.platform==='win32'},t=>{
 const {c,root}=repository(t);
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 assert.throws(()=>commitCandidate(c,workspace,{name:'<>',email:'owner@example.com'}),e=>/^Candidate Git operation failed \(exit status 128; stderr: fatal: name consists only of disallowed characters: <>\)$/.test(e.message)&&!e.message.includes('owner@example.com'));
 assert.throws(()=>commitCandidate(c,workspace,{name:'',email:'owner@example.com'}),/Invalid commit identity/);
 assert.throws(()=>commitCandidate(c,workspace,{name:'Owner',email:''}),/Invalid commit identity/);
});

test('stderr excerpt keeps the final fatal line and redacts before it cuts',()=>{
 const noisy='hint: '+'x'.repeat(10000)+' fatal: the reason';
 assert.equal(gitStderrExcerpt(Buffer.from(noisy.replace(' fatal','\nfatal'))),'…'+noisy.slice(-512));
 // A credential that starts before the cut is redacted as a whole, wherever the cut falls.
 const boundary=Buffer.from('fatal: https://user:'+'p'.repeat(600)+'@example.invalid/ '+' '.repeat(3000)+'\n');
 assert.equal(gitStderrExcerpt(boundary),'fatal: https://***@example.invalid/');
 for(const length of [100,500,1500,2028,2032,2040,5000]){
  const bearer=gitStderrExcerpt(Buffer.from('x'.repeat(5000)+' Authorization: Bearer '+'A'.repeat(length)+'\nfatal: end'));
  assert.equal(bearer.includes('AAAA'),false,String(length));assert.match(bearer,/Authorization: \*\*\* fatal: end$/);
  const custom=gitStderrExcerpt(Buffer.from('Authorization: Custom eyJ'+'v'.repeat(length)+' '+Array.from({length:48},()=>'ghp_'+'a'.repeat(36)).join(' ')+'\nfatal: end'));
  assert.equal(custom.includes('vvvv'),false,String(length));assert.match(custom,/\*\*\* fatal: end$/);
 }
 for(const prefix of ['1','...','-','x'.repeat(40)])assert.equal(gitStderrExcerpt(`fatal: ${prefix}https://u:s3cr3t@example.invalid/`).includes('s3cr3t'),false,prefix);
 // Sixteen megabytes (the largest Controller stderr) of stderr without spaces stays linear.
 const started=performance.now(),huge=gitStderrExcerpt(Buffer.from('a.'.repeat(8_000_000)));
 assert.ok(performance.now()-started<10000);assert.equal(huge,'…'+'a.'.repeat(256));
 assert.equal(gitStderrExcerpt('é'.repeat(600)),'…'+'é'.repeat(512));assert.equal(gitStderrExcerpt('😀'.repeat(600)),'…'+'😀'.repeat(512));
 // An odd cut starts the tail at a lone low surrogate, which must not be shown.
 assert.equal(gitStderrExcerpt('😀'.repeat(600)+'x'),'…'+'😀'.repeat(511)+'x');
});

function repository(t){
 const root=tempDir('asc-git-failure-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'code.txt'),'before');git('add','.');git('commit','-qm','base');
 const contract={intent:'Change code',criteria:['after'],allowedPaths:['code.txt'],testArgv:['/bin/true'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''};
 return {root,repo,git,contract,c:new Controller({repo,base:git('rev-parse','HEAD'),contract,implementer:'worker'})};
}
// Fail only the named Git subcommand and pass every other call to the real Git, like test_project_assets.mjs.
let toolCount=0;
function withFailingGit(root,subcommand,body,run){
 const tools=path.join(root,`tools-${++toolCount}`),realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),originalPath=process.env.PATH;fs.mkdirSync(tools);
 fs.writeFileSync(path.join(tools,'git'),`#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);if(args.includes(${JSON.stringify(subcommand)})){${body}}const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);\n`,{mode:0o755});
 process.env.PATH=tools+path.delimiter+originalPath;
 try{return run();}finally{process.env.PATH=originalPath;}
}
const exitWithSecret="process.stderr.write(\"fatal: cannot reach https://user:s3cr3t@example.invalid/\\n\");process.exit(3);";
const killSelf="process.kill(process.pid,'SIGKILL');";

test('Controller Git observation names the exit status and a redacted stderr excerpt',{skip:process.platform==='win32'},t=>{
 const {c,root}=repository(t);
 assert.throws(()=>c.git('rev-parse','--verify','missing^{commit}'),{message:/^Git observation failed \(exit status 128; stderr: fatal: .+\)$/});
 withFailingGit(root,'ls-tree',exitWithSecret,()=>assert.throws(()=>c.git('ls-tree','HEAD'),{message:'Git observation failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'}));
 withFailingGit(root,'ls-tree',killSelf,()=>assert.throws(()=>c.git('ls-tree','HEAD'),{message:'Git observation failed (terminated by SIGKILL)'}));
 // gitLarge sends stdout to a file descriptor; stderr is still piped and reported.
 withFailingGit(root,'diff',exitWithSecret,()=>assert.throws(()=>c.gitLarge('diff','HEAD','HEAD'),{message:'Git observation failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'}));
});

test('candidate Git operation names the exit status or signal of the failed step',{skip:process.platform==='win32'},t=>{
 const {c,root,repo,git}=repository(t);const head=git('rev-parse','HEAD');
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 withFailingGit(root,'commit-tree',exitWithSecret,()=>assert.throws(()=>commitCandidate(c,workspace),{message:'Candidate Git operation failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'}));
 withFailingGit(root,'commit-tree',killSelf,()=>assert.throws(()=>commitCandidate(c,workspace),{message:'Candidate Git operation failed (terminated by SIGKILL)'}));
 assert.equal(git('rev-parse','HEAD'),head);assert.equal(fs.readFileSync(path.join(repo,'code.txt'),'utf8'),'before');
});

test('verification Git index names the exit status or signal of read-tree',{skip:process.platform==='win32'},t=>{
 const {c,root,git}=repository(t);const head=git('rev-parse','HEAD'),commit=c.git('cat-file','commit',head),blobs=c.blobs(head);
 for(const [index,[body,message]] of Object.entries( [[exitWithSecret,'Verification Git index failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'],[killSelf,'Verification Git index failed (terminated by SIGKILL)']])){
  const view=path.join(root,`view-${index}`);fs.mkdirSync(view);
  withFailingGit(root,'read-tree',body,()=>assert.throws(()=>createVerificationGit(view,head,commit,blobs),{message}));
 }
});

test('a migration Git failure names the exit status and the end of stderr',t=>{
 const root=tempDir('asc-migration-git-failure-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // The first rev-parse fails the way a non-Git start did without a reason before (#1688). A .git file that names a
 // missing directory stops Git at this directory, so the result does not depend on whether os.tmpdir() is inside a
 // repository (#1702); the migration Git env is fixed, so GIT_CEILING_DIRECTORIES cannot be set instead.
 // The target sits inside a repository on purpose, as when os.tmpdir() is inside one.
 execFileSync('git',['init','-q',root]);const inner=path.join(root,'inner');fs.mkdirSync(inner);
 fs.writeFileSync(path.join(inner,'.git'),`gitdir: ${path.join(root,'missing')}\n`);
 // Not asserted on purpose (#1702): that migration passes its 120000 ms bound to the helper. Only a real timeout shows
 // it, which takes two minutes; the reason text for any bound is covered by the gitFailureReason tests above.
 assert.throws(()=>assertWorkLocation(inner),e=>/^Migration Git operation failed \(exit status 128; stderr: fatal: not a git repository/.test(e.message));
});
