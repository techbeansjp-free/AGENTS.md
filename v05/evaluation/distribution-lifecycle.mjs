/** Real offline npm lifecycle inside a filesystem/network/PID-isolated Linux namespace.
 * Usage: node distribution-lifecycle.mjs <old.tgz> <candidate.tgz> <old-version> <candidate-version>
 * The candidate is not published; no user project or credentials enter the namespace.
 */
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.argv[2]!=='--inside'){
 assert.equal(process.platform,'linux','This acceptance driver requires Linux bubblewrap');
 assert.equal(process.argv.length,6,'Expected two archives and their exact versions');
 const [old,candidate]=process.argv.slice(2,4).map(p=>fs.realpathSync(p));
 const [expectedOld,expectedCandidate]=process.argv.slice(4);
 assert(expectedOld&&expectedCandidate&&expectedOld!==expectedCandidate);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-distribution-lifecycle-'));
 const sentinel=path.join(root,'host-only');fs.writeFileSync(sentinel,'dummy-host-sentinel');
 const input=path.join(root,'input'),work=path.join(root,'work');fs.mkdirSync(input);fs.mkdirSync(work);
 fs.copyFileSync(old,path.join(input,'old.tgz'));fs.copyFileSync(candidate,path.join(input,'candidate.tgz'));
 fs.copyFileSync(fileURLToPath(import.meta.url),path.join(input,'driver.mjs'));
 const runtime=path.resolve(fs.realpathSync(process.execPath),'../..');
 const server=net.createServer(socket=>socket.end());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const args=['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr',
  '--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
  '--ro-bind',runtime,'/runtime','--ro-bind',input,'/input','--bind',work,'/work',
  '--proc','/proc','--dev','/dev','--tmpfs','/tmp','--clearenv',
  '--setenv','PATH','/runtime/bin:/usr/bin:/bin','--setenv','HOME','/work/home',
  '--setenv','TMPDIR','/tmp','--chdir','/work','--','/runtime/bin/node','/input/driver.mjs','--inside',sentinel,String(server.address().port)];
 const started=Date.now();
 try{
  const p=spawnSync('/usr/bin/bwrap',args,{encoding:'utf8',maxBuffer:8000000});
  assert.equal(fs.readFileSync(sentinel,'utf8'),'dummy-host-sentinel');
  assert.equal(p.status,0,p.stderr||p.error?.message);
  const result=JSON.parse(p.stdout);assert.equal(result.oldVersion,expectedOld);assert.equal(result.candidateVersion,expectedCandidate);
  console.log(JSON.stringify({schema:'asc-distribution-lifecycle/v1',passed:true,seconds:(Date.now()-started)/1000,
   isolation:'bubblewrap unshare-all; runtime/input read-only; private HOME/tmp; no host project or credentials mounted',
   oldSha256:sha(fs.readFileSync(old)),candidateSha256:sha(fs.readFileSync(candidate)),...result},null,2));
 }finally{server.close();fs.rmSync(root,{recursive:true,force:true});}
}else{
 const checks=[],run=(argv,cwd='/work',env={})=>execFileSync(argv[0],argv.slice(1),{cwd,env:{...process.env,...env},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const attempt=(argv,env={})=>spawnSync(argv[0],argv.slice(1),{cwd:'/work',env:{...process.env,...env},encoding:'utf8'});
 const node=process.execPath,npm='/runtime/lib/node_modules/npm/bin/npm-cli.js';
 fs.mkdirSync('/work/home');assert(!fs.existsSync(process.argv[3]));assert(!fs.existsSync('/home'));assert(!fs.existsSync('/input/../host-only'));
 assert(!fs.existsSync('/sys/class/net'));
 await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port:Number(process.argv[4])});socket.on('connect',()=>{socket.destroy();reject(Error('Host network reachable'));});socket.on('error',resolve);});
 checks.push('host sentinel unreadable and host TCP listener unreachable');
 const tools='/work/tools',repo='/work/origin',work='/work/project';fs.mkdirSync(repo);
 const git=(...args)=>run(['git',...args],repo);
 git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
 fs.writeFileSync(repo+'/app.txt','owner code');git('add','.');git('commit','-qm','base');git('worktree','add','-qb','task',work);
 const cli=tools+'/node_modules/agent-skill-chain/bin/asc-v05.mjs';
 const install=(tar,prefix=tools)=>run([node,npm,'install','--prefix',prefix,'--offline','--ignore-scripts','--no-audit','--no-fund','--save-exact',tar]);
 const call=(...args)=>JSON.parse(run([node,cli,...args]));
 install('/input/old.tgz');const oldVersion=run([node,cli,'--version']).trim();
 assert(call('project-assets',work,'--register-skill','--apply').applied);
 fs.mkdirSync(work+'/docs',{recursive:true});fs.writeFileSync(work+'/docs/owner.md','owner specification');
 fs.mkdirSync(work+'/.agent-skill-chain/project',{recursive:true});fs.writeFileSync(work+'/.agent-skill-chain/project/rules.md','owner rules');
 fs.writeFileSync(work+'/app.txt','uncommitted owner code');
 fs.writeFileSync(work+'/.agent-skill-chain/project/context.json',JSON.stringify({schema:'asc-project-context/v1',rules:[{path:'.agent-skill-chain/project/rules.md',appliesTo:['src/ui']},{path:'docs/owner.md',appliesTo:['src/api']}]}));
 const ownerFiles=['.agent-skill-chain/project/context.json','app.txt','docs/owner.md','.agent-skill-chain/project/rules.md'];
 const ownerBefore=ownerFiles.map(p=>sha(fs.readFileSync(path.join(work,p))));
 const indexPath=git('rev-parse','--git-path','worktrees/project/index').trim();
 let indexExpected=sha(fs.readFileSync(path.resolve(repo,indexPath)));
 const preserved=()=>{assert.deepEqual(ownerFiles.map(p=>sha(fs.readFileSync(path.join(work,p)))),ownerBefore);assert.equal(sha(fs.readFileSync(path.resolve(repo,indexPath))),indexExpected);};
 const beforeStart=performance.now();for(let i=0;i<5;i++)call('start',work);const baselineStartMs=(performance.now()-beforeStart)/5;
 checks.push('baseline tarball installed and legacy assets deployed');
 let oldWorktree;
 if(fs.existsSync(work+'/.agent-skill-chain/managed-runtime/package.json')){
  run(['git','add','.'],work);run(['git','commit','-qm','baseline distributed runtime'],work);
  oldWorktree='/work/old-version-worktree';run(['git','worktree','add','-qb','old-version',oldWorktree],work);
  indexExpected=sha(fs.readFileSync(path.resolve(repo,indexPath)));
 }

 fs.writeFileSync('/work/broken.tgz','not a tarball');
 const broken=attempt([node,npm,'install','--prefix',tools,'--offline','--ignore-scripts','--no-audit','--no-fund','/work/broken.tgz']);assert.notEqual(broken.status,0);assert.equal(run([node,cli,'--version']).trim(),oldVersion);preserved();
 checks.push('invalid update rejected; previous CLI and owner files preserved');
 install('/input/candidate.tgz');const candidateVersion=run([node,cli,'--version']).trim();assert.notEqual(candidateVersion,oldVersion);
 assert(call('project-assets',work,'--register-skill','--apply').applied);preserved();
 if(oldWorktree){assert.equal(run([node,oldWorktree+'/.agent-skill-chain/bin/asc.mjs','--version']).trim(),oldVersion);checks.push('updating one worktree keeps the other worktree running its pinned old version');}
 const launcher=work+'/.agent-skill-chain/bin/asc.mjs';
 const launch=(...args)=>run([node,launcher,...args],'/work',{ASC_CLI:cli});
 assert.equal(launch('--version').trim(),candidateVersion);
 assert.equal(call('project-assets',work).changes.length,0);
 const afterStart=performance.now();let selected;for(let i=0;i<5;i++)selected=call('start',work,'--path','src/ui/view.ts');const candidateStartMs=(performance.now()-afterStart)/5;
 assert.deepEqual(selected.context.references.map(r=>r.path),['.agent-skill-chain/project/rules.md']);assert(!JSON.stringify(selected.context).includes('owner rules'));
 const beforeDigest=selected.context.digest;fs.writeFileSync(work+'/.agent-skill-chain/project/rules.md','changed rule');assert.notEqual(call('start',work,'--path','src/ui/view.ts').context.digest,beforeDigest);fs.writeFileSync(work+'/.agent-skill-chain/project/rules.md','owner rules');preserved();
 checks.push('candidate update, legacy asset migration and idempotent reapply');
 checks.push('installed CLI selects owner rules, omits bodies, detects changes and preserves settings');
 // Commit the actual distributed runtime and clone it without installation or ASC_CLI.
 run(['git','add','.'],work);run(['git','commit','-qm','distributed runtime'],work);
 const frozen='/work/frozen-worktree';run(['git','worktree','add','-qb','frozen',frozen],work);
 const frozenLauncher=frozen+'/.agent-skill-chain/bin/asc.mjs';
 assert.equal(run([node,frozenLauncher,'--version']).trim(),candidateVersion);
 const clone='/work/consumer-clone';run(['git','clone','-q',repo,clone]);
 // clone the delivered task branch, rather than the origin's untouched base.
 run(['git','checkout','task'],clone);
 assert.equal(run([node,clone+'/.agent-skill-chain/bin/asc.mjs','--version']).trim(),candidateVersion);
 assert.equal(JSON.parse(run([node,frozenLauncher,'start',frozen,'--path','src/ui/view.ts'])).context.references.length,1);
 checks.push('committed runtime runs in fresh worktree and clone without npm install or ASC_CLI');
 // The committed index now intentionally contains the fixture's delivered assets.
 const deliveredIndex=sha(fs.readFileSync(path.resolve(repo,indexPath)));
 indexExpected=deliveredIndex;

 const skill=work+'/.agent-skill-chain/skills/asc/SKILL.md',original=fs.readFileSync(skill);
 fs.appendFileSync(skill,'\nowner customization\n');const conflict=attempt([node,cli,'project-assets',work,'--apply']);assert.equal(conflict.status,2);assert(fs.readFileSync(skill,'utf8').endsWith('owner customization\n'));preserved();fs.writeFileSync(skill,original);
 checks.push('owner-edited shared Skill blocks overwrite');
 install('/input/old.tgz');assert.equal(run([node,frozenLauncher,'--version']).trim(),candidateVersion);assert.notEqual(attempt([node,launcher,'--version'],{ASC_CLI:cli}).status,0);preserved();
 assert(call('project-assets',work,'--register-skill','--apply').applied);preserved();
 assert.equal(run([node,cli,'--version']).trim(),oldVersion);
 checks.push('explicit old-version rollback and asset rollback preserve user data; mismatched launcher refused');
 install('/input/candidate.tgz');assert(call('project-assets',work,'--register-skill','--apply').applied);assert.equal(launch('--version').trim(),candidateVersion);preserved();
 const record=fs.readFileSync(work+'/.agent-skill-chain/distribution.json');
 run([node,npm,'uninstall','--prefix',tools,'--offline','--ignore-scripts','--no-audit','--no-fund','agent-skill-chain']);
 assert(!fs.existsSync(cli));assert.notEqual(attempt([node,launcher,'--version'],{ASC_CLI:cli}).status,0);preserved();assert.deepEqual(fs.readFileSync(work+'/.agent-skill-chain/distribution.json'),record);
 assert.equal(run([node,launcher,'--version']).trim(),candidateVersion);
 checks.push('uninstall removes external npm runtime; explicit missing override refused; default bundled runtime and owner files remain usable');
 install('/input/candidate.tgz');assert.equal(launch('--version').trim(),candidateVersion);assert.deepEqual(fs.readFileSync(work+'/.agent-skill-chain/distribution.json'),record);preserved();
 checks.push('reinstall restores execution without regenerating shared assets');
 assert.equal(run([node,launcher,'--version']).trim(),candidateVersion);assert.equal(run([node,frozenLauncher,'--version']).trim(),candidateVersion);
 checks.push('shared external prefix updates do not stop default bundled execution in another worktree');
 const second='/work/second environment';fs.mkdirSync(second);fs.cpSync(work+'/.agent-skill-chain',second+'/.agent-skill-chain',{recursive:true});
 const otherTools='/work/other tools';install('/input/candidate.tgz',otherTools);
 const otherCLI=otherTools+'/node_modules/agent-skill-chain/bin/asc-v05.mjs';
 const result=JSON.parse(run([node,second+'/.agent-skill-chain/bin/asc.mjs','start',second,'--path','src/ui/view.ts'],'/work',{ASC_CLI:otherCLI}));assert.equal(result.gitManaged,false);assert.deepEqual(fs.readFileSync(second+'/.agent-skill-chain/distribution.json'),record);
 checks.push('second non-Git environment uses identical shared assets with a different installation prefix');
 console.log(JSON.stringify({oldVersion,candidateVersion,checks,startMeasurement:{samples:5,baselineStartMs,candidateStartMs,contextOutputBytes:Buffer.byteLength(JSON.stringify(selected.context)),modelTokens:'not measured; no model invocation'},ownerFilesPreserved:true,indexPreserved:true,externalModelCalls:0,
  deletionScope:'npm runtime uninstall; shared project assets intentionally retained, not an automatic project-asset remover',
  failureScope:'invalid archive before update; not disk-full, SIGKILL or power-loss atomicity'}));
}
