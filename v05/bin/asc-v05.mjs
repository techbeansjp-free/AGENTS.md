#!/usr/bin/env node
import {restartGoal} from '../src/goal-restart.mjs';
import {runIssues} from '../src/issue-run.mjs';
/** Evaluation distribution. Unsupported operations stop; never invoke v0.4 implicitly. */
import fs from 'node:fs';
import {executionHost} from '../src/execution-host.mjs';
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
  const [command,...args]=process.argv.slice(2);
  if(command==='worktree-create'&&args.length===5){
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
    console.log(JSON.stringify({schema:'asc-v05-capabilities/v1',releaseReady:false,
      commands:['worktree-create','assets-inspect','migration-inspect','migration-prepare','migration-stage','migration-rollback','approval-verify','plan','goal-plan','goal-propose','restart-goal','run-adaptive','run','review','run-goal','run-issues','capabilities'],
      execution:'linux-evaluation-runner',host:executionHost(),legacyFallback:false}));
  } else {
    throw Error('Usage: asc-v05 worktree-create <root> <issue> <type> <slug> <base> | assets-inspect <owner-assets> | migration-inspect <root> | migration-prepare <source> <new-location> | migration-stage <source> <new-location> <external-owner-plan> | migration-rollback <location> | approval-verify < trusted-input.json | plan <root> <base> <external-owner-contract> | run <external-owner-request.json> | review <external-owner-request.json> | restart-goal <external-owner-request.json> | run-adaptive <external-owner-request.json> | goal-propose <external-owner-request.json> | goal-plan <owner-plan.json> | run-goal <external-owner-request.json> | run-issues <external-owner-issue-request.json> | capabilities');
  }
} catch (e) {
  // Preserve existing controller observations without turning a failed run into success.
  const diagnostic=e.goalDiagnostic??e.workflowDiagnostic;
  if(diagnostic)console.log(JSON.stringify(diagnostic,null,2));
  console.error(e.message);process.exitCode=1;
}
