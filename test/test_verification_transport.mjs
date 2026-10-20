import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {worktreeFixture as fixture} from './helpers/worktree-fixture.mjs';
import {verificationCaptureSource,capturedVerification} from '../scripts/claude-verification-capture.mjs';
import {claudeVerificationEvidence} from '../scripts/claude-verification-evidence.mjs';
test('real CLI transfers saved results across repeated verification without full transcript or overwrites',t=>{
 const f=fixture(t),wrapper=path.join(f.root,'capture.mjs');
 const capture={command:`node ${wrapper}`,marker:'4'.repeat(32),output:path.join(f.root,'result')};
 fs.writeFileSync(wrapper,verificationCaptureSource({cli:path.resolve('bin/asc-v05.mjs'),repo:f.work,base:f.base,owner:f.owner,...capture}));
 const observe=()=>{
  const p=spawnSync(process.execPath,[wrapper],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
  const summary=JSON.parse(capturedVerification(p.stdout,capture.marker)),expected=JSON.parse(fs.readFileSync(summary.output));
  const events=[{message:{content:[{type:'tool_use',id:'verify',name:'Bash',input:{command:capture.command}}]}},{message:{content:[{type:'tool_result',tool_use_id:'verify',content:p.stdout}]}}];
  assert.equal(claudeVerificationEvidence(events,expected,capture).head,expected.head);
  assert(!p.stdout.includes('stdoutSha256'));return {summary,expected,events};
 };
 const first=observe(),original=fs.readFileSync(first.summary.output),second=observe();
 assert.notEqual(first.summary.output,second.summary.output);assert.deepEqual(fs.readFileSync(first.summary.output),original);
 fs.appendFileSync(second.summary.output,'tampered');assert.throws(()=>claudeVerificationEvidence(second.events,second.expected,capture),/Missing successful/);
 assert.throws(()=>claudeVerificationEvidence(first.events,{...first.expected,head:'0'.repeat(40)},capture),/Missing successful/);
});

test('inline transport uses existing CLI contract and still rejects failed verification',t=>{
 const f=fixture(t),wrapper=path.join(f.root,'inline.mjs'),capture={command:`node ${wrapper}`,marker:'5'.repeat(32)};
 fs.writeFileSync(wrapper,verificationCaptureSource({cli:path.resolve('bin/asc-v05.mjs'),repo:f.work,base:f.base,owner:f.owner,...capture}));
 const run=()=>spawnSync(process.execPath,[wrapper],{encoding:'utf8'});
 const first=run(),expected=JSON.parse(capturedVerification(first.stdout,capture.marker));
 assert.equal(expected.schema,'asc-worktree-verification/v1');assert.equal(expected.passed,true);
 const events=content=>[{message:{content:[{type:'tool_use',id:'v',name:'Bash',input:{command:capture.command}}]}},{message:{content:[{type:'tool_result',tool_use_id:'v',content}]}}];
 assert.equal(claudeVerificationEvidence(events(first.stdout),expected,capture).head,expected.head);
 f.contract.commands=[[process.execPath,'-e','process.exit(7)']];f.save();
 const failed=run();assert.equal(capturedVerification(failed.stdout,capture.marker),null);
 assert.throws(()=>claudeVerificationEvidence(events(failed.stdout),expected,capture),/Missing successful/);
});
test('unknown verification transport is rejected before trial or model startup',()=>{
 const p=spawnSync(process.execPath,['scripts/run-claude-delivery.mjs','/unused-package','/unused-claude','/unused-fixture','--deliver'],{encoding:'utf8',env:{...process.env,ASC_EVAL_MODEL:'opus',ASC_EVAL_EFFORT:'medium',ASC_EVAL_VERIFICATION_TRANSPORT:'unknown'}});
 assert.equal(p.status,1);assert.match(p.stderr,/Expected explicit saved or inline verification transport/);
});
