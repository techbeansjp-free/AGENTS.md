import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { artifactDigestOf } from '../../src/lib/digest.js';

// `adr finalize <issue_id> <adr_id>`（src/commands/adr.ts）の結合テスト。
// design gateで承認された ADR の `status: proposed` を `status: accepted` へ書き換え、
// commit（可能ならpush）する一連のフローと、承認前提が崩れている場合の異常系を検証する。

/** src/lib/digest.ts の artifactDigestOf と同一アルゴリズム（ドメイン分離済みsha256:<hex>）で
 * 実在成果物の内容digestを自前計算する（Issue #309）。 */
function sha256(content: Buffer): string {
  return artifactDigestOf(content);
}

/** .agent-skill-chain/templates/adr/ADR.md の構造に沿った最小限のADR本文。コメント無しの
 * 単純な `status: <value>` 行にし、adr.ts の `/^status:\s*proposed\s*$/m` 判定と噛み合わせる。 */
function adrContent(status: string): string {
  return [
    '# ADR',
    '',
    '```yaml',
    'id: ADR-0001',
    `status: ${status}`,
    'title: サンプル決定',
    'tags: []',
    'supersedes: []',
    'superseded-by: null',
    'deprecated-reason: null',
    '```',
    '',
    '## Context',
    '',
    'サンプルの背景・制約。',
    '',
    '## Decision',
    '',
    'サンプルの決定内容。',
    '',
    '## Consequences',
    '',
    'サンプルの影響。',
    '',
  ].join('\n');
}

interface GateReport {
  gate: {
    conformance: string;
    falsification: string;
    final: string;
    approved_artifacts: { path: string; digest: string }[];
  };
}

/** issue start して worktree に docs/adr/ADR-0001-sample.md を配置するところまでの共通準備。 */
function setupIssueWithAdr(status: string) {
  const repo = createTmpRepo({ backend: 'local' });
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  const adrDir = path.join(worktreePath, 'docs', 'adr');
  fs.mkdirSync(adrDir, { recursive: true });
  const adrPath = path.join(adrDir, 'ADR-0001-sample.md');
  fs.writeFileSync(adrPath, adrContent(status), 'utf8');

  return { repo, worktreePath, adrPath, adrRelPath: 'docs/adr/ADR-0001-sample.md' };
}

/** design gate の review scaffold を取得し、approved_artifacts に adrPath の実digestを詰めて
 * conformance/falsification/finalをpass/pass/approvedへ書き換えたうえでpublishする。 */
function approveDesignGateFor(repo: ReturnType<typeof createTmpRepo>, worktreePath: string, adrPath: string, adrRelPath: string) {
  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'design', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const reportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(reportPathMatch, 'gate review は gate_report_path を出力すること');
  const reportPath = reportPathMatch![1];

  const report = parse(fs.readFileSync(reportPath, 'utf8')) as GateReport;
  report.gate.approved_artifacts.push({ path: adrRelPath, digest: sha256(fs.readFileSync(adrPath)) });
  report.gate.conformance = 'pass';
  report.gate.falsification = 'pass';
  report.gate.final = 'approved';
  fs.writeFileSync(reportPath, stringify(report), 'utf8');

  const gatePublish = runCli(['gate', 'publish', 'ISSUE-1', reportPath], { cwd: repo.dir });
  assert.equal(gatePublish.status, 0, gatePublish.stderr);
}

test('adr finalize (local backend): design gate承認済みのADRをaccepted化しcommitする', async (t) => {
  const { repo, worktreePath, adrPath, adrRelPath } = setupIssueWithAdr('proposed');
  t.after(() => repo.cleanup());

  // Given: design segment のwriter leaseを取得し、ADRのcontent digestをdesign gateで承認済みにする。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  assert.doesNotMatch(acquire.stdout + acquire.stderr, /token:/);

  approveDesignGateFor(repo, worktreePath, adrPath, adrRelPath);

  const release = runCli(['lease', 'release', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(release.status, 0, release.stderr);

  // When: adr finalize を実行する。
  const finalize = runCli(['adr', 'finalize', 'ISSUE-1', 'ADR-0001'], { cwd: repo.dir });

  // Then: 成功し、commit SHAが出力され、ADR本文のstatusがacceptedへ書き換わっていること。
  assert.equal(finalize.status, 0, finalize.stderr);
  assert.match(finalize.stdout.trim(), /^[0-9a-f]{40}$/);
  const updated = fs.readFileSync(adrPath, 'utf8');
  assert.match(updated, /^status:\s*accepted\s*$/m);
  assert.doesNotMatch(updated, /^status:\s*proposed\s*$/m);
});

test('adr finalize (異常系): design gateをpublishする前に呼ぶと失敗する', async (t) => {
  const { repo } = setupIssueWithAdr('proposed');
  t.after(() => repo.cleanup());

  // Given: design gate の review/publish を一切行っていない状態。
  // When: adr finalize をいきなり呼ぶ。
  const finalize = runCli(['adr', 'finalize', 'ISSUE-1', 'ADR-0001'], { cwd: repo.dir });

  // Then: design gate の gate-report が見つからず失敗すること。
  assert.equal(finalize.status, 1);
  assert.match(finalize.stderr, /design gate/);
});

test('adr finalize (異常系): 承認後にADR本文を書き換えdigestを不一致にすると失敗する', async (t) => {
  const { repo, worktreePath, adrPath, adrRelPath } = setupIssueWithAdr('proposed');
  t.after(() => repo.cleanup());

  // Given: design gateでADRのcontent digestを承認済みにする。
  approveDesignGateFor(repo, worktreePath, adrPath, adrRelPath);

  // When: 承認後にADR本文を書き換え（＝承認時点のdigestと不一致な状態にし）てから finalize を呼ぶ。
  fs.appendFileSync(adrPath, '\n<!-- 承認後の無断書き換え -->\n', 'utf8');
  const finalize = runCli(['adr', 'finalize', 'ISSUE-1', 'ADR-0001'], { cwd: repo.dir });

  // Then: content digest不一致で失敗し、ADR本文はaccepted化されないこと。
  assert.equal(finalize.status, 1);
  assert.match(finalize.stderr, /content digest/);
  assert.doesNotMatch(fs.readFileSync(adrPath, 'utf8'), /^status:\s*accepted\s*$/m);
});

test('adr finalize (異常系): 既にaccepted状態のADRへfinalizeすると失敗する', async (t) => {
  // Given: 何らかの理由で既に status: accepted な状態のADR（＝再finalize対象）に対し、
  // design gateがその内容のdigestをそのまま承認済みである状態を作る。
  const { repo, worktreePath, adrPath, adrRelPath } = setupIssueWithAdr('accepted');
  t.after(() => repo.cleanup());

  approveDesignGateFor(repo, worktreePath, adrPath, adrRelPath);

  // When: このADRに対して adr finalize を呼ぶ。
  const finalize = runCli(['adr', 'finalize', 'ISSUE-1', 'ADR-0001'], { cwd: repo.dir });

  // Then: status: proposed ではないため失敗すること。
  assert.equal(finalize.status, 1);
  assert.match(finalize.stderr, /status: proposed ではありません/);
});
