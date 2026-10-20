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
