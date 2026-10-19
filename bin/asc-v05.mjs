#!/usr/bin/env node
import {startWorktree,verifyWorktree} from '../src/worktree-execution.mjs';
import {projectAssets} from '../src/project-assets.mjs';
import {restartGoal} from '../src/goal-restart.mjs';
import {runIssues} from '../src/issue-run.mjs';
/** Linux distribution candidate. Unsupported operations stop; never invoke v0.4 implicitly. */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {executionHost} from '../src/execution-host.mjs';
import {probeNativeSandbox} from '../src/native-probe.mjs';
import {inspectMigration} from '../migration_inspect.mjs';
import {runAdaptive} from '../src/adaptive-run.mjs';
import {proposeGoal} from '../src/goal-propose.mjs';
import {runGoal} from '../src/goal-run.mjs';
import {compileGoal} from '../src/goal-plan.mjs';
import {runWorkflow} from '../src/workflow.mjs';
import {prepareMigration,rollbackMigration,stageMigration,assertWorkLocation,createWorktree} from '../src/migration.mjs';
import {Controller} from '../src/controller.mjs';
import {inspectAssets} from '../src/verification-assets.mjs';
import path from 'node:path';
import {verifyApproval} from '../src/approval.mjs';
try {
  const [command,...rawArgs]=process.argv.slice(2);
  const snapshotCommands=['run','review','run-adaptive','run-goal','run-issues','restart-goal','goal-propose'];
  const args=[...rawArgs];
  if(snapshotCommands.includes(command)){
    if(args[0]!=='--snapshot')throw Error('Snapshot execution requires explicit --snapshot selection. Standard: start <project-directory>, then use the current AI Host and existing project tools.');
    args.shift();
  }
  const nativeHelp={
    start:'start <project-directory> [--path <changed-path>]... [--coordination]\n作業場所・規約参照を確認します（非Gitも可、Agent起動なし）。',
    'worktree-create':'worktree-create <root> <issue> <type> <slug> <base>\n専用worktreeを作成します。type: feature|fix|refactor|test|docs|chore。baseは明示指定し、既存branch・作業場所は上書きしません。',
    'worktree-verify':'worktree-verify <worktree> <base> <owner-contract.json>\n現在のHost権限で検証します。repo外のowner契約にintent・allowedPaths・commands（argv配列の配列）を指定します。検証失敗はexit 2。',
    'project-assets':'project-assets <project-directory> [--register-skill] [--apply]\n既定は差分表示のみ。--applyで未編集の配布資産を更新し、利用者の変更との競合は保護します。'
  };
  if(Object.hasOwn(nativeHelp,command)&&args.length===1&&['--help','-h'].includes(args[0])){
    console.log(`使い方: asc-v05 ${nativeHelp[command]}\n詳細: ${fileURLToPath(new URL('../v05/USAGE.md',import.meta.url))}`);
  } else if((command===undefined||command==='--help'||command==='-h')&&args.length===0){
    console.log(`ASC v0.5 — Goal・契約・Evidenceに基づく開発ハーネス

使い方: agent-skill-chain <command> [arguments]

標準（利用中のAI・既存の開発環境）:
  start <project-directory> [--path <changed-path>]... [--coordination] 作業場所と必要な責務を確認（非Gitも可・Agent起動なし）
  worktree-verify <worktree> <base> <owner-contract.json>
      現在のHost権限で既存ビルド・テストを実行し対象commitへ対応付け

  worktree-create <root> <issue> <type> <slug> <base>
      専用worktreeを作成（既存branch・作業場所は上書きしない）
明示選択のsnapshot実行:
  run --snapshot <external-owner-request.json>
      範囲が明確な変更を実装・検証・独立レビューし、Draft PR/CIへ進める
  run-adaptive --snapshot <external-owner-request.json>
      許可されたGoalを必要なWork Unitへ分解して実行
  run-issues --snapshot <external-owner-issue-request.json>
      ownerが列挙した複数Issueを依存関係に従って実行

確認・再開:
  review --snapshot <external-owner-request.json>       現在の変更を独立レビュー
  goal-propose --snapshot <external-owner-request.json> Goal分解を提案
  restart-goal --snapshot <external-owner-request.json> 明示した再開条件・予算で再開
  probe-native <absolute-codex-executable>  モデル呼出しなしのネイティブ隔離診断
  capabilities                             対応コマンドとHost情報をJSON表示
  --version                                配布版を表示

導入・更新:
  project-assets <project-directory> [--register-skill] [--apply]       配布資産の差分表示／未編集資産だけ更新

移行:
  migration-inspect <root>                  旧設定と移行境界を確認
  migration-prepare <source> <new-location>  元repoを保持して移行先を準備
  migration-stage <source> <new-location> <external-owner-plan>
  migration-rollback <location>  評価の選択記録のみを戻す（再導入・設定復元はしない）

snapshot実行やworktree-verifyのowner入力ファイルは作業repoの外に置きます。Git管理済みrepoの通常実行は専用worktreeを使用します。
必要環境・入力例・承認・検証資産の準備: ${fileURLToPath(new URL('../v05/USAGE.md',import.meta.url))}
v0.5の実行入口です。使用版は--versionで確認してください。明示Host経路はOS名で拒否しません。標準経路は現在のHost権限を使います。snapshot経路は実行時の隔離検査が必須です。公開・merge・releaseの承認は別途必要です。`);
  } else if(command==='start'&&args.length>=1){
    const paths=[];let coordination=false;
    for(let i=1;i<args.length;i++){
      if(args[i]==='--coordination'&&!coordination){coordination=true;continue;}
      if(args[i]!=='--path'||!args[i+1])throw Error('Expected --path <changed-path> or one --coordination');
      paths.push(args[++i]);
    }
    console.log(JSON.stringify(startWorktree(args[0],paths,{coordination}),null,2));
  } else if(command==='worktree-verify'&&args.length===3){
    const result=verifyWorktree(...args);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=2;
  } else if(command==='probe-native'&&args.length===1){
    const result=await probeNativeSandbox(args[0]);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=2;
  } else if(command==='project-assets'&&args.length>=1&&args.length<=3&&args.slice(1).every(a=>['--apply','--register-skill'].includes(a))&&new Set(args.slice(1)).size===args.length-1){
    const result=projectAssets(args[0],{apply:args.includes('--apply'),registerSkill:args.includes('--register-skill')});console.log(JSON.stringify(result,null,2));if(result.conflicts.length)process.exitCode=2;
  } else if(command==='--version'&&args.length===0){
    const manifest=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
    if(typeof manifest.version!=='string'||!/^0\.5\.\d+(?:-[a-z0-9.-]+)?$/.test(manifest.version))throw Error('Invalid installed package version');
    console.log(manifest.version);
  } else if(command==='worktree-create'&&args.length===5){
    console.log(JSON.stringify(createWorktree(args[0],{issue:Number(args[1]),type:args[2],slug:args[3],base:args[4]}),null,2));
  } else if(command==='goal-plan' && args.length===1){
    console.log(JSON.stringify(compileGoal(JSON.parse(fs.readFileSync(args[0]))),null,2));
  } else if(command==='assets-inspect' && args.length===1){
    console.log(JSON.stringify(inspectAssets(args[0]),null,2));
  } else if (command==='migration-inspect' && args.length===1) {
    console.log(JSON.stringify(inspectMigration(args[0]),null,2));
  } else if (command==='migration-prepare' && args.length===2) {
    console.log(JSON.stringify(prepareMigration(args[0],args[1]),null,2));
  } else if (command==='migration-stage' && args.length===3) {
    const owner=fs.realpathSync(args[2]),source=fs.realpathSync(args[0]),relative=path.relative(source,owner);
    if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Cutover plan must be outside legacy repository');
    const st=fs.lstatSync(args[2]);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>5000000)throw Error('Unsafe cutover plan');
    const fd=fs.openSync(args[2],fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
    let plan;try{const checked=fs.fstatSync(fd);if(!checked.isFile()||checked.nlink!==1||checked.size>5000000)throw Error('Changed cutover plan');plan=JSON.parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
    console.log(JSON.stringify(stageMigration(source,args[1],plan),null,2));
  } else if (command==='migration-rollback' && args.length===1) {
    console.log(JSON.stringify(rollbackMigration(args[0]),null,2));
  } else if (command==='approval-verify' && args.length===0) {
    const input=fs.readFileSync(0);
    if (input.length>65536) throw Error('Approval input limit exceeded');
    const data=JSON.parse(input);
    console.log(JSON.stringify(verifyApproval(data.envelope,data.binding,data.trustedKeys)));
  } else if (command==='plan' && args.length===3) {
    const root=fs.realpathSync(args[0]), ownerFile=fs.realpathSync(args[2]);
    const relative=path.relative(root,ownerFile);
    if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) throw Error('Owner contract must be outside candidate repository');
    const contract=JSON.parse(fs.readFileSync(ownerFile));
    const controller=new Controller({repo:root,base:args[1],contract,implementer:'not-yet-dispatched'});
    console.log(JSON.stringify(controller.nextWork(contract.intent),null,2));
  } else if(command==='run-issues'&&args.length===1){
    const st=fs.lstatSync(args[0]);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>1000000)throw Error('Unsafe owner Issue request');
    const fd=fs.openSync(args[0],fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
    let request;try{const st=fs.fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.size>1000000)throw Error('Changed owner Issue request');request=JSON.parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
    const owner=fs.realpathSync.native(args[0]);
    for(const issue of request.issues??[]){
      if(typeof issue.request?.repo!=='string'||!path.isAbsolute(issue.request.repo))throw Error('Absolute Issue repository required');
      let repo=path.resolve(issue.request.repo);try{repo=fs.realpathSync.native(repo);}catch{ /* Keep the lexical path; repository validation rejects invalid targets. */ }
      const rel=path.relative(repo,owner);if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Owner Issue request must be outside every candidate');
    }
    const result=await runIssues(request,{onEvent:e=>process.stderr.write(JSON.stringify(e)+'\n')});console.log(JSON.stringify(result,null,2));if(result.status!=='draft-ci-passed')process.exitCode=2;
  } else if ((command==='review'||command==='run'||command==='run-goal'||command==='goal-propose'||command==='run-adaptive'||command==='restart-goal') && args.length===1) {
    const stat=fs.lstatSync(args[0]);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>65536) throw Error('Unsafe owner request file');
    const fd=fs.openSync(args[0],fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
    let request;try {const st=fs.fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.size>65536)throw Error('Changed owner request');request=JSON.parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
    if(typeof request.repo!=='string'||!path.isAbsolute(request.repo))throw Error('Absolute owner repository required');
    const repo=fs.realpathSync(request.repo),owner=fs.realpathSync(args[0]);
    const relative=path.relative(repo,owner);
    if(!relative || (!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Owner request must be outside candidate repository');
    assertWorkLocation(repo,request.workspaceMode);
    const result=await (command==='restart-goal'?restartGoal:command==='run-adaptive'?runAdaptive:command==='goal-propose'?proposeGoal:command==='run-goal'?runGoal:runWorkflow)(request,{onEvent:e=>process.stderr.write(JSON.stringify(e)+'\n'),...(command==='review'?{reviewOnly:true,provider:{intent:()=>request.contract.intent}}:{})});
    console.log(JSON.stringify(result,null,2));
    if(!(command==='review'?result.status==='reviewed-candidate':['draft-ci-passed','proposed'].includes(result.status)))process.exitCode=2;
  } else if (command==='capabilities'   && args.length===0) {
    console.log(JSON.stringify({schema:'asc-v05-capabilities/v1',releaseReady:true,releaseTarget:'native-linux',publishAuthorized:false,
      defaultExecution:'current-host-worktree',snapshotRequiresExplicitSelection:true,commands:['start','worktree-verify','probe-native','project-assets','worktree-create','assets-inspect','migration-inspect','migration-prepare','migration-stage','migration-rollback','approval-verify','plan','goal-plan','goal-propose','restart-goal','run-adaptive','run','review','run-goal','run-issues','capabilities'],
      execution:'current-host-worktree',executionBackends:['current-host-worktree','current-host-directory','owner-selected-host','linux-runner'],host:executionHost(),legacyFallback:false}));
  } else {
    throw Error('Usage: asc-v05 --version | start <project-directory> | worktree-verify <worktree> <base> <owner-contract.json> | worktree-create <root> <issue> <type> <slug> <base> | assets-inspect <owner-assets> | migration-inspect <root> | migration-prepare <source> <new-location> | migration-stage <source> <new-location> <external-owner-plan> | migration-rollback <location> | approval-verify < trusted-input.json | plan <root> <base> <external-owner-contract> | run --snapshot <external-owner-request.json> | review --snapshot <external-owner-request.json> | restart-goal --snapshot <external-owner-request.json> | run-adaptive --snapshot <external-owner-request.json> | goal-propose --snapshot <external-owner-request.json> | goal-plan <owner-plan.json> | run-goal --snapshot <external-owner-request.json> | run-issues --snapshot <external-owner-issue-request.json> | capabilities');
  }
} catch (e) {
  // Preserve existing controller observations without turning a failed run into success.
  const diagnostic=e.goalDiagnostic??e.workflowDiagnostic;
  if(diagnostic)console.log(JSON.stringify(diagnostic,null,2));
  console.error(e.message);process.exitCode=1;
}
