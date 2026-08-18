import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { createTmpRepo, FIXED_TIMESTAMP, type TmpRepo } from '../helpers/tmp-repo.js';
import { stateFilePath } from '../../src/lib/local-state.js';

const UNRESOLVED_NOTICE = /quick シグナルを解決できなかったため、quick 免除も上流セグメントの閉包追加も適用しません/;

function startIssue(repo: TmpRepo, issueNumber = '741', env: NodeJS.ProcessEnv = process.env): string {
  const result = runCli(
    ['issue', 'start', `ISSUE-${issueNumber}`, 'bugfix', 'artifact-target-closure', FIXED_TIMESTAMP],
    { cwd: repo.dir, env },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n')[1];
}

function patchState(repo: TmpRepo, issueNumber: string, patch: Record<string, unknown>): void {
  const file = stateFilePath(repo.dir, issueNumber);
  const state = parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(file, stringify({ ...state, ...patch }));
}

function writeDesignArtifacts(worktree: string): void {
  fs.writeFileSync(path.join(worktree, 'DESIGN.md'), '# DESIGN\n');
  fs.writeFileSync(path.join(worktree, 'PLAN.md'), '# PLAN\n');
  fs.mkdirSync(path.join(worktree, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'docs', 'adr', 'ADR-0001-test.md'), '# ADR\n');
}

function checkpointImplementation(worktree: string): void {
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'test', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'src', 'implementation.ts'), 'export const implemented = true;\n');
  fs.writeFileSync(path.join(worktree, 'test', 'unit', 'implementation.test.ts'), '// unit result\n');
  const result = runCli(['checkpoint', 'test: add implementation artifacts'], { cwd: worktree });
  assert.equal(result.status, 0, result.stderr);
}

function verifyBatch(
  repo: TmpRepo,
  started: string,
  issueNumber = '741',
  env: NodeJS.ProcessEnv = process.env,
) {
  return runCli(['verify', 'artifacts', `ISSUE-${issueNumber}`, '--started-segments', started], {
    cwd: repo.dir,
    env,
  });
}

test('verify artifacts一括: quick未要求ではSの上流spec/designを閉包追加し、全成果物充足なら成功する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const worktree = startIssue(repo);
  fs.writeFileSync(path.join(worktree, 'SPEC.md'), '# SPEC\n');
  writeDesignArtifacts(worktree);
  checkpointImplementation(worktree);

  const result = verifyBatch(repo, 'implementation');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /spec（上流閉包により追加・セグメント未開始）/);
  assert.match(result.stderr, /design（上流閉包により追加・セグメント未開始）/);
  assert.match(result.stderr, /implementation（開始済み）/);
});

test('verify artifacts一括: 閉包追加分・開始済み分・双方の欠落をセグメント名と成果物名の対で列挙する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  startIssue(repo);

  const result = verifyBatch(repo, 'spec,implementation');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /segment 'spec'.*SPEC\.md/);
  assert.match(result.stderr, /segment 'design'（上流閉包により追加・セグメント未開始）.*DESIGN\.md/);
  assert.match(result.stderr, /segment 'implementation'.*code/);
});

test('verify artifacts一括: ISSUE-692再現条件ではquick解除理由と未開始design成果物の欠落を同時に示す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const worktree = startIssue(repo, '692');
  patchState(repo, '692', { size: 'quick', risk: 'normal' });
  checkpointImplementation(worktree);
  fs.writeFileSync(path.join(worktree, 'VALIDATION.md'), '# VALIDATION\n');
  fs.appendFileSync(path.join(worktree, '.agent-skill-chain', 'schemas', 'state.schema.yaml'), '\n# guardrail\n');

  const result = verifyBatch(repo, 'implementation,validation', '692');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /quick 適用対象外/);
  assert.match(result.stderr, /schemas\/ 配下/);
  assert.match(result.stderr, /segment 'design'（上流閉包により追加・セグメント未開始）.*DESIGN\.md/);
  assert.match(result.stderr, /segment 'design'（上流閉包により追加・セグメント未開始）.*PLAN\.md/);
});

test('verify artifacts一括: quick免除有効時は閉包追加を抑止するが開始済み分の欠落は検査する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const worktree = startIssue(repo);
  patchState(repo, '741', { size: 'quick', risk: 'normal' });
  checkpointImplementation(worktree);

  const fulfilled = verifyBatch(repo, 'implementation');
  assert.equal(fulfilled.status, 0, fulfilled.stderr);
  assert.doesNotMatch(fulfilled.stderr, /上流閉包により追加/);
  assert.doesNotMatch(fulfilled.stderr, /SPEC\.md|DESIGN\.md|PLAN\.md/);

  fs.rmSync(path.join(worktree, 'test', 'unit', 'implementation.test.ts'));
  execFileSync('git', ['add', '-A'], { cwd: worktree });
  execFileSync('git', ['commit', '-m', 'test: remove unit result'], { cwd: worktree, stdio: 'pipe' });
  const missing = verifyBatch(repo, 'implementation');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /segment 'implementation'.*unit_test_results/);
});

test('verify artifacts一括: quick未解決のローカル3経路ではR=Sへ劣化し、成果物検査を続行する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const worktree = startIssue(repo);
  checkpointImplementation(worktree);
  const statePath = stateFilePath(repo.dir, '741');
  const original = fs.readFileSync(statePath, 'utf8');

  fs.rmSync(statePath);
  const absent = verifyBatch(repo, 'implementation');
  assert.equal(absent.status, 0, absent.stderr);
  assert.match(absent.stderr, UNRESOLVED_NOTICE);
  assert.doesNotMatch(absent.stderr, /上流閉包により追加/);

  fs.writeFileSync(statePath, 'invalid: [\n');
  const invalid = verifyBatch(repo, 'implementation');
  assert.equal(invalid.status, 0, invalid.stderr);
  assert.match(invalid.stderr, UNRESOLVED_NOTICE);

  fs.writeFileSync(statePath, 'size: unsupported\nrisk: normal\n');
  const invalidStructure = verifyBatch(repo, 'implementation');
  assert.equal(invalidStructure.status, 0, invalidStructure.stderr);
  assert.match(invalidStructure.stderr, UNRESOLVED_NOTICE);

  fs.rmSync(statePath);
  fs.mkdirSync(statePath);
  const unreadable = verifyBatch(repo, 'implementation');
  assert.equal(unreadable.status, 0, unreadable.stderr);
  assert.match(unreadable.stderr, UNRESOLVED_NOTICE);

  fs.rmSync(statePath, { recursive: true });
  fs.writeFileSync(statePath, 'invalid: [\n');
  fs.rmSync(path.join(worktree, 'test', 'unit', 'implementation.test.ts'));
  execFileSync('git', ['add', '-A'], { cwd: worktree });
  execFileSync('git', ['commit', '-m', 'test: remove unit result under unresolved signal'], {
    cwd: worktree,
    stdio: 'pipe',
  });
  const missing = verifyBatch(repo, 'implementation');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, UNRESOLVED_NOTICE);
  assert.match(missing.stderr, /segment 'implementation'.*unit_test_results/);
  assert.doesNotMatch(missing.stderr, /segment 'design'/);

  fs.writeFileSync(statePath, original);
});

test('quick判定の捕捉変更後もsegment startは先行するstate読み取り失敗で従来どおり中断する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  startIssue(repo);
  const configPath = path.join(repo.dir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const config = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(configPath, config.replace('before_implementation: true', 'before_implementation: false'));
  const acquired = runCli(['lease', 'acquire', 'ISSUE-741', 'implementation'], { cwd: repo.dir });
  assert.equal(acquired.status, 0, acquired.stderr);
  fs.writeFileSync(stateFilePath(repo.dir, '741'), 'invalid: [\n');

  const result = runCli(['segment', 'start', 'ISSUE-741', 'implementation'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /予期しないエラー/);
  assert.doesNotMatch(result.stdout, /^role: implementation_worker/m);
});

test('verify artifacts一括: GitHubの取得失敗・解釈不能は未解決、空ラベル集合は解決済みquick未要求になる', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'issue741-gh-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const stub = createGhStub(scratch);
  const env = stub.env(process.env);
  const worktree = startIssue(repo, '741', env);
  checkpointImplementation(worktree);

  fs.writeFileSync(
    path.join(stub.binDir, 'gh'),
    '#!/usr/bin/env bash\nif [[ "${GH_TEST_STATUS:-0}" != 0 ]]; then exit "$GH_TEST_STATUS"; fi\nprintf "%s" "$GH_TEST_RESPONSE"\n',
    { mode: 0o755 },
  );

  for (const response of ['not-json', '{}']) {
    const unresolved = verifyBatch(repo, 'implementation', '741', { ...env, GH_TEST_RESPONSE: response });
    assert.equal(unresolved.status, 0, unresolved.stderr);
    assert.match(unresolved.stderr, UNRESOLVED_NOTICE);
  }
  const failed = verifyBatch(repo, 'implementation', '741', { ...env, GH_TEST_STATUS: '1', GH_TEST_RESPONSE: '' });
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stderr, UNRESOLVED_NOTICE);

  const emptyLabels = verifyBatch(repo, 'implementation', '741', { ...env, GH_TEST_RESPONSE: '{"labels":[]}' });
  assert.equal(emptyLabels.status, 1);
  assert.doesNotMatch(emptyLabels.stderr, UNRESOLVED_NOTICE);
  assert.match(emptyLabels.stderr, /segment 'design'（上流閉包により追加・セグメント未開始）/);
});

test('verify artifacts一括: S空は外部シグナルを解決せず対象集合空として成功する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  startIssue(repo);
  fs.rmSync(stateFilePath(repo.dir, '741'));

  const result = verifyBatch(repo, '');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /必須成果物検査の対象集合: （空）/);
  assert.doesNotMatch(result.stderr, UNRESOLVED_NOTICE);
});

test('verify artifacts一括: 文書のみの主経路ではimplementationを閉包追加しない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const worktree = startIssue(repo);
  fs.writeFileSync(path.join(worktree, 'SPEC.md'), '# SPEC\n');
  writeDesignArtifacts(worktree);
  fs.writeFileSync(path.join(worktree, 'VALIDATION.md'), '# VALIDATION\n');

  const result = verifyBatch(repo, 'spec,design,validation');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /implementation/);
});

test('verify artifacts一括: 当ブランチで追加後に削除した成果物は履歴実績で充足する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const worktree = startIssue(repo);
  checkpointImplementation(worktree);
  fs.writeFileSync(path.join(worktree, 'SPEC.md'), '# SPEC\n');
  writeDesignArtifacts(worktree);
  const addDocs = runCli(['checkpoint', 'docs: add required artifacts'], { cwd: worktree });
  assert.equal(addDocs.status, 0, addDocs.stderr);
  fs.rmSync(path.join(worktree, 'SPEC.md'));
  const deleteSpec = runCli(['checkpoint', 'docs: remove SPEC after addition'], { cwd: worktree });
  assert.equal(deleteSpec.status, 0, deleteSpec.stderr);

  const result = verifyBatch(repo, 'implementation');
  assert.equal(result.status, 0, result.stderr);
});

test('verify artifacts一括: base側にだけ存在して当ブランチで削除した成果物は欠落になる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# base SPEC\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'docs: add base SPEC'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: repo.dir, stdio: 'pipe' });
  const worktree = startIssue(repo);
  fs.rmSync(path.join(worktree, 'SPEC.md'));
  const removed = runCli(['checkpoint', 'docs: remove base SPEC'], { cwd: worktree });
  assert.equal(removed.status, 0, removed.stderr);

  const result = verifyBatch(repo, 'spec');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /segment 'spec'.*SPEC\.md/);
});
