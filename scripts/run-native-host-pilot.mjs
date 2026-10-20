import {nativeModelConditions} from './native-model-conditions.mjs';
const {model,effort}=nativeModelConditions();
import {gitControlState,assertGitControlState} from './native-git-boundary.mjs';
/** Synthetic current-Host pilot. Real worktree, no network, no publication, no driver implementation edits. */
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {configuration} from '../src/restricted-agent.mjs';
import {extendFixturePermissions} from './complex-permissions.mjs';
const [tarball, codex] = process.argv.slice(2);
if (!tarball || !codex || !path.isAbsolute(tarball) || !path.isAbsolute(codex)) throw Error('Usage: node scripts/run-native-host-pilot.mjs <absolute-tarball> <absolute-codex>');
const root=fs.mkdtempSync('/var/tmp/asc-native-small-'),origin=path.join(root,'origin'),runtime=path.join(root,'runtime'),bootstrap=path.join(root,'bootstrap'),pkg=path.join(root,'distribution');
for(const p of [origin,runtime,bootstrap,pkg])fs.mkdirSync(p);
execFileSync('tar',['-xzf',tarball,'-C',pkg]);
const env={...process.env};for(const k of Object.keys(env))if(/^git_/i.test(k))delete env[k];
const git=(...a)=>execFileSync('git',a,{cwd:origin,env,encoding:'utf8'}).trim();git('init','-b','main');git('config','user.name','Synthetic Tester');git('config','user.email','test@example.invalid');
fs.writeFileSync(path.join(origin,'greeting.mjs'),"export const greeting = name => `Helo, ${name}!`;\n");
fs.writeFileSync(path.join(origin,'test.mjs'),"import assert from 'node:assert/strict';import {greeting} from './greeting.mjs';assert.equal(greeting('Ada'),'Hello, Ada!');\n");
fs.writeFileSync(path.join(origin,'AGENTS.md'),'Synthetic project. Edit only greeting.mjs. Test with node test.mjs. Do not edit tests or project rules.\n');
git('add','.');git('commit','-m','Synthetic baseline');const base=git('rev-parse','HEAD');
const now=new Date(),pad=n=>String(n).padStart(2,'0');
const stamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const worktree=path.join(origin,'.worktrees',stamp+'-1-greeting');git('worktree','add','-b','fix/1-greeting',worktree,base);
const cli=path.join(pkg,'package','bin','asc-v05.mjs'),skill=path.join(pkg,'package','skills','asc','SKILL.md');
const c=configuration({workspace:bootstrap,runtime,executable:fs.realpathSync(codex),writable:true});
extendFixturePermissions(c.options,[pkg],[origin,path.join(origin,'.git')]);c.options=c.options.map(v=>v==='features.multi_agent=false'?'features.multi_agent=true':v);
const prompt=`Synthetic local pilot, no network or publication. Use packaged ASC skill at ${skill} and CLI ${cli}. Your authorized repo is ${worktree}, branch fix/1-greeting, base ${base}, Issue 1. Goal: correct the greeting typo so greeting('Ada') yields 'Hello, Ada!'; preserve other behavior. Allowed changes: greeting.mjs only. Existing test command: node test.mjs. Perform implementation, actual tests, independent fresh-context review using the same model, any necessary correction and local commit. You may use Git only in this synthetic repo; no pushes. Do not modify tests, rules, or distribution. Decide the necessary work yourself, avoid extra planning agents. Report exact final commit, test result and reviewer id/verdict; do not claim PR/CI success. All questions needed for this fixture are resolved above.`;
fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify({root,origin,worktree,base,cli,skill,model,effort,cliVersion:execFileSync(codex,['--version'],{encoding:'utf8'}).trim(),scope:'local pilot; no PR/CI'},null,2));
const controls=gitControlState(origin,[worktree]);
fs.writeFileSync(path.join(root,'git-controls.json'),JSON.stringify(controls));
const out=fs.openSync(path.join(root,'events.jsonl'),'w'),err=fs.openSync(path.join(root,'stderr'),'w'),started=performance.now();
const p=spawn(c.binary,['exec','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json','-m',model,'-c',`model_reasoning_effort=${JSON.stringify(effort)}`,'-C',worktree,...c.options,'-'],{env:c.env,stdio:['pipe',out,err]});p.stdin.end(prompt);
p.on('close',(status,signal)=>{
 fs.closeSync(out);fs.closeSync(err);
 let gitControlsVerified=false,error;
 try{assertGitControlState(origin,controls,[worktree]);gitControlsVerified=true;}catch(e){error=e.message;}
 if(status!==0||!gitControlsVerified)process.exitCode=1;
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({status,signal,gitControlsVerified,...(error?{error}:{}),seconds:(performance.now()-started)/1000}));
 console.log(root);
});console.log(JSON.stringify({root,pid:p.pid}));
