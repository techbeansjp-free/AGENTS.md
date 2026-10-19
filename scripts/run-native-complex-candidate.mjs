import {gitControlState} from './native-git-boundary.mjs';
/** Synthetic current-Host delivery candidate. Agent has no network; publication is a separate verified Host operation. */
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {configuration} from '../src/restricted-agent.mjs';
import {fileURLToPath} from 'node:url';
import {extendFixturePermissions} from './complex-permissions.mjs';
const [tarball,codex,mode,extra]=process.argv.slice(2);
if (process.argv.length>6 || (extra!==undefined&&extra!=='--accessor-oracle') || (mode!==undefined&&mode!=='--deliver') || !tarball || !codex || !path.isAbsolute(tarball) || !path.isAbsolute(codex)) throw Error('Usage: node scripts/run-native-complex-candidate.mjs <absolute-tarball> <absolute-codex> [--deliver]');
const accessorOracle=extra==='--accessor-oracle';
const root=fs.mkdtempSync('/var/tmp/asc-native-complex-'),origin=path.join(root,'origin'),runtime=path.join(root,'runtime'),bootstrap=path.join(root,'bootstrap'),pkg=path.join(root,'distribution');
for(const p of [origin,runtime,bootstrap,pkg])fs.mkdirSync(p);
execFileSync('tar',['-xzf',tarball,'-C',pkg]);
const env={...process.env};for(const k of Object.keys(env))if(/^git_/i.test(k))delete env[k];
const repository='adachi-tatsuru/asc-public-synthetic-eval-20261016';
execFileSync('git',['clone','--single-branch','--branch','main',`git@github.com:${repository}.git`,origin],{env,stdio:['ignore','pipe','pipe']});
const git=(...a)=>execFileSync('git',a,{cwd:origin,env,encoding:'utf8'}).trim();
git('config','user.name','Synthetic Tester');git('config','user.email','test@example.invalid');
const remoteBase=git('rev-parse','HEAD');
const source=fileURLToPath(new URL('../test/fixtures/complex-issues/',import.meta.url));
fs.cpSync(source,path.join(origin,'complex'),{recursive:true});
if(accessorOracle)fs.copyFileSync(fileURLToPath(new URL('./check-complex-accessors.mjs',import.meta.url)),path.join(origin,'complex/oracle/accessors.mjs'));
// Fixture preparation, outside measured development: keep the unrelated existing greeting oracle green.
fs.writeFileSync(path.join(origin,'greeting.py'),'def greeting():\n    return "Hello"\n');
fs.writeFileSync(path.join(origin,'.github/workflows/complex.yml'),`name: Synthetic complex acceptance
on: [pull_request]
permissions:
  contents: read
jobs:
  complex:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: |
          node complex/oracle/reservation.mjs complex
          node complex/oracle/billing.mjs complex
          node complex/oracle/integration.mjs complex
          node complex/oracle/unknown-keys.mjs complex
${accessorOracle?'          node complex/oracle/accessors.mjs complex\n':''}`);
git('add','complex','greeting.py','.github/workflows/complex.yml');
// Identical fixture trees and parent must yield the same comparison base;
// only this evaluator-owned preparation commit has a fixed timestamp.
execFileSync('git',['-c','commit.gpgsign=false','commit','-m','Prepare synthetic complex acceptance fixture'],{
 cwd:origin,env:{...env,GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'},stdio:['ignore','pipe','pipe']});
const base=git('rev-parse','HEAD');git('branch','develop',base);
const now=new Date(),pad=n=>String(n).padStart(2,'0');
const stamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const slug='native-'+stamp.replace('_','-'),branch='test/9000-'+slug,worktree=path.join(origin,'.worktrees',stamp+'-9000-'+slug);git('worktree','add','-b',branch,worktree,base);
const cli=path.join(pkg,'package','bin','asc-v05.mjs'),skill=path.join(pkg,'package','skills','asc','SKILL.md');
const c=configuration({workspace:bootstrap,runtime,executable:fs.realpathSync(codex),writable:true});
extendFixturePermissions(c.options,[pkg],[origin,path.join(origin,'.git')]);c.options=c.options.map(v=>v==='features.multi_agent=false'?'features.multi_agent=true':v);
const startedAt=new Date().toISOString();
const prompt=`Synthetic complex Goal evaluation. Read packaged ASC skill ${skill} and use CLI ${cli}. Goal: implement BOTH complete services from ${worktree}/complex/REQUIREMENTS.md, using real SQLite, then integrate and independently review the combined result. Evaluation-only Git authority supersedes the fixture's final no-commit sentence: you may create local worktrees/branches, commit and integrate in this synthetic repo ${origin}; no remote operations or publication. Integration worktree ${worktree}, branch ${branch}, base ${base} (also develop). Issue 9001 is reservation; Issue 9002 is billing; integration Goal 9000. They may be implemented concurrently in separate worktrees. YOU decide the plan, delegate appropriate independent work, integrate and repair findings; no driver planning or cherry-picking will follow. Only complex/reservation/service.mjs and complex/billing/service.mjs may change in the final candidate. Do not edit REQUIREMENTS, REVISION, oracles, CI, greeting, Git config, or any other tracked file. This phase implements the original requirements only; REVISION.md is not yet authorized. Oracles are node complex/oracle/{reservation,billing,integration,unknown-keys}.mjs <candidate-complex-root>. Run all four on the final integration worktree; use original fixed oracles, not mocks. Use fork_turns="none" for worker contexts as well, passing their bounded requirements and paths explicitly instead of copying the whole parent conversation. Worker commits must preserve their assigned Issue boundary. Use ${process.execPath} for Node with SQLite, no installation needed. After combined tests, commit all intended changes, use a fresh same-model independent reviewer with task name independent_review and fork_turns="none" (do not inherit parent conversation); provide original requirements, original base and exact final HEAD. Reviewer returns plain first line PASS <full HEAD> or FAIL <full HEAD> plus concrete findings. Repair valid findings and re-review changed commits. No fixed Agent count; avoid unnecessary planners or duplicated investigations. Final report gives final HEAD, actual test results, worker IDs/commits, reviewer ID/verdict and any unresolved risks. No PR or CI claims before Host delivery. Preserve work on failure; never reset away uncommitted progress.`;
fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify({root,origin,worktree,base,remoteBase,branch,repository,cli,skill,startedAt,accessorOracle,model:'gpt-5.6-sol',effort:'medium',scope:'complex native Goal; seed fixture preparation excluded; no publication by Agent'},null,2));
fs.writeFileSync(path.join(root,'git-controls.json'),JSON.stringify(gitControlState(origin,[worktree])));
const out=fs.openSync(path.join(root,'events.jsonl'),'w'),err=fs.openSync(path.join(root,'stderr'),'w'),started=performance.now();
const p=spawn(c.binary,['exec','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json','-m','gpt-5.6-sol','-c','model_reasoning_effort="medium"','-C',worktree,...c.options,'-'],{env:c.env,stdio:['pipe',out,err]});p.stdin.end(prompt+(accessorOracle?' Also run the fixed additional quality oracle: node complex/oracle/accessors.mjs complex. Do not modify it.':''));
p.on('close',(status,signal)=>{if(status!==0||signal)process.exitCode=status||1;fs.closeSync(out);fs.closeSync(err);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({status,signal,seconds:(performance.now()-started)/1000}));console.log(root);if(mode==='--deliver'&&status===0){const delivery=spawn(process.execPath,[fileURLToPath(new URL('./finish-native-complex.mjs',import.meta.url)),root,'--deliver'],{stdio:'inherit'});delivery.on('close',code=>{process.exitCode=code??1;});}});console.log(JSON.stringify({root,pid:p.pid}));
