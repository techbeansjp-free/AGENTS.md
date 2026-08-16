import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import {
  createTmpRepo,
  FIXED_TIMESTAMP,
  removeHumanConfirmationBeforeImplementation,
  setHumanConfirmationBeforeImplementation,
} from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { reviewFilePath, stateFilePath } from '../../src/lib/local-state.js';

// coordination.backend: local での中核フロー（issue start → lease acquire → segment start →
// gate review/publish → checkpoint → pr create → cleanup）を素通しで検証する。
// bin/agents-md.js（ビルド後の実体）に対してsubprocess実行するため、実際にnpx経由で使われる
// 挙動そのものを確認する。

test('issue lifecycle (local backend): start -> lease -> segment -> gate -> checkpoint -> pr -> cleanup', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');
  assert.equal(branch, 'feature/1-sample-feature');
  assert.ok(fs.existsSync(worktreePath), `worktree が作成されていること: ${worktreePath}`);
  assert.ok(
    fs.existsSync(path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'state.yaml')),
    'ローカルモードでは issues/<n>/.agent-skill-chain/state.yaml が作成されること',
  );

  const resume = runCli(['issue', 'resume', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /segment: spec \(pending\)/);

  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  assert.doesNotMatch(acquire.stdout + acquire.stderr, /token:/, 'lease acquire はtokenをCLIへ出力しないこと');

  const acquireConflict = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquireConflict.status, 1, '有効な既存leaseと競合する再取得は失敗すること');
  assert.match(acquireConflict.stderr, /競合/);

  const segmentStart = runCli(['segment', 'start', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);
  assert.match(segmentStart.stdout, /自己拡張の project rules/);

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch);
  const gateReportPath = gateReportPathMatch![1];
  assert.ok(fs.existsSync(gateReportPath));

  const reportText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved');
  fs.writeFileSync(gateReportPath, reportText);

  const gatePublish = runCli(['gate', 'publish', 'ISSUE-1', gateReportPath], { cwd: repo.dir });
  assert.equal(gatePublish.status, 0, gatePublish.stderr);

  const release = runCli(['lease', 'release', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(release.stdout.trim(), 'ISSUE-1');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md追加'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  assert.match(checkpoint.stdout.trim(), /^[0-9a-f]{40}$/);

  const prCreate = runCli(['pr', 'create', 'ISSUE-1', branch], { cwd: repo.dir });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  const integrationPath = prCreate.stdout.trim();
  assert.ok(fs.existsSync(integrationPath));

  // cleanup: 有効leaseは解放済み・commitはpush済みだが、Integration Recordが merged/closed で
  // なければ拒否される。
  const cleanupBeforeMerge = runCli(['cleanup', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(cleanupBeforeMerge.status, 1);
  assert.match(cleanupBeforeMerge.stderr, /Integration Record/);

  const integrationText = fs.readFileSync(integrationPath, 'utf8').replace('status: draft', 'status: merged');
  fs.writeFileSync(integrationPath, integrationText);

  const cleanup = runCli(['cleanup', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.stdout.trim(), worktreePath);
  assert.ok(!fs.existsSync(worktreePath), 'cleanup後はworktreeが削除されていること');
});

test('cleanup: main前進後のsquash mergeでupstreamがgoneになってもworktreeを削除できる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(
    ['issue', 'start', 'ISSUE-692', 'bugfix', 'squash-cleanup', FIXED_TIMESTAMP, '--size', 'quick'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'ISSUE_CHANGE.md'), '# issue change\n');
  const checkpoint = runCli(['checkpoint', 'bugfix: add issue change'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  const prCreate = runCli(['pr', 'create', 'ISSUE-692', branch], { cwd: repo.dir });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  const integrationPath = prCreate.stdout.trim();

  fs.writeFileSync(path.join(repo.dir, 'CONCURRENT_CHANGE.md'), '# concurrent main change\n');
  execFileSync('git', ['add', 'CONCURRENT_CHANGE.md'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: advance main before squash merge'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['merge', '--squash', branch], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'bugfix: squash issue change'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', '--delete', branch], { cwd: repo.dir, stdio: 'pipe' });

  assert.throws(
    () => execFileSync('git', ['merge-base', '--is-ancestor', branch, 'main'], { cwd: repo.dir, stdio: 'pipe' }),
    'squash merge後はIssueブランチ先端がmainの祖先ではないこと',
  );
  assert.notEqual(
    execFileSync('git', ['rev-parse', `${branch}^{tree}`], { cwd: repo.dir, encoding: 'utf8' }).trim(),
    execFileSync('git', ['rev-parse', 'main^{tree}'], { cwd: repo.dir, encoding: 'utf8' }).trim(),
    'mainの別変更によりtree一致では統合済みと判定できないこと',
  );

  const integrationText = fs.readFileSync(integrationPath, 'utf8').replace('status: draft', 'status: merged');
  fs.writeFileSync(integrationPath, integrationText);

  const cleanup = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.stdout.trim(), worktreePath);
  assert.ok(!fs.existsSync(worktreePath), 'cleanup後はworktreeが削除されていること');
});

test('cleanup: upstreamもremote refも無いローカル限定commitとrevertは削除せず保護する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(
    ['issue', 'start', 'ISSUE-692', 'bugfix', 'net-zero-commits', FIXED_TIMESTAMP, '--size', 'quick'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'LOCAL_ONLY.md'), '# local only\n');
  execFileSync('git', ['add', 'LOCAL_ONLY.md'], { cwd: worktreePath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: add local-only content'], { cwd: worktreePath, stdio: 'pipe' });
  execFileSync('git', ['revert', '--no-edit', 'HEAD'], { cwd: worktreePath, stdio: 'pipe' });

  const prCreate = runCli(['pr', 'create', 'ISSUE-692', branch], { cwd: repo.dir });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  const integrationPath = prCreate.stdout.trim();
  const integrationText = fs.readFileSync(integrationPath, 'utf8').replace('status: draft', 'status: merged');
  fs.writeFileSync(integrationPath, integrationText);

  assert.throws(
    () => execFileSync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: worktreePath, stdio: 'pipe' }),
    '前提: upstreamを解決できないこと',
  );
  assert.equal(
    execFileSync('git', ['for-each-ref', `--contains=${branch}`, '--format=%(refname)', 'refs/remotes'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    '',
    '前提: branchのcommit列がremote refから到達不能であること',
  );
  assert.equal(
    execFileSync('git', ['diff', '--name-only', 'main', branch], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    '',
    '前提: commitとrevertにより最終treeが分岐点と一致すること',
  );

  const cleanup = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(cleanup.status, 1);
  assert.match(cleanup.stderr, /未pushのcommit/);
  assert.ok(fs.existsSync(worktreePath), '未pushのcommit列があるworktreeを削除しないこと');
});

test('cleanup: upstreamもremote refも無いローカル限定の空commitは削除せず保護する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(
    ['issue', 'start', 'ISSUE-692', 'bugfix', 'empty-commit', FIXED_TIMESTAMP, '--size', 'quick'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');
  execFileSync('git', ['commit', '--allow-empty', '-m', 'test: preserve local-only empty commit'], {
    cwd: worktreePath,
    stdio: 'pipe',
  });

  const prCreate = runCli(['pr', 'create', 'ISSUE-692', branch], { cwd: repo.dir });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  const integrationPath = prCreate.stdout.trim();
  const integrationText = fs.readFileSync(integrationPath, 'utf8').replace('status: draft', 'status: merged');
  fs.writeFileSync(integrationPath, integrationText);

  assert.throws(
    () => execFileSync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: worktreePath, stdio: 'pipe' }),
    '前提: upstreamを解決できないこと',
  );
  assert.equal(
    execFileSync('git', ['for-each-ref', `--contains=${branch}`, '--format=%(refname)', 'refs/remotes'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    '',
    '前提: 空commitがremote refから到達不能であること',
  );

  const cleanup = runCli(['cleanup', 'ISSUE-692'], { cwd: repo.dir });
  assert.equal(cleanup.status, 1);
  assert.match(cleanup.stderr, /未pushのcommit/);
  assert.ok(fs.existsSync(worktreePath), '未pushの空commitがあるworktreeを削除しないこと');
});

test('issue start (local backend): --title/--request-fileを渡すとstate.yamlへ永続化され、segment startのプロンプトへ供給される（ISSUE-183 AC-4/AC-5）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const requestFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-request-')), 'request.md');
  const requestBody = 'launch_workerの実機再検証用に、spec segmentを1つ完走させる。\n複数行の本文も許容する。';
  fs.writeFileSync(requestFile, requestBody);

  const start = runCli(
    [
      'issue',
      'start',
      'ISSUE-2',
      'feature',
      'sample-feature-2',
      FIXED_TIMESTAMP,
      '--title',
      '使い捨て検証用issue',
      '--request-file',
      requestFile,
    ],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);

  // Then (AC-4): state.yamlへ title/request が永続化されていること。
  const statePath = path.join(repo.dir, 'issues', '2', '.agent-skill-chain', 'state.yaml');
  const state = parse(fs.readFileSync(statePath, 'utf8')) as { title?: string; request?: string };
  assert.equal(state.title, '使い捨て検証用issue');
  assert.equal(state.request, requestBody);

  // When/Then (AC-5): lease取得後の segment start の出力へ title/request が同梱されること。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-2', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  const segmentStart = runCli(['segment', 'start', 'ISSUE-2', 'spec'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);
  assert.match(segmentStart.stdout, /issue:/);
  assert.match(segmentStart.stdout, /title: 使い捨て検証用issue/);
  assert.match(segmentStart.stdout, /request:/);
  assert.match(segmentStart.stdout, /launch_workerの実機再検証用に/);
});

test('issue start (local backend): --title/--requestを指定しない従来どおりの起票は引き続き成功し、state.yamlはtitle/requestを持たない（後方互換、ISSUE-183 AC-4）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-3', 'feature', 'sample-feature-3', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);

  const statePath = path.join(repo.dir, 'issues', '3', '.agent-skill-chain', 'state.yaml');
  const state = parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  assert.ok(!('title' in state), '従来どおりの起票ではtitleフィールドを持たないこと');
  assert.ok(!('request' in state), '従来どおりの起票ではrequestフィールドを持たないこと');

  // segment startの出力も従来どおり（issue:ブロックが同梱されない）であること。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-3', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  const segmentStart = runCli(['segment', 'start', 'ISSUE-3', 'spec'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);
  assert.doesNotMatch(segmentStart.stdout, /^issue:/m, 'title/requestが無いstateではissue:ブロックを同梱しないこと');
});

test('issue start (local backend): --size quick はstate.yamlへ永続化され、不正値はエラーになる（ISSUE-425）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: worktree作成時点（成果物を1つも作る前）に --size quick を指定する
  const start = runCli(['issue', 'start', 'ISSUE-5', 'feature', 'sample-feature-5', FIXED_TIMESTAMP, '--size', 'quick'], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);

  // Then: state.yaml へ size: quick が記録される（SPEC.md等の成果物には一切依存しない）
  const statePath = path.join(repo.dir, 'issues', '5', '.agent-skill-chain', 'state.yaml');
  const state = parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  assert.equal(state.size, 'quick');

  // When/Then: quick|standard 以外の値は起票時点で拒否する
  const invalid = runCli(
    ['issue', 'start', 'ISSUE-6', 'feature', 'sample-feature-6', FIXED_TIMESTAMP, '--size', 'tiny'],
    { cwd: repo.dir },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--size は quick\|standard のいずれかである必要があります/);
});

test('issue start (local backend): --requestと--request-fileを同時指定するとエラーになる（ISSUE-183）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(
    ['issue', 'start', 'ISSUE-4', 'feature', 'sample-feature-4', FIXED_TIMESTAMP, '--request', 'a', '--request-file', '/nonexistent'],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 1);
  assert.match(start.stderr, /同時に指定できません/);
});

test('gate review (CI単一checkout): .worktrees/ レイアウト無しでも、現在のブランチがissue_idに一致すればrootを対象に動作する', async (t) => {
  // GitHub Actions の actions/checkout は git worktree add を一切使わず、対象ブランチを
  // リポジトリルートへ直接チェックアウトするだけの単一チェックアウトを行う（Issue #171 実地障害の再現）。
  // findIssueWorktree の .worktrees/ 型レイアウト照合は空振りするため、rootへのフォールバックで
  // gate review が動作することを確認する。
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  execFileSync('git', ['checkout', '-b', 'feature/171-ci-gate-dogfood'], { cwd: repo.dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'wip: SPEC追加'], { cwd: repo.dir, stdio: 'pipe' });

  const gateReview = runCli(['gate', 'review', 'ISSUE-171', 'spec', 'strict'], { cwd: repo.dir });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch, 'gate_report_path が出力されること');
  assert.ok(fs.existsSync(gateReportPathMatch![1]));

  // 後方互換: target_sha 省略時は従来通り entry.path の実際の HEAD を自己解決すること。
  const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir }).toString().trim();
  const reportWithoutArg = fs.readFileSync(gateReportPathMatch![1], 'utf8');
  assert.match(reportWithoutArg, new RegExp(`target_sha: ${actualHead}`));
});

test('gate review: target_shaを明示指定した場合、entry.pathの実際のHEADと異なっていてもそれが採用されること（Issue #171: CIのdetached HEAD対応）', async (t) => {
  // actions/checkout@v4 は pull_request イベントで refs/pull/<n>/merge をdetached HEADで
  // チェックアウトするため、CI上の実際のHEADはPRの実際のブランチ先端コミット（
  // github.event.pull_request.head.sha）とは異なる別のSHA（マージコミット）になる。
  // ここではdetached HEADへ実際に切り替えたうえでgate reviewにtarget_shaを明示指定し、
  // 発行されるgate-reportのtarget_shaが「detached HEADの実SHA」ではなく「明示指定したSHA」に
  // なることを検証する（workflowテンプレートが渡す steps.ctx.outputs.target_sha 相当）。
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  execFileSync('git', ['checkout', '-b', 'feature/172-explicit-target-sha'], { cwd: repo.dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'wip: SPEC追加(branch tip)'], { cwd: repo.dir, stdio: 'pipe' });
  const branchTipSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir }).toString().trim();

  // CIのマージコミット相当: さらに1つ空commitを積んでdetached HEADへ切り替える
  // （branchTipShaとは異なる別のSHAをHEADにする。実CIでは actions/checkout がこの状態を作る）。
  execFileSync('git', ['commit', '--allow-empty', '-m', 'merge commit (CI checkout相当)'], {
    cwd: repo.dir,
    stdio: 'pipe',
  });
  const mergeCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir }).toString().trim();
  assert.notEqual(mergeCommitSha, branchTipSha, '前提: detached HEAD相当のSHAはbranch先端SHAと異なること');
  execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: repo.dir, stdio: 'pipe' });

  // Given: GITHUB_HEAD_REF/GITHUB_BASE_REF を明示的に未設定にする（このテスト自体がCIの
  // verifyジョブ内で実行されるため、未サニタイズだと実行中プロセスの本物のGITHUB_HEAD_REFが
  // 子プロセスへ継承され、意図した「単一worktreeを信頼するフォールバック」経路を検証できない）。
  const env = { ...process.env };
  delete (env as Record<string, string | undefined>).GITHUB_HEAD_REF;
  delete (env as Record<string, string | undefined>).GITHUB_BASE_REF;

  const gateReview = runCli(['gate', 'review', 'ISSUE-172', 'spec', 'strict', branchTipSha], {
    cwd: repo.dir,
    env,
  });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch, 'gate_report_path が出力されること');
  const reportText = fs.readFileSync(gateReportPathMatch![1], 'utf8');

  assert.match(
    reportText,
    new RegExp(`target_sha: ${branchTipSha}`),
    '明示指定したtarget_sha（PRの実際のブランチ先端コミット）が採用されること',
  );
  assert.doesNotMatch(
    reportText,
    new RegExp(`target_sha: ${mergeCommitSha}`),
    'entry.pathの実際のHEAD（detached HEADのマージコミット相当）が採用されないこと',
  );
});

// Issue #427: 実装セグメント着手（segment start <issue_id> implementation）は既定で人間の
// 明示的な確認を要求し、role_contractを返す前（writer lease検査より先）に拒否する。
test('segment start (実装セグメント, Issue #427): human_confirmation.before_implementationが未設定（既定）の場合、writer lease取得前に人間確認を要求し拒否する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  // 本物のリポジトリ自身の config は dogfooding のため human_confirmation.before_implementation:
  // false を持つ（自走的な実装セグメント着手を明示承認済みの開発環境のため）。「未設定＝既定
  // true（人間確認を要求）」を検証するため、fixture からその値を明示的に外す。
  removeHumanConfirmationBeforeImplementation(repo.dir);

  const start = runCli(['issue', 'start', 'ISSUE-5', 'feature', 'sample-feature-5', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);

  // lease未取得の状態でも、人間確認ゲートの方が先に評価され拒否されること。
  const segmentStart = runCli(['segment', 'start', 'ISSUE-5', 'implementation'], { cwd: repo.dir });
  assert.notEqual(segmentStart.status, 0);
  assert.match(segmentStart.stderr, /人間レビューが必要です/);
  assert.doesNotMatch(segmentStart.stderr, /writer lease/, 'lease未取得エラーより先に人間確認ゲートで停止すること');
});

test('segment start (実装セグメント, Issue #427): human_confirmation.before_implementationをfalseに明示設定した場合、従来どおりrole_contractを返す', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setHumanConfirmationBeforeImplementation(repo.dir, false);

  const start = runCli(['issue', 'start', 'ISSUE-6', 'feature', 'sample-feature-6', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);

  const acquire = runCli(['lease', 'acquire', 'ISSUE-6', 'implementation'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  const segmentStart = runCli(['segment', 'start', 'ISSUE-6', 'implementation'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: implementation_worker/);
  assert.match(segmentStart.stdout, /inputs:\n\s+- SPEC\.md\n\s+- DESIGN\.md\n\s+- PLAN\.md/);
  assert.match(segmentStart.stdout, /PLANの順序に従う/);
});

test('segment start (local backend): size:quick のimplementation契約はstateのIssue内容を入力にする（Issue #690）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setHumanConfirmationBeforeImplementation(repo.dir, false);

  const start = runCli(
    [
      'issue',
      'start',
      'ISSUE-690',
      'bugfix',
      'quick-contract-local',
      FIXED_TIMESTAMP,
      '--size',
      'quick',
      '--title',
      'quick契約のローカル検証',
      '--request',
      'stateに保存された要求本文',
    ],
    { cwd: repo.dir },
  );
  assert.equal(start.status, 0, start.stderr);
  const statePath = stateFilePath(repo.dir, '690');
  const state = parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(statePath, stringify({ ...state, risk: 'normal' }));

  const acquire = runCli(['lease', 'acquire', 'ISSUE-690', 'implementation'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  const result = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /title: quick契約のローカル検証/);
  assert.match(result.stdout, /request: stateに保存された要求本文/);

  const contract = result.stdout.slice(result.stdout.indexOf('inputs:'), result.stdout.indexOf('worker_completion_report:'));
  assert.match(contract, /inputs:\n\s+- Issue/);
  assert.doesNotMatch(contract, /\n\s+- (?:SPEC\.md|DESIGN\.md|PLAN\.md)\s*$/m);
  assert.doesNotMatch(contract, /PLANの順序に従う/);

  for (const issueFields of [
    { title: '', request: '' },
    { title: ' \n\t', request: ' \n\t' },
    { title: 'quick契約のローカル検証', request: '' },
    { title: 'quick契約のローカル検証', request: ' \n\t' },
    {},
  ]) {
    const currentState = parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    delete currentState.title;
    delete currentState.request;
    fs.writeFileSync(statePath, stringify({ ...currentState, ...issueFields }));

    const missingIssue = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir });
    assert.equal(missingIssue.status, 1);
    assert.match(missingIssue.stderr, /Issue内容を取得できないためsize:quick用のimplementation契約を生成できません/);
    assert.doesNotMatch(missingIssue.stdout, /^role: implementation_worker/m);
  }
});

test('segment start (spec, Issue #427): human_confirmation.before_implementationが未設定でも対象外セグメントには影響しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  removeHumanConfirmationBeforeImplementation(repo.dir);

  const start = runCli(['issue', 'start', 'ISSUE-7', 'feature', 'sample-feature-7', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);

  const acquire = runCli(['lease', 'acquire', 'ISSUE-7', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  const segmentStart = runCli(['segment', 'start', 'ISSUE-7', 'spec'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);
});

test('segment start (ISSUE-642 AC-1/AC-6): 全4ロールのcontract末尾に既存条件を保った完了報告手順を付加する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setHumanConfirmationBeforeImplementation(repo.dir, false);

  const start = runCli(['issue', 'start', 'ISSUE-642', 'bugfix', 'worker-completion-report', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);

  const cases = [
    { segment: 'spec', role: 'spec_worker', existingCompletion: 'Draft PRを作成済み' },
    { segment: 'design', role: 'design_worker', existingCompletion: 'commit + push済み' },
    { segment: 'implementation', role: 'implementation_worker', existingCompletion: 'commit + push済み' },
    { segment: 'validation', role: 'validation_worker', existingCompletion: 'commit + push済み' },
  ];

  for (const entry of cases) {
    const acquire = runCli(['lease', 'acquire', 'ISSUE-642', entry.segment], { cwd: repo.dir });
    assert.equal(acquire.status, 0, acquire.stderr);

    const segmentStart = runCli(['segment', 'start', 'ISSUE-642', entry.segment], { cwd: repo.dir });
    assert.equal(segmentStart.status, 0, segmentStart.stderr);
    assert.equal(segmentStart.stdout.split('\n')[0], `role: ${entry.role}`, '先頭のrole抽出契約を維持すること');
    assert.match(segmentStart.stdout, new RegExp(entry.existingCompletion.replace(/[+]/g, '\\+')));
    assert.match(segmentStart.stdout, /worker_completion_report:/);
    assert.match(
      segmentStart.stdout,
      new RegExp(`report-status\\.sh ISSUE-642 ${entry.role} ${entry.segment} completed`),
    );

    const release = runCli(['lease', 'release', 'ISSUE-642'], { cwd: repo.dir });
    assert.equal(release.status, 0, release.stderr);
  }
});

test('segment start (local backend): gate reportのblocking findingがある場合だけreview_statusへ同梱する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-446', 'bugfix', 'local-review-status', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const acquire = runCli(['lease', 'acquire', 'ISSUE-446', 'design'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  const reportPath = reviewFilePath(repo.dir, '446', 'design');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    stringify({
      gate: {
        blockers: [{ severity: 'blocking', origin: 'design', code: 'AC-3', evidence: ['コメント検出が未結線'] }],
      },
    }),
  );

  const withBlocker = runCli(['segment', 'start', 'ISSUE-446', 'design'], { cwd: repo.dir });
  assert.equal(withBlocker.status, 0, withBlocker.stderr);
  assert.match(withBlocker.stdout, /^review_status:/m);
  assert.match(withBlocker.stdout, /mode: local/);
  assert.match(withBlocker.stdout, /origin: design/);
  assert.match(withBlocker.stdout, /コメント検出が未結線/);

  fs.writeFileSync(reportPath, stringify({ gate: { blockers: [] } }));
  const withoutBlocker = runCli(['segment', 'start', 'ISSUE-446', 'design'], { cwd: repo.dir });
  assert.equal(withoutBlocker.status, 0, withoutBlocker.stderr);
  assert.doesNotMatch(withoutBlocker.stdout, /^review_status:/m);
});

test('segment start (local backend): 他segmentのgate reportに記録されたorigin一致のblocking findingをcross-segment差し戻しで検出する（ADR-0026）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-447', 'bugfix', 'cross-segment-review-status', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const acquire = runCli(['lease', 'acquire', 'ISSUE-447', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  // implementationゲートが origin: specification のblocking findingを検出し、
  // 進行役がspecセグメントへ差し戻したケースを模擬する。
  const implementationReportPath = reviewFilePath(repo.dir, '447', 'implementation');
  fs.mkdirSync(path.dirname(implementationReportPath), { recursive: true });
  fs.writeFileSync(
    implementationReportPath,
    stringify({
      gate: {
        blockers: [
          { severity: 'blocking', origin: 'specification', code: 'SPEC-GAP', evidence: ['SPECの要求が不明確'] },
        ],
      },
    }),
  );

  const result = runCli(['segment', 'start', 'ISSUE-447', 'spec'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^review_status:/m);
  assert.match(result.stdout, /mode: local/);
  assert.match(result.stdout, /origin: specification/);
  assert.match(result.stdout, /source_segment: implementation/);
  assert.match(result.stdout, /SPECの要求が不明確/);
});

test('segment start (local backend): 一部gate report破損でも検出済みfindingとread failureを同梱する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-448', 'bugfix', 'partial-local-review-status', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const acquire = runCli(['lease', 'acquire', 'ISSUE-448', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  const designReportPath = reviewFilePath(repo.dir, '448', 'design');
  fs.mkdirSync(path.dirname(designReportPath), { recursive: true });
  fs.writeFileSync(designReportPath, 'gate: [\n');
  const implementationReportPath = reviewFilePath(repo.dir, '448', 'implementation');
  fs.writeFileSync(
    implementationReportPath,
    stringify({
      gate: {
        blockers: [
          { severity: 'blocking', origin: 'specification', code: 'SPEC-PARTIAL', evidence: ['取得済みfinding'] },
        ],
      },
    }),
  );

  const result = runCli(['segment', 'start', 'ISSUE-448', 'spec'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /detection: succeeded/);
  assert.match(result.stdout, /code: SPEC-PARTIAL/);
  assert.match(result.stdout, /source_segment: implementation/);
  assert.match(result.stdout, /local_read_failures:/);
  assert.match(result.stdout, /segment: design/);
});

test('segment start (local backend): 全segmentのgate report破損時はdetection failedを同梱して起動を継続する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-449', 'bugfix', 'failed-local-review-status', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const acquire = runCli(['lease', 'acquire', 'ISSUE-449', 'design'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);

  for (const segment of ['spec', 'design', 'implementation', 'validation']) {
    const reportPath = reviewFilePath(repo.dir, '449', segment);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, 'gate: [\n');
  }

  const result = runCli(['segment', 'start', 'ISSUE-449', 'design'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^review_status:/m);
  assert.match(result.stdout, /mode: local/);
  assert.match(result.stdout, /detection: failed/);
  assert.match(result.stdout, /spec:/);
  assert.match(result.stdout, /validation:/);
});

test('doctor (local backend): git/リポジトリ/configの検査がすべてOKになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Issue #174: doctorにtemplate-sync検査・main worktree cleanチェックが追加されたため、
  // 事前に .github/ を同期・commitして必須チェックがすべてOKになる状態を整える。
  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: sync templates'], { cwd: repo.dir, stdio: 'pipe' });

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK {2}git\n/);
  assert.doesNotMatch(result.stdout, /gh CLI/);
});
