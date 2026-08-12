import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import {
  createTmpRepo,
  setWorkerAdapter,
  setWorkerAgentToolDispatch,
  removeWorkerSegmentOverrides,
  removeWorkerModelTiers,
  setWorkerSegmentOverride,
  FIXED_TIMESTAMP,
  type CoordinationBackend,
} from '../helpers/tmp-repo.js';
import { runCli, binPath } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { packageRoot } from '../../src/lib/paths.js';

// #166 launch_worker（セグメント作業ワーカー起動）の adapter 層 + 起動ラッパー
// （.agent-skill-chain/scripts/worker-launch.sh）を実際の bash で駆動して検証する:
//   (a) claude 成功経路（WORKER_CMD stubがcheckpoint+report completedまで行う） -> exit 0・lease解放
//   (b) claude 起動失敗（非0終了） -> blocked報告・lease解放・exit≠0,≠3（silent passしない）
//   (c) claude 認証未設定 -> 同上のフェイルセーフ
//   (d) claude 完了を騙るケース（WORKER_CMDはexit 0だがreport未達） -> blocked扱い（I8直接検証）
//   (e) codex 未構成 -> lease取得前にexit 2、leaseは一切取得されない
//   (f) human (local/github) -> exit 3・lease解放しない・通知内容
//   (g) lease acquireのwip.limit事前チェック・issue内他segmentコンフリクト検査（AC-2/AC-8）
//   (h) セグメント別 adapter・ティア対応表からの具体モデル解決（ISSUE-307 AC-1, AC-2, AC-3, AC-6, AC-9）
//
// モデル（ワーカー実行系）呼び出しは WORKER_CMD/codex stub で stub 化し、実 API・実 gh へは
// 一切アクセスしない。

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface WorkerReport {
  schema_version: string;
  issue_id: string;
  role: string;
  segment: string;
  status: 'completed' | 'blocked';
  target_sha: string;
  dispatch_token?: string;
  no_change?: boolean;
  no_change_reason?: string;
  blocked_reason?: string;
  human_escalation_requested?: boolean;
}

/** 起動ラッパー（worker-launch.sh）を bash で実行し、終了コードをそのまま観測する。 */
function runWorkerLauncher(worktreePath: string, args: string[], env: NodeJS.ProcessEnv): ScriptResult {
  return runWorkerLauncherFrom(worktreePath, worktreePath, args, env);
}

/** 呼び出すscriptの所在とcwdを分離し、対象worktree外からの絶対パス起動を再現する。 */
function runWorkerLauncherFrom(scriptRoot: string, cwd: string, args: string[], env: NodeJS.ProcessEnv): ScriptResult {
  const script = path.join(scriptRoot, '.agent-skill-chain', 'scripts', 'worker-launch.sh');
  try {
    const stdout = execFileSync('bash', [script, ...args], { cwd, encoding: 'utf8', env });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function runWorkerVerifier(scriptRoot: string, cwd: string, args: string[], env: NodeJS.ProcessEnv): ScriptResult {
  const script = path.join(scriptRoot, '.agent-skill-chain', 'scripts', 'worker-launch-verify.sh');
  try {
    const stdout = execFileSync('bash', [script, ...args], { cwd, encoding: 'utf8', env });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

/**
 * codex.sh を直接 source して launch_worker を呼ぶ（起動ラッパー・CLI（worker context）を経由
 * しない）。ISSUE-307 AC-9 の防御的検査（ASC_WORKER_MODEL_TIERはあるがASC_WORKER_MODELが無い
 * 場合にblockedへ倒す）は、正規経路（worker context がティア解決失敗を lease 取得前のエラーと
 * して返す）では再現できないため、起動ラッパーからアダプタへの伝達に関わるこの経路でのみ
 * 検証できる。
 */
function runCodexLaunchWorkerDirect(worktreePath: string, args: string[], env: NodeJS.ProcessEnv): ScriptResult {
  const adapterPath = path.join(worktreePath, '.agent-skill-chain', 'adapters', 'codex.sh');
  const script = 'set -uo pipefail; source "$1"; shift; set +e; launch_worker "$@"';
  try {
    const stdout = execFileSync('bash', ['-c', script, '_', adapterPath, ...args], {
      cwd: worktreePath,
      encoding: 'utf8',
      env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function detectClaudeCodeSession(env: NodeJS.ProcessEnv): boolean {
  const adapterPath = path.join(packageRoot(), '.agent-skill-chain', 'adapters', 'claude.sh');
  const script = 'source "$1"; if _orchestrator_is_claude_code_cli_session; then printf true; else printf false; fi';
  const stdout = execFileSync('bash', ['-c', script, '_', adapterPath], { encoding: 'utf8', env });
  return stdout === 'true';
}

function runCompletionReportVerifier(
  worktreePath: string,
  latest: string,
  latestStatus: number,
  startedAt: string,
  expectedDispatchToken = 'agent-skill-chain-worker-dispatch.current',
  startedSha = '0'.repeat(40),
): ScriptResult {
  const adapterPath = path.join(worktreePath, '.agent-skill-chain', 'adapters', 'claude.sh');
  const script = [
    'source "$1"',
    '_asc_cli() { printf \'%s\' "$ASC_TEST_LATEST"; return "$ASC_TEST_LATEST_STATUS"; }',
    'set +e',
    'reason="$(_verify_worker_completion_report ISSUE-1 spec_worker spec "$ASC_TEST_STARTED_AT" "$ASC_TEST_DISPATCH_TOKEN" "$ASC_TEST_STARTED_SHA")"',
    'rc=$?',
    'printf \'RC=%s\\nREASON=%s\\n\' "$rc" "$reason"',
    'exit "$rc"',
  ].join('; ');
  const latestWithToken =
    latestStatus === 0 && !latest.includes('\ndispatch_token=')
      ? `${latest.replace(/\n?$/, '\n')}dispatch_token=${expectedDispatchToken}\n`
      : latest;
  const env = envWithout([], {
    ASC_TEST_LATEST: latestWithToken,
    ASC_TEST_LATEST_STATUS: String(latestStatus),
    ASC_TEST_STARTED_AT: startedAt,
    ASC_TEST_DISPATCH_TOKEN: expectedDispatchToken,
    ASC_TEST_STARTED_SHA: startedSha,
  });
  try {
    const stdout = execFileSync('bash', ['-c', script, '_', adapterPath], {
      cwd: worktreePath,
      encoding: 'utf8',
      env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

/**
 * PATH 上に「codex」という名の stub 実行系を用意する。受け取った引数と stdin を別々の
 * キャプチャファイルへ記録したうえで、成果物 commit+push+report completed まで行う
 * （claude stub と同じ最小契約）。
 */
function installCodexStub(t: { after(fn: () => void): void }): {
  stubDir: string;
  argvCapturePath: string;
  stdinCapturePath: string;
} {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-codex-stub-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const stdinCapturePath = path.join(stubDir, 'stdin.txt');
  const codexStub = path.join(stubDir, 'codex');
  fs.writeFileSync(
    codexStub,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      `cat > ${JSON.stringify(stdinCapturePath)}`,
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: codex stub output")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { stubDir, argvCapturePath, stdinCapturePath };
}

/**
 * Agent tool dispatch（Bash直接実行）用の最小codex stub。ASC_ISSUE_ID/ASC_SEGMENT/ASC_ROLE
 * （claude.sh:670のコメントの通り、あくまでworker_cmd実装の便宜のためのenvであり、実際の
 * AI workerはcontract本文だけを頼りに動作する）を一切参照せず、argv・stdinの記録だけを行う。
 * これはdispatch経路では非dispatch経路と異なりそれらのenvが渡されない実際の挙動と一致する
 * （ISSUE-609）。report status・checkpointは実際のAI workerが行う操作を模して呼び出し側が
 * 明示的に代行する。
 */
function installCodexDispatchStub(t: { after(fn: () => void): void }): {
  stubDir: string;
  argvCapturePath: string;
  stdinCapturePath: string;
  cwdCapturePath: string;
} {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-codex-dispatch-stub-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const stdinCapturePath = path.join(stubDir, 'stdin.txt');
  const cwdCapturePath = path.join(stubDir, 'cwd.txt');
  const codexStub = path.join(stubDir, 'codex');
  fs.writeFileSync(
    codexStub,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      `cat > ${JSON.stringify(stdinCapturePath)}`,
      `pwd -P > ${JSON.stringify(cwdCapturePath)}`,
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { stubDir, argvCapturePath, stdinCapturePath, cwdCapturePath };
}

/**
 * 消費者環境の node_modules/.bin/agent-skill-chain 相当を対象dirへ用意し、パッケージ CLI へ結線する。
 * launch_worker は cwd=対象Issueのworktree内で動く前提（DESIGN.md）のため、repo.dir だけでなく
 * worktreePath 側にもCLI解決シムが必要になる（worktreeはgit worktree add由来の独立した
 * 作業ディレクトリであり、node_modules/binは git 追跡外のためrepo.dir側の設置が伝播しない）。
 */
function installCliShim(dir: string): void {
  const binDir = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, 'agent-skill-chain');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${JSON.stringify(binPath)} "$@"\n`, { mode: 0o755 });
}

/** issue start を行い、CLIシムを repo.dir・worktree 双方に設置した状態を作る共通準備。 */
function setupWorkerIssue(opts: { backend?: CoordinationBackend; env?: NodeJS.ProcessEnv; issueId?: string } = {}) {
  const { backend = 'local', env = process.env, issueId = 'ISSUE-1' } = opts;
  const repo = createTmpRepo({ backend });
  installCliShim(repo.dir);

  const start = runCli(['issue', 'start', issueId, 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  installCliShim(worktreePath);

  return { repo, worktreePath };
}

function advanceWorkerHead(worktreePath: string): { startedSha: string; head: string } {
  const startedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  execFileSync('git', ['commit', '--allow-empty', '-m', 'test: add worker output'], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  return { startedSha, head };
}

/** 呼出元workerの実行時状態を除去し、テストが明示した状態だけを持つenvを作る。 */
function envWithout(keys: string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ASC_')) delete env[key];
  }
  delete env.CLAUDECODE;
  Object.assign(env, extra);
  for (const k of keys) delete env[k];
  return env;
}

// Issue #185: report status（worker report）は repoRoot()（共通/メイン作業ツリー）基点で書かれる
// ため、worktreePath ではなく repo.dir（メイン作業ツリー）からの相対パスで読む必要がある
// （ADR-0004。修正前はworktree内へ分裂して書かれていたバグの解消）。
function readWorkerReport(repoDir: string, segment: string): WorkerReport {
  const reportPath = path.join(repoDir, 'issues', '1', '.agent-skill-chain', 'reports', `${segment}.yaml`);
  return parse(fs.readFileSync(reportPath, 'utf8')) as WorkerReport;
}

function createVerifyFixture(
  t: { after(fn: () => void): void },
  shaFile: 'match' | 'mismatch' | 'missing-start' | 'missing-token' | 'missing-started-sha' | 'invalid-started-sha' | 'absent' = 'match',
  dispatchStartedAt = '1970-01-01T00:00:00Z',
  startedShaMode: 'different' | 'head' | 'unrelated' | 'missing-object' = 'different',
  noChangeReason?: string,
) {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath });
  assert.equal(acquire.status, 0, acquire.stderr);

  const initialHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  let startedSha = initialHead;
  if (startedShaMode === 'different') {
    execFileSync('git', ['commit', '--allow-empty', '-m', 'test: add worker output'], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } else if (startedShaMode === 'unrelated') {
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: worktreePath, encoding: 'utf8' }).trim();
    startedSha = execFileSync('git', ['commit-tree', tree, '-m', 'test: unrelated worker start'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim();
  } else if (startedShaMode === 'missing-object') {
    startedSha = '0'.repeat(40);
  }

  const dispatchTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-worker-dispatch.'));
  const dispatchToken = path.basename(dispatchTempDir);
  t.after(() => fs.rmSync(dispatchTempDir, { recursive: true, force: true }));
  const contract = 'role: spec_worker\n';
  fs.writeFileSync(path.join(dispatchTempDir, 'contract.md'), contract);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  if (shaFile !== 'absent') {
    const startedAtLine = shaFile === 'missing-start' ? '' : `DISPATCH_STARTED_AT=${dispatchStartedAt}\n`;
    const dispatchTokenLine = shaFile === 'missing-token' ? '' : `DISPATCH_TOKEN=${dispatchToken}\n`;
    const startedShaLine =
      shaFile === 'missing-started-sha'
        ? ''
        : `STARTED_SHA=${shaFile === 'invalid-started-sha' ? 'invalid' : startedSha}\n`;
    const effectiveSha = shaFile === 'mismatch' ? '0'.repeat(64) : createHash('sha256').update(contract).digest('hex');
    fs.writeFileSync(
      path.join(dispatchTempDir, 'contract.sha256'),
      `CONTRACT_SHA256=${effectiveSha}\nCONTRACT_LINES=1\n${startedAtLine}${dispatchTokenLine}${startedShaLine}`,
    );
  }

  const reportArgs = ['report', 'status', 'ISSUE-1', 'spec_worker', 'spec', 'completed', head, '', '', dispatchToken];
  if (noChangeReason !== undefined && noChangeReason !== '') reportArgs.push('true', noChangeReason);
  const report = runCli(reportArgs, { cwd: worktreePath });
  assert.equal(report.status, 0, report.stderr);
  if (noChangeReason === '') {
    // report statusは空白だけの理由を拒否するため、旧版・外部経路由来のreportを直接再現し、
    // report latestから完了検証までの安全側判定も独立に維持されることを確認する。
    const historicalReport = parse(fs.readFileSync(report.stdout.trim(), 'utf8')) as WorkerReport;
    historicalReport.no_change = true;
    historicalReport.no_change_reason = ' \t\u3000\n';
    fs.writeFileSync(report.stdout.trim(), stringify(historicalReport));
  }
  const leasePath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'lease.yaml');
  return { repo, worktreePath, dispatchTempDir, dispatchToken, leasePath };
}

test('Claude Codeセッション判定 (ISSUE-448 AC-7): CLAUDECODE未設定はfalseへ倒す', () => {
  assert.equal(detectClaudeCodeSession(envWithout(['CLAUDECODE', 'ASC_ORCHESTRATOR_SESSION_OVERRIDE'])), false);
});

test('Claude Codeセッション判定 (ISSUE-448 AC-7): CLAUDECODE=1だけをtrueとする', () => {
  assert.equal(
    detectClaudeCodeSession(envWithout(['ASC_ORCHESTRATOR_SESSION_OVERRIDE'], { CLAUDECODE: '1' })),
    true,
  );
});

test('Claude Codeセッション判定 (ISSUE-448 AC-7): CLAUDECODEのその他の値はfalseへ倒す', () => {
  assert.equal(
    detectClaudeCodeSession(envWithout(['ASC_ORCHESTRATOR_SESSION_OVERRIDE'], { CLAUDECODE: 'true' })),
    false,
  );
});

test('Claude Codeセッション判定 (ISSUE-448 AC-7): 明示overrideは既知のclaude_code_cliだけをtrueとする', () => {
  assert.equal(
    detectClaudeCodeSession(
      envWithout(['CLAUDECODE'], { ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli' }),
    ),
    true,
  );
  assert.equal(
    detectClaudeCodeSession(envWithout(['CLAUDECODE'], { ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'unknown' })),
    false,
  );
});

test('完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5): 未報告・古い報告・今回の不一致を分離し、今回の一致だけを通す', (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  const { startedSha, head } = advanceWorkerHead(worktreePath);
  const startedAt = '2026-08-12T01:02:03Z';

  const missing = runCompletionReportVerifier(worktreePath, '', 1, startedAt);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /workerがreportを投稿していません（契約不履行の可能性）/);

  const stale = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:02.999Z\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /dispatch開始前の報告のみ検出/);
  assert.doesNotMatch(stale.stdout, /報告target_sha=/);

  const mismatch = runCompletionReportVerifier(
    worktreePath,
    'status=completed\ntarget_sha=old-sha\ncreated_at=2026-08-12T01:02:04Z\n',
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /報告target_sha=old-sha/);
  assert.match(mismatch.stdout, new RegExp(`現在HEAD=${head}`));

  const completed = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:03.999Z\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(completed.status, 0, completed.stdout + completed.stderr);
  assert.match(completed.stdout, /^RC=0$/m);
  assert.match(completed.stdout, /^REASON=$/m);

  const tokenMismatch = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:03.999Z\ndispatch_token=agent-skill-chain-worker-dispatch.previous\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(tokenMismatch.status, 1);
  assert.match(tokenMismatch.stdout, /dispatchトークン不一致/);
  assert.match(tokenMismatch.stdout, /過去サイクルの報告の可能性/);

  const tokenMissing = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:03.999Z\ndispatch_token=\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(tokenMissing.status, 1);
  assert.match(tokenMissing.stdout, /dispatchトークン不一致/);
});

test('完了報告共通判定 (ISSUE-644 AC-1〜AC-5): 着手時SHAと同じcompletedは明示的な無変更理由がある場合だけ通す', (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  const startedAt = '2026-08-12T01:02:03Z';
  const baseLatest = `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:04Z\n`;

  const undeclared = runCompletionReportVerifier(worktreePath, baseLatest, 0, startedAt, undefined, head);
  assert.equal(undeclared.status, 1);
  assert.match(undeclared.stdout, /commitが追加されておらず、無変更完了も明示されていません/);

  const missingReason = runCompletionReportVerifier(
    worktreePath,
    `${baseLatest}no_change=true\nno_change_reason_present=false\n`,
    0,
    startedAt,
    undefined,
    head,
  );
  assert.equal(missingReason.status, 1);
  assert.match(missingReason.stdout, /具体的理由がありません/);

  const declared = runCompletionReportVerifier(
    worktreePath,
    `${baseLatest}no_change=true\nno_change_reason_present=true\n`,
    0,
    startedAt,
    undefined,
    head,
  );
  assert.equal(declared.status, 0, declared.stdout + declared.stderr);

  for (const invalidStartedSha of ['', 'invalid']) {
    const invalid = runCompletionReportVerifier(
      worktreePath,
      `${baseLatest}no_change=true\nno_change_reason_present=true\n`,
      0,
      startedAt,
      undefined,
      invalidStartedSha,
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /着手時SHAが欠落または不正形式/);
  }
});

test('完了報告祖先判定 (ISSUE-671 AC-1〜AC-4): 子孫だけを通し、別系統と判定不能は理由を分けて拒否する', (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  const { startedSha, head } = advanceWorkerHead(worktreePath);
  const latest = `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:04Z\n`;

  const descendant = runCompletionReportVerifier(
    worktreePath,
    latest,
    0,
    '2026-08-12T01:02:03Z',
    undefined,
    startedSha,
  );
  assert.equal(descendant.status, 0, descendant.stdout + descendant.stderr);

  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  const unrelatedSha = execFileSync('git', ['commit-tree', tree, '-m', 'test: unrelated history'], {
    cwd: worktreePath,
    encoding: 'utf8',
  }).trim();
  const unrelated = runCompletionReportVerifier(
    worktreePath,
    latest,
    0,
    '2026-08-12T01:02:03Z',
    undefined,
    unrelatedSha,
  );
  assert.equal(unrelated.status, 1);
  assert.match(unrelated.stdout, /祖先ではありません/);
  assert.match(unrelated.stdout, /rollback・履歴書き換えの可能性/);

  const unavailable = runCompletionReportVerifier(
    worktreePath,
    latest,
    0,
    '2026-08-12T01:02:03Z',
    undefined,
    '0'.repeat(40),
  );
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stdout, /祖先関係を判定できませんでした/);
});

test('完了報告鮮度判定 (ISSUE-658 AC-1/AC-2/AC-3): GitHubの秒精度だけ終端へ補正しローカルのミリ秒精度を保つ', (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  const { startedSha, head } = advanceWorkerHead(worktreePath);
  const startedAt = '2026-08-12T01:02:03.847Z';

  const githubSameSecond = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:03Z\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(githubSameSecond.status, 0, githubSameSecond.stdout + githubSameSecond.stderr);

  const githubEarlierSecond = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:02Z\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(githubEarlierSecond.status, 1);
  assert.match(githubEarlierSecond.stdout, /dispatch開始前の報告のみ検出/);

  const localEarlierMillisecond = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:03.846Z\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(localEarlierMillisecond.status, 1);
  assert.match(localEarlierMillisecond.stdout, /dispatch開始前の報告のみ検出/);

  const localLaterMillisecond = runCompletionReportVerifier(
    worktreePath,
    `status=completed\ntarget_sha=${head}\ncreated_at=2026-08-12T01:02:03.848Z\n`,
    0,
    startedAt,
    undefined,
    startedSha,
  );
  assert.equal(localLaterMillisecond.status, 0, localLaterMillisecond.stdout + localLaterMillisecond.stderr);
});

test('Agent tool dispatch (ISSUE-661 AC-1): 別dispatchサイクルは一致しないトークンを発行する', (t) => {
  const first = setupWorkerIssue();
  const second = setupWorkerIssue();
  t.after(() => first.repo.cleanup());
  t.after(() => second.repo.cleanup());
  for (const fixture of [first, second]) {
    setWorkerAdapter(fixture.repo.dir, 'claude');
    setWorkerAgentToolDispatch(fixture.repo.dir, true);
  }
  const env = envWithout(['CLAUDECODE'], {
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
    ASC_DISPATCH_MAX_WAIT_SEC: '60',
    WORKER_RENEW_INTERVAL_SEC: '30',
  });

  const results = [first, second].map((fixture) => runWorkerLauncher(fixture.worktreePath, ['ISSUE-1', 'spec'], env));
  for (const result of results) assert.equal(result.status, 4, result.stderr);
  const dispatchDirs = results.map((result) => /^DISPATCH_TEMP_DIR=(.+)$/m.exec(result.stdout)?.[1]);
  assert.ok(dispatchDirs[0]);
  assert.ok(dispatchDirs[1]);
  const tokens = dispatchDirs.map((dir) => {
    const audit = fs.readFileSync(path.join(dir!, 'contract.sha256'), 'utf8');
    return /^DISPATCH_TOKEN=(.+)$/m.exec(audit)?.[1];
  });
  assert.ok(tokens[0]);
  assert.ok(tokens[1]);
  assert.notEqual(tokens[0], tokens[1]);

  for (const [index, fixture] of [first, second].entries()) {
    const verified = runWorkerVerifier(
      fixture.worktreePath,
      fixture.worktreePath,
      ['ISSUE-1', dispatchDirs[index]!],
      env,
    );
    assert.equal(verified.status, 2, 'report未投稿の後始末はblockedになること');
  }
});

test('Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8, ISSUE-665 AC-1/AC-2/AC-4): Claude向けcontractへdispatchトークンを埋め込み監査メタデータを返す', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');
  setWorkerAgentToolDispatch(repo.dir, true);

  const env = envWithout(['CLAUDECODE'], {
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
    ASC_DISPATCH_MAX_WAIT_SEC: '60',
    WORKER_RENEW_INTERVAL_SEC: '30',
  });
  const result = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);
  assert.equal(result.status, 4, result.stderr);
  assert.match(result.stdout, /^AGENT_TOOL_DISPATCH_REQUIRED$/m);
  assert.match(result.stdout, /^subagent_type: agent-skill-chain-worker$/m);
  assert.match(result.stdout, /^run_in_background: false$/m);
  assert.doesNotMatch(result.stdout, /^role:/m, 'contract本文を進行役の標準出力へ含めないこと');

  const dispatchTempDir = /^DISPATCH_TEMP_DIR=(.+)$/m.exec(result.stdout)?.[1];
  const expectedSha = /^CONTRACT_SHA256=([0-9a-f]{64})$/m.exec(result.stdout)?.[1];
  const expectedLines = /^CONTRACT_LINES=(\d+)$/m.exec(result.stdout)?.[1];
  assert.ok(dispatchTempDir);
  assert.ok(expectedSha);
  assert.ok(expectedLines);
  t.after(() => {
    if (dispatchTempDir && fs.existsSync(path.join(dispatchTempDir, 'renew.pid'))) {
      const pid = Number(fs.readFileSync(path.join(dispatchTempDir, 'renew.pid'), 'utf8').trim());
      if (Number.isInteger(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // verify済みならデーモンは既に終了している。
        }
      }
    }
    if (dispatchTempDir) fs.rmSync(dispatchTempDir, { recursive: true, force: true });
  });

  const contractPath = path.join(dispatchTempDir, 'contract.md');
  const contract = fs.readFileSync(contractPath);
  const audit = fs.readFileSync(path.join(dispatchTempDir, 'contract.sha256'), 'utf8');
  const dispatchToken = /^DISPATCH_TOKEN=(.+)$/m.exec(audit)?.[1];
  assert.match(contract.toString('utf8'), /^role: spec_worker/m);
  assert.match(contract.toString('utf8'), /^worker_completion_dispatch:$/m);
  assert.match(contract.toString('utf8'), new RegExp(`^  dispatch_token: ${dispatchToken}$`, 'm'));
  assert.match(
    contract.toString('utf8'),
    new RegExp(`report-status\\.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatchToken}`),
  );
  assert.match(contract.toString('utf8'), new RegExp(`${dispatchToken} true '<具体的理由>'`));
  assert.equal(createHash('sha256').update(contract).digest('hex'), expectedSha);
  assert.equal(String(contract.toString('utf8').split('\n').length - 1), expectedLines);
  assert.match(audit, /^DISPATCH_STARTED_AT=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
  assert.match(audit, /^STARTED_SHA=[0-9a-f]{40}$/m);
  assert.equal(dispatchToken, path.basename(dispatchTempDir));
  assert.match(result.stdout, /成果物をcommit・pushした後.*report-status\.sh.*completed投稿を実行してから最終応答する/);
  assert.match(result.stdout, new RegExp(`今回のdispatchトークンは ${dispatchToken}`));
  assert.match(result.stdout, new RegExp(`completed <push済みHEAD> '' '' ${dispatchToken}`));
  assert.match(result.stdout, new RegExp(`${dispatchToken} true '<具体的理由>'`));
  assert.match(result.stdout, /最終応答は完了状態・target_sha・簡潔な1文要約のみに限定/);

  const leasePath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'lease.yaml');
  const leaseBeforeRenewInterval = fs.readFileSync(leasePath, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    fs.readFileSync(leasePath, 'utf8'),
    leaseBeforeRenewInterval,
    'renewal_interval到達前にrenewデーモンがlease更新を連打しないこと',
  );

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  assert.match(audit, new RegExp(`^STARTED_SHA=${head}$`, 'm'));
  const report = runCli(
    [
      'report',
      'status',
      'ISSUE-1',
      'spec_worker',
      'spec',
      'completed',
      head,
      '',
      '',
      dispatchToken!,
      'true',
      'dispatch経路の契約検証のみで成果物変更は不要',
    ],
    { cwd: worktreePath, env },
  );
  assert.equal(report.status, 0, report.stderr);
  const verified = runWorkerVerifier(repo.dir, repo.dir, ['ISSUE-1', dispatchTempDir], env);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(fs.existsSync(dispatchTempDir), false, 'verify完了後にdispatch一時ディレクトリを削除すること');

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'verifyがleaseを解放済みであること: ' + reacquire.stderr);
});

test('Agent tool dispatch (ISSUE-647 AC-1/AC-2, ISSUE-609 AC-1, ISSUE-665 AC-1/AC-2/AC-4): Codex向けcontractへdispatchトークンを埋め込み対象worktreeで起動する', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerSegmentOverride(repo.dir, 'spec', { adapter: 'codex' });
  setWorkerAgentToolDispatch(repo.dir, true);

  const { stubDir, argvCapturePath, stdinCapturePath, cwdCapturePath } = installCodexDispatchStub(t);
  const env = envWithout(['CLAUDECODE'], {
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
    ASC_DISPATCH_MAX_WAIT_SEC: '60',
    WORKER_RENEW_INTERVAL_SEC: '30',
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_STDIN_SAFE_THRESHOLD_BYTES: '1',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  const result = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);
  assert.equal(result.status, 4, result.stderr);
  assert.match(result.stdout, /^AGENT_TOOL_DISPATCH_REQUIRED$/m);
  assert.match(result.stdout, /^dispatch_mode: bash_direct$/m);
  assert.doesNotMatch(
    result.stdout,
    /^subagent_type: agent-skill-chain-worker$/m,
    'adapter: codexは固定Claudeベースsubagentへ無条件ディスパッチしないこと',
  );
  assert.doesNotMatch(result.stdout, /^role:/m, 'contract本文を進行役の標準出力へ含めないこと');

  const dispatchTempDir = /^DISPATCH_TEMP_DIR=(.+)$/m.exec(result.stdout)?.[1];
  const codexCmd = /^CODEX_CMD=(.+)$/m.exec(result.stdout)?.[1];
  const expectedSha = /^CONTRACT_SHA256=([0-9a-f]{64})$/m.exec(result.stdout)?.[1];
  const expectedLines = /^CONTRACT_LINES=(\d+)$/m.exec(result.stdout)?.[1];
  assert.ok(dispatchTempDir);
  assert.ok(codexCmd, 'Codexコマンドの直接実行指示が出力に含まれること');
  assert.ok(expectedSha);
  assert.ok(expectedLines);
  const contract = fs.readFileSync(path.join(dispatchTempDir, 'contract.md'));
  const audit = fs.readFileSync(path.join(dispatchTempDir, 'contract.sha256'), 'utf8');
  const dispatchToken = /^DISPATCH_TOKEN=(.+)$/m.exec(audit)?.[1];
  assert.match(contract.toString('utf8'), /^worker_completion_dispatch:$/m);
  assert.match(contract.toString('utf8'), new RegExp(`^  dispatch_token: ${dispatchToken}$`, 'm'));
  assert.match(
    contract.toString('utf8'),
    new RegExp(`report-status\\.sh <issue_id> <role> <segment> completed <push済みHEAD> '' '' ${dispatchToken}`),
  );
  assert.match(contract.toString('utf8'), new RegExp(`${dispatchToken} true '<具体的理由>'`));
  assert.equal(createHash('sha256').update(contract).digest('hex'), expectedSha);
  assert.equal(String(contract.toString('utf8').split('\n').length - 1), expectedLines);
  assert.match(audit, /^DISPATCH_STARTED_AT=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
  assert.match(audit, /^STARTED_SHA=[0-9a-f]{40}$/m);
  assert.equal(dispatchToken, path.basename(dispatchTempDir));
  assert.match(result.stdout, /成果物をcommit・pushした後.*report-status\.sh.*completed投稿を実行してから最終応答する/);
  assert.match(result.stdout, new RegExp(`今回のdispatchトークンは ${dispatchToken}`));
  assert.match(result.stdout, /最終応答は完了状態・target_sha・簡潔な1文要約のみに限定/);
  assert.match(codexCmd!, /^cd \/.* && codex exec/, '絶対パスの対象worktreeへのcdから始まること');
  assert.ok(
    result.stdout.includes(
      `prompt: 固定のAgent tool subagent（agent-skill-chain-worker）へは委譲せず、次のコマンドをBashツールで直接実行する: ${codexCmd}`,
    ),
    'promptにもCODEX_CMDと同じworktree固定済みコマンドを含むこと',
  );
  assert.match(codexCmd!, /-m "gpt-5\.6"/, 'ティア未指定spec segmentは従来のフォールバックモデルを反映すること');
  assert.match(
    codexCmd!,
    /model_reasoning_effort=\\"high\\"/,
    'ティア未指定spec segmentは従来のフォールバックeffortを反映すること',
  );

  t.after(() => {
    if (dispatchTempDir && fs.existsSync(path.join(dispatchTempDir, 'renew.pid'))) {
      const pid = Number(fs.readFileSync(path.join(dispatchTempDir, 'renew.pid'), 'utf8').trim());
      if (Number.isInteger(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // verify済みならデーモンは既に終了している。
        }
      }
    }
    if (dispatchTempDir) fs.rmSync(dispatchTempDir, { recursive: true, force: true });
  });

  // When: 進行役が指示どおりCodexコマンドをBashツールで直接実行する（stubDirを含むPATHを明示的に
  // 引き継ぎ、PATH上の実codex CLIへ誤って到達しないようにする）。
  execFileSync('bash', ['-c', codexCmd!], { cwd: repo.dir, encoding: 'utf8', env });

  // Then: main worktree相当の別cwdから実行してもCodex（stub）は対象Issue worktree内で起動され、
  // 渡されたcontractがそのstdin経由で届いている。
  assert.ok(fs.existsSync(argvCapturePath), 'adapter: codexのdispatch指示を実行するとCodex実行系が起動すること');
  assert.equal(
    fs.readFileSync(cwdCapturePath, 'utf8').trim(),
    fs.realpathSync(worktreePath),
    'Codex実行時のcwdが対象Issue worktreeに固定されること',
  );
  const codexArgv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(codexArgv, /^worker_completion_dispatch:$/m, '位置引数経路にも追記済みcontractを渡すこと');
  assert.match(codexArgv, new RegExp(`^  dispatch_token: ${dispatchToken}$`, 'm'));
  assert.equal(fs.readFileSync(stdinCapturePath, 'utf8'), '', '位置引数経路はstdinへcontractを重複して渡さないこと');

  // 実際のAI worker（Codex）はcontract本文だけを頼りに完了確認まで自律的に行うが、ここではその
  // 振る舞いを模して呼び出し側がcheckpoint+report completedを代行する（既存のISSUE-448 AC-1/AC-4/
  // AC-8ディスパッチテストと同じ検証境界）。
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  assert.match(audit, new RegExp(`^STARTED_SHA=${head}$`, 'm'));
  const report = runCli(
    [
      'report',
      'status',
      'ISSUE-1',
      'spec_worker',
      'spec',
      'completed',
      head,
      '',
      '',
      dispatchToken!,
      'true',
      'dispatch経路の契約検証のみで成果物変更は不要',
    ],
    { cwd: worktreePath, env },
  );
  assert.equal(report.status, 0, report.stderr);

  const verified = runWorkerVerifier(repo.dir, repo.dir, ['ISSUE-1', dispatchTempDir!], env);
  assert.equal(verified.status, 0, verified.stderr);

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'verifyがleaseを解放済みであること: ' + reacquire.stderr);
});

test('Agent tool dispatch (ISSUE-609 AC-3): adapter: humanまたは未知値はlease解放のうえエラーを返し、AIを自動起動しない', () => {
  const { repo, worktreePath } = setupWorkerIssue();

  const adapterPath = path.join(worktreePath, '.agent-skill-chain', 'adapters', 'claude.sh');
  const script = 'set -uo pipefail; source "$1"; shift; set +e; _dispatch_via_agent_tool "$@"; rc=$?; printf \'RC=%s\\n\' "$rc"';
  const env = envWithout([], { ASC_WORKER_ADAPTER: 'human' });

  let result: ScriptResult;
  try {
    const stdout = execFileSync('bash', ['-c', script, '_', adapterPath, 'ISSUE-1', 'spec'], {
      cwd: worktreePath,
      encoding: 'utf8',
      env,
    });
    result = { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    result = {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }

  assert.match(result.stdout, /^RC=1$/m, 'AI起動を伴うexit 4ではなく、通常のエラー終了(1)を返すこと');
  assert.doesNotMatch(result.stdout, /AGENT_TOOL_DISPATCH_REQUIRED/, 'dispatch指示を一切出力しないこと');
  assert.doesNotMatch(result.stdout, /subagent_type/);
  assert.doesNotMatch(result.stdout, /CODEX_CMD/);

  const leasePath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'lease.yaml');
  assert.equal(fs.existsSync(leasePath), false, 'human/未知adapterはAI起動前にleaseを解放すること');

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath });
  assert.equal(reacquire.status, 0, 'leaseが解放され再取得できること: ' + reacquire.stderr);
  repo.cleanup();
});

test('worker-launch (ISSUE-609 AC-4): 本リポジトリ自身の恒久設定(implementation: adapter codex)はAgent tool dispatch有効な対話セッションでも尊重され、Codexが実効的に用いられる', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  // worker.adapter・segment_overridesは書き換えない。本物のリポジトリのconfigが持つ
  // implementation: {adapter: codex, model_tier: highest_capability, reasoning_effort: high}
  // （ISSUE-307恒久設定）がそのままAgent tool dispatch経路でも尊重されることを検証する。
  setWorkerAgentToolDispatch(repo.dir, true);

  const { stubDir, argvCapturePath } = installCodexDispatchStub(t);
  const env = envWithout(['CLAUDECODE'], {
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
    ASC_DISPATCH_MAX_WAIT_SEC: '60',
    WORKER_RENEW_INTERVAL_SEC: '30',
    CODEX_AUTH_PROBE_CMD: 'true',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  const result = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);
  assert.equal(result.status, 4, result.stderr);
  assert.doesNotMatch(
    result.stdout,
    /^subagent_type: agent-skill-chain-worker$/m,
    '恒久設定 adapter: codex にもかかわらず固定Claude subagentへディスパッチされていないこと',
  );

  const dispatchTempDir = /^DISPATCH_TEMP_DIR=(.+)$/m.exec(result.stdout)?.[1];
  const codexCmd = /^CODEX_CMD=(.+)$/m.exec(result.stdout)?.[1];
  assert.ok(dispatchTempDir);
  assert.ok(codexCmd);
  const audit = fs.readFileSync(path.join(dispatchTempDir, 'contract.sha256'), 'utf8');
  const dispatchToken = /^DISPATCH_TOKEN=(.+)$/m.exec(audit)?.[1];
  assert.equal(dispatchToken, path.basename(dispatchTempDir));
  assert.match(codexCmd!, /gpt-5\.6-sol/, 'worker.model_tiers.highest_capability.codexの具体モデルが反映されること');
  assert.match(
    codexCmd!,
    /model_reasoning_effort=\\"high\\"/,
    'implementation segment_overridesのreasoning_effort=highが反映されること',
  );

  t.after(() => {
    if (dispatchTempDir && fs.existsSync(path.join(dispatchTempDir, 'renew.pid'))) {
      const pid = Number(fs.readFileSync(path.join(dispatchTempDir, 'renew.pid'), 'utf8').trim());
      if (Number.isInteger(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // verify済みならデーモンは既に終了している。
        }
      }
    }
    if (dispatchTempDir) fs.rmSync(dispatchTempDir, { recursive: true, force: true });
  });

  execFileSync('bash', ['-c', codexCmd!], { cwd: worktreePath, encoding: 'utf8', env });
  assert.ok(fs.existsSync(argvCapturePath), 'Agent tool dispatch経路でも実際にCodexが実行されること');

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  const report = runCli(
    [
      'report',
      'status',
      'ISSUE-1',
      'implementation_worker',
      'implementation',
      'completed',
      head,
      '',
      '',
      dispatchToken!,
      'true',
      'dispatch経路のadapter選択検証のみで成果物変更は不要',
    ],
    { cwd: worktreePath, env },
  );
  assert.equal(report.status, 0, report.stderr);

  const verified = runWorkerVerifier(repo.dir, repo.dir, ['ISSUE-1', dispatchTempDir!], env);
  assert.equal(verified.status, 0, verified.stderr);
});

test('worker-launch-verify (ISSUE-448 AC-3): renew停止を確認してからleaseを解放する', async (t) => {
  const fixture = createVerifyFixture(t);
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-renew-marker-'));
  t.after(() => fs.rmSync(markerDir, { recursive: true, force: true }));
  const marker = path.join(markerDir, 'renew-stopped.txt');
  const daemon = spawn(
    'bash',
    [
      '-c',
      'trap \'if [[ -f "$2" ]]; then echo lease_present >"$3"; else echo lease_missing >"$3"; fi; exit 0\' TERM; while :; do sleep 0.1; done',
      '_',
      fixture.dispatchTempDir,
      fixture.leasePath,
      marker,
    ],
    { stdio: 'ignore' },
  );
  t.after(() => daemon.kill('SIGKILL'));
  assert.ok(daemon.pid);
  fs.writeFileSync(path.join(fixture.dispatchTempDir, 'renew.pid'), `${daemon.pid}\n`);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'lease_present', 'daemon終了時点ではleaseが残っていること');
  assert.equal(fs.existsSync(fixture.leasePath), false, 'daemon終了確認後にleaseが解放されること');
});

test('worker-launch-verify (ISSUE-448 AC-3): PID再利用を検知した場合は無関係プロセスをkillしない', async (t) => {
  const fixture = createVerifyFixture(t);
  const unrelated = spawn('bash', ['-c', 'sleep 30', 'unrelated-process'], { stdio: 'ignore' });
  t.after(() => unrelated.kill('SIGKILL'));
  assert.ok(unrelated.pid);
  fs.writeFileSync(path.join(fixture.dispatchTempDir, 'renew.pid'), `${unrelated.pid}\n`);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(unrelated.exitCode, null, 'cmdlineにdispatch一時パスを含まないプロセスは生存すること');
});

test('worker-launch-verify (ISSUE-448 AC-3): renew.pid不在でもkillを試みず正常にreport照合へ進む', (t) => {
  const fixture = createVerifyFixture(t);
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('worker-launch-verify (ISSUE-549 AC-1): contract.sha256不在はreport completedでもblocked＋lease解放へ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'absent');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /contract\.sha256が存在しません/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false, 'contract.sha256欠落でもleaseを解放すること');
});

test('worker-launch-verify (ISSUE-448 AC-3/AC-4): contract監査値不一致はreport completedでもblocked＋lease解放へ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'mismatch');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /SHA256または行数/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false, '完全性違反でもleaseを解放すること');
});

test('worker-launch-verify (ISSUE-642 AC-4): DISPATCH_STARTED_AT欠落は監査証跡不備としてblockedへ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'missing-start');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /DISPATCH_STARTED_ATが欠落またはUTC ISO8601形式ではありません/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

test('worker-launch-verify (ISSUE-661 AC-6): DISPATCH_TOKEN欠落は監査証跡不備としてblockedへ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'missing-token');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /DISPATCH_TOKENが欠落しています/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

for (const shaFile of ['missing-started-sha', 'invalid-started-sha'] as const) {
  test(`worker-launch-verify (ISSUE-644 AC-5): ${shaFile}は監査証跡不備としてblockedへ倒す`, (t) => {
    const fixture = createVerifyFixture(t, shaFile);
    const result = runWorkerVerifier(
      fixture.worktreePath,
      fixture.worktreePath,
      ['ISSUE-1', fixture.dispatchTempDir],
      process.env,
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /STARTED_SHAが欠落または40桁16進数形式ではありません/);
    assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
    assert.equal(fs.existsSync(fixture.leasePath), false);
  });
}

test('worker-launch-verify (ISSUE-644 AC-1): 着手時SHAと同じ無宣言completedはblockedへ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'match', '1970-01-01T00:00:00Z', 'head');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /commitが追加されておらず、無変更完了も明示されていません/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

test('worker-launch-verify (ISSUE-644 AC-3): 無変更宣言があっても理由が空白だけならblockedへ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'match', '1970-01-01T00:00:00Z', 'head', '');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /具体的理由がありません/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

test('worker-launch-verify (ISSUE-644 AC-2): 無変更宣言と具体的理由があれば通過する', (t) => {
  const fixture = createVerifyFixture(t, 'match', '1970-01-01T00:00:00Z', 'head', '既存成果物が要件を満たすため');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'completed');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

for (const [startedShaMode, expectedReason] of [
  ['unrelated', /祖先ではありません（rollback・履歴書き換えの可能性）/],
  ['missing-object', /祖先関係を判定できませんでした/],
] as const) {
  test(`worker-launch-verify (ISSUE-671 AC-1/AC-2/AC-4): ${startedShaMode}はblocked＋lease解放へ倒す`, (t) => {
    const fixture = createVerifyFixture(t, 'match', '1970-01-01T00:00:00Z', startedShaMode);
    const result = runWorkerVerifier(
      fixture.worktreePath,
      fixture.worktreePath,
      ['ISSUE-1', fixture.dispatchTempDir],
      process.env,
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, expectedReason);
    const blocked = readWorkerReport(fixture.repo.dir, 'spec');
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.human_escalation_requested, true);
    assert.equal(fs.existsSync(fixture.leasePath), false);
  });
}

test('worker-launch-verify (ISSUE-642 AC-4/AC-5): dispatch開始前のcompleted報告を採用せず契約不履行としてblockedへ倒す', (t) => {
  const fixture = createVerifyFixture(t, 'match', '2099-01-01T00:00:00Z');
  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /workerがreportを投稿していません/);
  assert.match(result.stderr, /dispatch開始前の報告のみ検出/);
  assert.doesNotMatch(result.stderr, /報告target_sha=/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

test('worker-launch-verify (ISSUE-661 AC-5/AC-6): 同一HEADの過去サイクルcompleted報告をトークン不一致でblockedへ倒す', (t) => {
  const fixture = createVerifyFixture(t);
  const auditPath = path.join(fixture.dispatchTempDir, 'contract.sha256');
  const audit = fs.readFileSync(auditPath, 'utf8');
  fs.writeFileSync(auditPath, audit.replace(`DISPATCH_TOKEN=${fixture.dispatchToken}`, 'DISPATCH_TOKEN=next-dispatch-cycle'));

  const result = runWorkerVerifier(
    fixture.worktreePath,
    fixture.worktreePath,
    ['ISSUE-1', fixture.dispatchTempDir],
    process.env,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /dispatchトークン不一致/);
  assert.match(result.stderr, /過去サイクルの報告の可能性/);
  assert.equal(readWorkerReport(fixture.repo.dir, 'spec').status, 'blocked');
  assert.equal(fs.existsSync(fixture.leasePath), false);
});

// --- (a) claude launch_worker: 成功経路 --------------------------------------------------

test('claude launch_worker (ISSUE-470 AC-4, ISSUE-665 AC-3): 明示opt-out時のheadless contractにもdispatchトークンを埋め込み既存動作を維持する', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');
  setWorkerAgentToolDispatch(repo.dir, false);

  // Given: role_contractを標準入力で受け取り、成果物をcommit+pushし、その場で
  // report status completedを自ら発行するWORKER_CMD stub。
  const workerCmd = [
    'cat >/tmp/worker-received-contract.txt',
    'echo "worker output" > WORKER_OUTPUT.md',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: spec worker output")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');

  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    WORKER_CMD: workerCmd,
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
  });

  // When: worker-launch.sh 経由で launch_worker を実行する。
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: exit 0・成果物push済み・report completed・lease解放済み（再取得できることで検証）。
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(worktreePath, 'WORKER_OUTPUT.md')));
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'completed');
  assert.match(report.dispatch_token ?? '', /^agent-skill-chain-worker-dispatch\./);

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'lease解放済みのため再取得できること: ' + reacquire.stderr);

  // role_contract全文（stdin経由）がworkerへ渡っていること（AC-3）。
  const receivedContract = fs.readFileSync('/tmp/worker-received-contract.txt', 'utf8');
  assert.match(receivedContract, /^role: spec_worker/);
  assert.match(receivedContract, /^worker_completion_dispatch:$/m);
  assert.match(receivedContract, new RegExp(`^  dispatch_token: ${report.dispatch_token}$`, 'm'));
  assert.match(receivedContract, /report-status\.sh <issue_id> <role> <segment> completed <push済みHEAD> '' ''/);
  fs.rmSync('/tmp/worker-received-contract.txt', { force: true });
});

/**
 * lease解放（ファイル削除）で消えるまでファイル内容を監視し続け、初回出現時から一度でも
 * 内容が変化していないかを確認する。完了直後にlease.yamlが削除される（release_lease）ため、
 * 「worker完了後に読む」のではなく「消えるまで見張り続ける」ことで、renewal_interval未到達の
 * 間に一切renewが起きなかったことを、削除タイミングに依存せず確認できる。
 */
async function watchLeaseUnchangedUntilReleased(
  leasePath: string,
  isDone: () => boolean,
  pollMs = 50,
): Promise<{ everAppeared: boolean; everChanged: boolean }> {
  let everAppeared = false;
  let everChanged = false;
  let lastContent: string | undefined;
  while (!isDone()) {
    if (fs.existsSync(leasePath)) {
      const current = fs.readFileSync(leasePath, 'utf8');
      if (!everAppeared) {
        everAppeared = true;
        lastContent = current;
      } else if (current !== lastContent) {
        everChanged = true;
        lastContent = current;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { everAppeared, everChanged };
}

test('claude launch_worker (ISSUE-546 AC-1): WORKER_CMD直接起動経路のrenewループはbusy-loopせず、workerが生存し続ける間はrenewal_interval秒経過するまでrenew_leaseを呼ばない', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');
  setWorkerAgentToolDispatch(repo.dir, false);

  // Given: renewal_intervalをworkerの生存時間（3秒固定sleep）よりずっと長い600秒に取る。
  // 修正前の実装（read -t </dev/null）はEOFへ即時到達し待機せず返るため、renewal_intervalの
  // 大小に関わらずrenew_leaseが即座に連打されlease.yamlが書き換わり続けてしまう。
  // 固定秒数のwall-clock待ち（`sleep 3`, renewal_interval到達前後の判定）ではなく、
  // 「起動系のcold start・CI/共有マシンの負荷でどれだけ遅延しても、600秒に到達することは
  // 現実的にない」という大きな余裕を使うことで、負荷変動に対して頑健にする。
  const workerCmd = [
    'sleep 3',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: slow worker output")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');

  const script = path.join(worktreePath, '.agent-skill-chain', 'scripts', 'worker-launch.sh');
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    WORKER_CMD: workerCmd,
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
    WORKER_RENEW_INTERVAL_SEC: '600',
  });
  const leasePath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'lease.yaml');

  const child = spawn('bash', [script, 'ISSUE-1', 'spec'], { cwd: worktreePath, env, stdio: 'ignore' });
  t.after(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // 既に終了済み。
    }
  });
  let exited = false;
  const exitPromise = new Promise<number>((resolve) =>
    child.on('exit', (code) => {
      exited = true;
      resolve(code ?? -1);
    }),
  );

  // Then: lease.yaml出現（lease取得完了）からworker完了によるlease解放（ファイル削除）までを
  // 見張り続け、その間に一度でも内容が変化していないかを確認する。完了直後にlease.yamlは
  // release_leaseで削除されるため、「worker完了後に読む」のではなく「消えるまで見張る」ことで
  // 削除タイミングに依存せず判定する。renewal_interval（600秒）はworkerの生存時間
  // （sleep 3 + checkpoint + report）よりずっと長いため、正しい実装ならrenew_leaseは一度も
  // 呼ばれない。busy-loopなら（renewal_intervalの大小に関わらず）即座に連打されるため、
  // この間に必ず検出できる。
  const watch = await watchLeaseUnchangedUntilReleased(leasePath, () => exited);
  const status = await exitPromise;

  assert.equal(status, 0);
  assert.ok(watch.everAppeared, 'lease.yamlはworker実行中に一度は存在すること');
  assert.equal(
    watch.everChanged,
    false,
    'renewal_intervalに遠く満たない間にrenew_leaseが呼ばれてlease.yamlが書き換わってはならない（busy-loop regression, Issue #546）',
  );
  assert.equal(readWorkerReport(repo.dir, 'spec').status, 'completed');
});

test('claude launch_worker (ISSUE-546 AC-2): workerが終了すればrenewal_intervalの経過を待たずrenewループも速やかに終了する', () => {
  const { repo, worktreePath } = setupWorkerIssue();
  setWorkerAdapter(repo.dir, 'claude');
  setWorkerAgentToolDispatch(repo.dir, false);
  const workerCmd = [
    'sleep 0.2',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: quick worker output")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    WORKER_CMD: workerCmd,
    ASC_ORCHESTRATOR_SESSION_OVERRIDE: 'claude_code_cli',
    // renewal_intervalを極端に大きく（1時間）取る。修正前の懸念（孤児化したsleepが
    // renewal_interval分の待機を残す・起動ラッパー全体がその待機を引きずる）が万一
    // 再発した場合、実測時間はrenewal_interval（3600秒）に近づくはずである。しきい値は
    // 絶対時間ではなくrenewal_intervalに対する比率（半分＝1800秒）で判定することで、
    // 共有マシンの高負荷によるworker自体の遅延（数十秒オーダー）では絶対に誤検出しない
    // 一方、renewal_interval分待ってしまう規模の回帰は確実に検出できる。
    WORKER_RENEW_INTERVAL_SEC: '3600',
  });

  const started = Date.now();
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);
  const elapsedMs = Date.now() - started;
  repo.cleanup();

  assert.equal(res.status, 0, res.stderr);
  assert.ok(
    elapsedMs < 1_800_000,
    `renewループがworker終了後もrenewal_interval（3600秒）分待機せず速やかに終了すること（実測 ${elapsedMs}ms）`,
  );
});

test('worker-launch.sh: 複数issue worktree並存下でmainの絶対パスから起動しても対象worktreeへ再実行し、そのHEADで完了確認する（ISSUE-442 AC-1, AC-2, AC-3, AC-5）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());

  const other = runCli(['issue', 'start', 'ISSUE-2', 'bugfix', 'other-worktree', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(other.status, 0, other.stderr);
  const [, otherWorktreePath] = other.stdout.trim().split('\n');
  installCliShim(otherWorktreePath);

  fs.writeFileSync(path.join(repo.dir, 'MAIN_ONLY.md'), '# main only\n');
  execFileSync('git', ['add', 'MAIN_ONLY.md'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: diverge main head'], { cwd: repo.dir, stdio: 'pipe' });
  const mainHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const targetHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  assert.notEqual(mainHead, targetHead, '前提: 呼び出し元mainと対象worktreeのHEADが異なること');

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-worker-cwd-'));
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const cwdCapture = path.join(scratchDir, 'cwd.txt');
  const workerCmd = [
    'cat >/dev/null',
    `pwd > ${JSON.stringify(cwdCapture)}`,
    'echo "target output" > WORKER_OUTPUT.md',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: target worktree output")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');
  const env = envWithout([], { ANTHROPIC_API_KEY: 'dummy-key-not-logged', WORKER_CMD: workerCmd });

  const result = runWorkerLauncherFrom(repo.dir, repo.dir, ['ISSUE-1', 'spec'], env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(path.resolve(fs.readFileSync(cwdCapture, 'utf8').trim()), path.resolve(worktreePath));
  assert.ok(fs.existsSync(path.join(worktreePath, 'WORKER_OUTPUT.md')), '対象worktreeだけに成果物が作られること');
  assert.equal(fs.existsSync(path.join(repo.dir, 'WORKER_OUTPUT.md')), false, 'mainへ成果物を誤作成しないこと');
  assert.equal(fs.existsSync(path.join(otherWorktreePath, 'WORKER_OUTPUT.md')), false, '別issue worktreeへ成果物を誤作成しないこと');
  assert.equal(readWorkerReport(repo.dir, 'spec').status, 'completed', '対象worktreeのHEAD基準でcompletedになること');
});

test('worker-launch.sh: 同一issueのworktreeが複数ならlease取得前にexit 2で停止する（ISSUE-442 AC-4）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  const duplicatePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-bugfix-1-duplicate-worktree`);
  execFileSync('git', ['worktree', 'add', '-b', 'bugfix/1-duplicate-worktree', duplicatePath, 'main'], {
    cwd: repo.dir,
    stdio: 'pipe',
  });
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-worker-not-started-'));
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const workerCapture = path.join(scratchDir, 'started');
  const env = envWithout([], { WORKER_CMD: `touch ${JSON.stringify(workerCapture)}` });

  const result = runWorkerLauncherFrom(repo.dir, repo.dir, ['ISSUE-1', 'spec'], env);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /対象Issueのworktreeを一意に解決できませんでした/);
  assert.equal(fs.existsSync(workerCapture), false, 'ワーカープロセスは起動されないこと');
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(acquire.status, 0, '停止時点ではlease未取得であること: ' + acquire.stderr);
});

// --- (h) 既定WORKER_CMD（未指定時）: --allowed-toolsによる責務スコープallowlist ------------
//        ISSUE-183 AC-1: 既定起動が自branchへのgit push等を非対話で完走できる
//        ISSUE-183 AC-2: 既定がbypassPermissions/acceptEditsの安易な採用ではなく責務範囲へ限定

test('claude launch_worker: WORKER_CMD未指定時の既定起動はclaude CLIを--allowed-toolsで起動し、bypassPermissions/acceptEditsを含まない（ISSUE-183 AC-1/AC-2）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: PATH上に「claude」という名のstub実行系を用意する（既定起動系のcommand -v claude判定を
  // 満たすため）。stubは受け取った引数をファイルへ記録したうえで、成果物commit+push+report
  // completedまで行う（(a)のWORKER_CMD stubと同じ最小契約）。
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-claude-stub-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const claudeStub = path.join(stubDir, 'claude');
  fs.writeFileSync(
    claudeStub,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      'cat >/dev/null',
      'echo "worker output" > WORKER_OUTPUT.md',
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: default worker_cmd output")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const env = envWithout(['WORKER_CMD', 'WORKER_ALLOWED_TOOLS'], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  // When: WORKER_CMD未指定のまま worker-launch.sh 経由で launch_worker を実行する。
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: 既定起動が完走し（AC-1）、実際にclaude stubへ渡された引数に--allowed-toolsが含まれ、
  // --permission-mode（acceptEdits等）・bypassPermissionsのいずれも含まれないこと（AC-2）。
  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /--allowed-tools/, '既定起動は--allowed-toolsを用いること');
  assert.doesNotMatch(argv, /--permission-mode/, '既定起動はacceptEdits等の--permission-modeを用いないこと');
  assert.doesNotMatch(argv, /bypassPermissions/, '既定起動はbypassPermissionsを用いないこと');
  assert.match(argv, /Bash\(git push:\*\)/, 'allowlistにワーカーの正規責務範囲であるgit pushが含まれること');
  assert.match(argv, /Bash\(git commit:\*\)/, 'allowlistにgit commitが含まれること');
  // Issue #188 AC-5: 生の `gh pr create` は既定allowlistに含まれない（PRテンプレート徹底のため、
  // Draft PR作成は `.agent-skill-chain/scripts/pr-create.sh`（pr createラッパー）経由に一本化する）。
  assert.doesNotMatch(argv, /Bash\(gh pr create:\*\)/, '既定allowlistに生のgh pr createが含まれないこと（Issue #188 AC-5）');
  assert.match(
    argv,
    /Bash\(\.agent-skill-chain\/scripts\/\*\)/,
    'allowlistにDraft PR作成の正規経路（pr createラッパー、.agent-skill-chain/scripts/*）が含まれること',
  );
  assert.match(argv, /Bash\(gh pr view:\*\)/, 'allowlistに参照用途のgh pr viewは引き続き含まれること');
  assert.match(argv, /Bash\(gh pr edit:\*\)/, 'allowlistに更新用途のgh pr editは引き続き含まれること');
});

test('claude launch_worker: WORKER_ALLOWED_TOOLS envで既定allowlistを完全上書きできる（ISSUE-183）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-claude-stub-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const claudeStub = path.join(stubDir, 'claude');
  fs.writeFileSync(
    claudeStub,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      'cat >/dev/null',
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: override allowlist")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const env = envWithout(['WORKER_CMD'], {
    ANTHROPIC_API_KEY: 'dummy-key',
    PATH: `${stubDir}:${process.env.PATH}`,
    WORKER_ALLOWED_TOOLS: 'Read Edit',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);
  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8').trim();
  assert.equal(argv.split('\n').pop(), 'Read Edit', 'WORKER_ALLOWED_TOOLSの値がそのまま--allowed-toolsへ渡ること');
});

// --- (b)/(c)/(d) claude launch_worker: 異常系はすべてblocked + lease解放 + exit非0非3 ------

test('claude launch_worker: WORKER_CMD起動失敗はblocked報告(human_escalation_requested=true)+lease解放+非0非3で返す（silent passしない）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key',
    WORKER_CMD: 'cat >/dev/null; exit 1',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0, 'worker起動失敗はexit 0（完了）にならないこと');
  assert.notEqual(res.status, 3, 'worker起動失敗はexit 3（human deferred）にもならないこと');

  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  assert.equal(report.human_escalation_requested, true);
  assert.ok(report.blocked_reason && report.blocked_reason.length > 0);

  // AC-2: lease放置防止 -> lease解放済みのため同issue・同segmentで即座に再取得できること。
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'worker起動失敗後もleaseが放置されず解放されていること: ' + reacquire.stderr);
});

test('claude launch_worker: 認証未設定（ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN無し）かつ実疎通確認も失敗する場合はblocked+lease解放+非0非3で返す（真の認証欠如、regressionなし）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Issue #185: 認証チェックがenv非空チェック→claude auth statusの実疎通フォールバックの2段化に
  // なったため、このテストは「真の認証欠如」（env無し・実疎通確認も失敗）を明示的に固定する
  // 必要がある。CLAUDE_AUTH_PROBE_CMD=false でプローブを常に失敗させ、実行機のclaude CLIの
  // 実際の認証状態に依存せずhermeticにする。
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], { CLAUDE_AUTH_PROBE_CMD: 'false' });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, 3);
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  assert.equal(report.human_escalation_requested, true);
  assert.match(report.blocked_reason ?? '', /認証/);

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, reacquire.stderr);
});

// Issue #185 AC-4: env認証情報（ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN）が無くても、実疎通確認
// （CLAUDE_AUTH_PROBE_CMDでモック）が成功すれば認証欠如として誤判定せず起動処理へ進むことを検証する。
test('claude launch_worker: env認証情報が無くてもCLAUDE_AUTH_PROBE_CMDの実疎通確認が成功すれば認証欠如と誤判定せず起動処理へ進む（AC-4）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const workerCmd = [
    'cat >/dev/null',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: auth probe success")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');

  // Given: env認証情報は無いが、実疎通確認（CLAUDE_AUTH_PROBE_CMD）はexit0（認証済み）を模す。
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    CLAUDE_AUTH_PROBE_CMD: 'true',
    WORKER_CMD: workerCmd,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: 認証欠如のfail-safe（blocked）は発火せず、通常の完了経路になる。
  assert.equal(res.status, 0, res.stderr);
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'completed');
});

test('claude launch_worker (I8直接検証): WORKER_CMDがexit 0でも完了を報告しなければ「完了を騙る」ケースとしてblocked扱いにする（silent passしない）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: サブプロセス自体はexit 0で正常終了するが、report statusを一切呼ばない
  // （commit/reportをサボる・クラッシュ直前で終了コードだけ0を返す等を模す）。
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key',
    WORKER_CMD: 'cat >/dev/null; exit 0',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: サブプロセスの終了コード0だけでは信頼せず、report-status直近レコード無し/不一致を
  // 検出してblockedへ倒す（silent passでexit 0にはしない）。
  assert.notEqual(res.status, 0, 'report未達のexit 0は「完了」として扱われないこと');
  assert.notEqual(res.status, 3);

  const reportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reports', 'spec.yaml');
  assert.ok(fs.existsSync(reportPath), 'launch_worker自身がblocked reportを書くこと');
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  assert.equal(report.human_escalation_requested, true);

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, reacquire.stderr);
});

test('claude launch_worker (I8直接検証): target_shaが不一致（workerが古いSHAを騙って報告）の場合もblocked扱いにする', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: commit+pushはせず、でたらめなtarget_shaでcompletedを報告するWORKER_CMD stub。
  const workerCmd = [
    'cat >/dev/null',
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed deadbeefdeadbeef "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');

  const env = envWithout([], { ANTHROPIC_API_KEY: 'dummy-key', WORKER_CMD: workerCmd });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0, 'target_sha不一致はexit 0にならないこと');
  assert.notEqual(res.status, 3);
  // report latestが返す直近レコードはworkerが騙って報告したcompletedのままだが、
  // launch_worker自身は不一致を検出した結果を新たなblocked reportとして上書きする。
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
});

// --- ISSUE-548: 未登録adapter値のallowlist検査 -----------------------------------------

test('worker-launch.sh: worker contextが返すadapterが未登録値の場合はsourceせずlease取得前にerror終了する', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());

  // worker context出力を偽装し、adapters/配下を逸脱するadapter値を返す不正・旧版CLIを模擬する。
  const fakeCliDir = path.join(worktreePath, 'bin');
  fs.mkdirSync(fakeCliDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeCliDir, 'agents-md.js'),
    [
      "const argv = process.argv.slice(2);",
      "if (argv[0] === 'worker' && argv[1] === 'context') {",
      `  process.stdout.write(['worktree_path=' + ${JSON.stringify(worktreePath)}, 'adapter=../../../tmp/malicious'].join('\\n') + '\\n');`,
      "  process.exit(0);",
      "} else {",
      "  process.exit(1);",
      "}",
    ].join('\n'),
    'utf8',
  );

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], envWithout([]));

  assert.notEqual(res.status, 0, 'source前に検査で止まりexit 0にならないこと');
  assert.notEqual(res.status, 3);
  assert.notEqual(res.status, 4);
  assert.match(res.stderr, /未登録adapterです/);
  assert.doesNotMatch(res.stderr, /launch_worker が定義されていません/, 'sourceまで到達しないこと');

  // lease取得前のエラーのため、lease acquireは競合なく成功すること。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env: envWithout([]) });
  assert.equal(acquire.status, 0, 'leaseが一切取得されていないこと: ' + acquire.stderr);
});

// --- (e) codex launch_worker: 認証失敗はlease取得後にblockedへ倒す ----------------------

test('codex launch_worker: 認証不成立はblocked報告・lease解放・exit 2へ倒す', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'false',
  });
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0, '認証不成立はexit 0にならないこと');
  assert.notEqual(res.status, 3);

  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(acquire.status, 0, 'blocked後にleaseが解放されること: ' + acquire.stderr);
});

// --- ISSUE-550: _worker_default_cmd がlaunch_gate_reviewerと非対称にCODEX_EXECUTABLE/
//     CLAUDE_EXECUTABLEを無視していた不具合の回帰防止 -------------------------------------

test('codex launch_worker: PATH上にcodexという名の実行系が無くてもCODEX_EXECUTABLEで指定した実行系を使う（ISSUE-550 AC-1）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  // Given: PATH検索に依存せず、CODEX_EXECUTABLEが直接絶対パスで指す「codexという名ではない」
  // 実行系。launch_gate_reviewerと同じ解決順序（${CODEX_EXECUTABLE:-codex}）であれば
  // command -vもコマンド組み立てもこの実行系を使うはず。
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-codex-exe-override-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const customExecutable = path.join(stubDir, 'custom-codex-runtime');
  fs.writeFileSync(
    customExecutable,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      'cat >/dev/null',
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: CODEX_EXECUTABLE override output")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const env = envWithout(['WORKER_CMD', 'CODEX_WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_EXECUTABLE: customExecutable,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(argvCapturePath), 'CODEX_EXECUTABLEで指定した実行系が起動されること');
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'completed');
});

test('claude launch_worker: PATH上にclaudeという名の実行系が無くてもCLAUDE_EXECUTABLEで指定した実行系を使う（ISSUE-550 AC-1）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-claude-exe-override-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const customExecutable = path.join(stubDir, 'custom-claude-runtime');
  fs.writeFileSync(
    customExecutable,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      'cat >/dev/null',
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: CLAUDE_EXECUTABLE override output")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const env = envWithout(['WORKER_CMD'], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    CLAUDE_EXECUTABLE: customExecutable,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(argvCapturePath), 'CLAUDE_EXECUTABLEで指定した実行系が起動されること');
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /--allowed-tools/, '既定allowlist組み立てはCLAUDE_EXECUTABLE指定時も維持されること');
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'completed');
});

test('codex/claude launch_worker: 実行系上書き未設定でPATH上にも存在しない場合はCODEX_EXECUTABLE/CLAUDE_EXECUTABLE導入前と同じくblockedへ倒す（ISSUE-550 AC-2, regression防止）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  // Given: CODEX_EXECUTABLE自体を実在しない名前に固定する。envを無指定にせず明示的に「見つからない」
  // 状態を作ることで、実行機にたまたま実在のcodex/claudeがPATH上にあっても既存の失敗系
  // （return 1 -> blocked）が変化しないことを確認する。
  const env = envWithout(['WORKER_CMD', 'CODEX_WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_EXECUTABLE: '__agent_skill_chain_missing_codex_550__',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0, '実行系が見つからない場合はexit 0にならないこと');
  assert.notEqual(res.status, 3);
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(acquire.status, 0, 'blocked後にleaseが解放されること: ' + acquire.stderr);
});

// --- ISSUE-462: role_contract サイズに応じた Codex prompt 伝達経路 ----------------------

test('codex launch_worker: role_contractが安全閾値を超える場合は位置引数で全文を渡し、外側redirectがあってもstdinを空にする（ISSUE-462 AC-1/AC-3）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());

  const { stubDir, argvCapturePath, stdinCapturePath } = installCodexStub(t);
  const env = envWithout(['WORKER_CMD', 'CODEX_WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_STDIN_SAFE_THRESHOLD_BYTES: '1',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  const stdin = fs.readFileSync(stdinCapturePath, 'utf8');
  assert.match(argv, /\n--\nrole: implementation_worker\n/, 'role_contract全文が単一の位置引数として復元されること');
  assert.match(
    argv,
    /forbidden:\n  - SPEC\.md\/DESIGN\.md\/PLAN\.mdの編集/,
    'role_contract後半の日本語を含む禁止事項まで欠落・破損なく位置引数へ渡すこと',
  );
  assert.equal(stdin, '', 'コマンド内の</dev/nullが外側のprompt_file redirectを上書きすること');
  assert.match(argv, /gpt-5\.6-sol/, '位置引数経路でも解決済みmodelが維持されること');
  assert.match(argv, /model_reasoning_effort="high"/, '位置引数経路でもreasoning effortが維持されること');
  assert.match(argv, /sandbox_workspace_write\.network_access=true/, '位置引数経路でもsandbox設定が維持されること');
});

test('codex launch_worker: role_contractが安全閾値以下の場合は従来どおり末尾-とstdinで渡す（ISSUE-462 AC-2）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  const { stubDir, argvCapturePath, stdinCapturePath } = installCodexStub(t);
  const env = envWithout(['WORKER_CMD', 'CODEX_WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_STDIN_SAFE_THRESHOLD_BYTES: '9999999',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  const stdin = fs.readFileSync(stdinCapturePath, 'utf8');
  assert.match(argv, /\n-\n$/, '従来どおりcodex execの末尾にstdin指示を渡すこと');
  assert.doesNotMatch(argv, /\n--\nrole:/, 'role_contractをargvへ重複して含めないこと');
  assert.match(stdin, /^role: spec_worker\n/, 'role_contract全文を従来どおりstdinへ渡すこと');
});

test('codex launch_worker: 安全閾値が正の整数でない場合は推測せずblockedへ倒してleaseを解放する（ISSUE-462）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout(['WORKER_CMD', 'CODEX_WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_STDIN_SAFE_THRESHOLD_BYTES: 'invalid',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, 3);
  assert.match(res.stderr, /CODEX_STDIN_SAFE_THRESHOLD_BYTES は正の整数/);
  assert.ok(!fs.existsSync(argvCapturePath), '不正な閾値ではcodexコマンドを起動しないこと');
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'blocked後にleaseが解放されること: ' + reacquire.stderr);
});

// --- (h) セグメント別 adapter・ティア対応表からの具体モデル解決（ISSUE-307） --------------

test('codex launch_worker (validation, 任意セグメントへのsegment_overrides追加): worker.adapterがclaudeのままでも指定セグメントだけcodexへ解決される（AC-1の汎用性）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  // 本物のconfigはimplementationのみを上書きするが、AC-1は「セグメント別上書き」自体は
  // 4セグメントいずれにも適用できる汎用の仕組みであることを要求する。ここではvalidation
  // セグメントへ上書きを追加し、他セグメント（worker.adapter=claude据え置き）に影響しないことを
  // 併せて確認する。
  setWorkerSegmentOverride(repo.dir, 'validation', { adapter: 'codex' });

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], { CODEX_AUTH_PROBE_CMD: 'true', PATH: `${stubDir}:${process.env.PATH}` });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'validation'], env);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(argvCapturePath), 'validationセグメントはcodex stubを起動すること');

  const ctx = runCli(['worker', 'context', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(ctx.status, 0, ctx.stderr);
  assert.match(ctx.stdout, /^adapter=claude$/m, '上書きの無いspecはworker.adapter=claudeのまま影響を受けないこと');
});

test('codex launch_worker (implementation, 本リポジトリ既定config): worker.model_tiers.highest_capability.codexの具体モデル文字列とreasoning effort=highがcodex起動コマンドへ反映される（AC-2, AC-6, AC-9）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  // worker.adapterはclaudeのまま変更しない。本物のリポジトリのconfigが持つ
  // worker.segment_overrides.implementation（adapter: codex, model_tier: highest_capability,
  // reasoning_effort: high）とworker.model_tiers.highest_capability.codex（gpt-5.6-sol）だけで
  // implementationセグメントが解決されることを確認する。

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], { CODEX_AUTH_PROBE_CMD: 'true', PATH: `${stubDir}:${process.env.PATH}` });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /gpt-5\.6-sol/, 'worker.model_tiersから解決した具体的なモデル文字列が反映されること（AC-9）');
  assert.match(argv, /model_reasoning_effort="high"/, 'reasoning_effort=highが起動コマンドへ反映されること');
});

test('codex launch_worker (spec, ティア未指定): 個別上書き・設定由来の値がいずれも無い場合は従来のフォールバック（gpt-5.6/high）が維持される（AC-3）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');
  // specにはsegment_overridesが無い（本物のconfigはimplementationのみ上書きする）ため、
  // worker.adapter=codexへ解決されるが、model_tier/reasoning_effortは未解決のまま。

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], { CODEX_AUTH_PROBE_CMD: 'true', PATH: `${stubDir}:${process.env.PATH}` });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /^gpt-5\.6$/m, 'ティア未指定時は従来のフォールバックモデル（非implementation: gpt-5.6）が維持されること');
  assert.match(argv, /model_reasoning_effort="high"/, 'ティア未指定時は従来のフォールバックeffort（非implementation: high）が維持されること');
});

test('codex launch_worker (implementation, セグメント別上書き・ティア対応表を持たない既存設定): 従来のフォールバック（gpt-5.6-terra/medium）が維持される（AC-3, 後方互換）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  removeWorkerSegmentOverrides(repo.dir);
  removeWorkerModelTiers(repo.dir);
  setWorkerAdapter(repo.dir, 'codex');

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], { CODEX_AUTH_PROBE_CMD: 'true', PATH: `${stubDir}:${process.env.PATH}` });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /^gpt-5\.6-terra$/m, 'segment_overrides/model_tiers無しの既存設定はISSUE-307適用前と同一モデルに解決されること');
  assert.match(argv, /model_reasoning_effort="medium"/, 'segment_overrides/model_tiers無しの既存設定はISSUE-307適用前と同一effortに解決されること');
});

test('codex launch_worker: 個別上書き環境変数（CODEX_IMPLEMENTATION_MODEL/CODEX_IMPLEMENTATION_REASONING_EFFORT）は設定由来の解決済み値より優先される（AC-2）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  // 本物のconfigのimplementation上書き（highest_capability/high、具体モデルgpt-5.6-sol）が
  // 既に存在する状態で、個別上書き環境変数がなお優先されることを確認する。

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    PATH: `${stubDir}:${process.env.PATH}`,
    CODEX_IMPLEMENTATION_MODEL: 'override-model',
    CODEX_IMPLEMENTATION_REASONING_EFFORT: 'xhigh',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /override-model/, '個別上書き環境変数が設定由来の解決済みモデルより優先されること');
  assert.match(argv, /model_reasoning_effort="xhigh"/, '個別上書き環境変数が設定由来のreasoning effortより優先されること');
  assert.doesNotMatch(argv, /gpt-5\.6-sol/, '設定由来の値が個別上書きに敗れ反映されないこと');
});

test('codex launch_worker: CODEX_WORKER_CMD完全上書きは設定由来のモデル・閾値解決そのものを行わせない（AC-2, ISSUE-462 AC-4）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  // codexバイナリをPATHへ一切置かず、CODEX_WORKER_CMDだけで完走できることを確認する
  // （完全上書きが最優先であり、モデル解決（codexコマンドの存在確認含む）を経由しないこと）。

  const workerCmd = [
    'cat >/dev/null',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: full override")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');
  const env = envWithout(['WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_WORKER_CMD: workerCmd,
    CODEX_STDIN_SAFE_THRESHOLD_BYTES: 'invalid',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.equal(res.status, 0, res.stderr);
  const report = readWorkerReport(repo.dir, 'implementation');
  assert.equal(report.status, 'completed');
});

test('codex launch_worker: WORKER_CMD完全上書きも閾値判定より優先される（ISSUE-462 AC-4）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());

  const workerCmd = [
    'cat >/dev/null',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: generic full override")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA" "" "" "$ASC_DISPATCH_TOKEN"`,
  ].join(' && ');
  const env = envWithout(['CODEX_WORKER_CMD'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    WORKER_CMD: workerCmd,
    CODEX_STDIN_SAFE_THRESHOLD_BYTES: 'invalid',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.equal(res.status, 0, res.stderr);
  const report = readWorkerReport(repo.dir, 'implementation');
  assert.equal(report.status, 'completed');
});

test('worker-launch.sh (AC-2, AC-9): ティア指定はあるがworker.model_tiersを引けない場合、lease取得前のエラーとして扱われ何も起動しない', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  removeWorkerModelTiers(repo.dir);
  // segment_overrides.implementation（model_tier: highest_capability）は残るが、対応表だけが
  // 無い状態にする。worker context 自体がこの時点でエラーになるため、worker-launch.sh は
  // アダプタ選択にすら進まず、lease取得前のエラー（exit 2）として返す（DESIGN.md）。

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], { CODEX_AUTH_PROBE_CMD: 'true', PATH: `${stubDir}:${process.env.PATH}` });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.notEqual(res.status, 0, 'ティア解決失敗はexit 0にならないこと');
  assert.notEqual(res.status, 3);
  assert.match(res.stderr, /worker context の解決に失敗しました/);
  assert.ok(!fs.existsSync(argvCapturePath), 'codexコマンド自体は起動されないこと（推測で起動しない）');

  const reportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reports', 'implementation.yaml');
  assert.ok(!fs.existsSync(reportPath), 'lease取得前の失敗のためblocked reportは書かれないこと（DESIGN.md）');

  // lease取得前に失敗しているため、leaseは一切取得されておらず即座に新規取得できる。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'implementation'], { cwd: worktreePath, env });
  assert.equal(acquire.status, 0, 'lease取得前のエラーのためleaseは未取得のままであること: ' + acquire.stderr);
});

test('codex launch_worker (直接呼び出し, ASC_WORKER_MODEL_TIERはあるがASC_WORKER_MODELが届かない場合): 推測せず既存のblockedフェイルセーフへ倒す（AC-9防御層）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');
  // 正規経路（config → worker context → worker-launch.sh）ではこの状態（ティア名はあるが
  // 解決済みモデルが無い）には至らない（worker contextの時点でエラーになるため）。ここでは
  // worker-launch.sh・CLI解決を経由せず codex.sh の launch_worker を直接呼び、
  // ASC_WORKER_MODEL_TIERだけを直接注入した場合の防御層のみを検証する。

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout(['ASC_WORKER_MODEL', 'ASC_WORKER_REASONING_EFFORT'], {
    CODEX_AUTH_PROBE_CMD: 'true',
    PATH: `${stubDir}:${process.env.PATH}`,
    ASC_WORKER_MODEL_TIER: 'highest_capability',
  });

  const res = runCodexLaunchWorkerDirect(worktreePath, ['ISSUE-1', 'implementation'], env);

  assert.notEqual(res.status, 0, 'モデル未到達はexit 0にならないこと');
  assert.notEqual(res.status, 3);
  assert.match(res.stderr, /解決済みモデル（ASC_WORKER_MODEL）が届いていません/, '理由が日本語で標準エラーへ出ること');
  assert.ok(!fs.existsSync(argvCapturePath), 'codexコマンド自体は起動されないこと（推測で起動しない）');

  const report = readWorkerReport(repo.dir, 'implementation');
  assert.equal(report.status, 'blocked');
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'implementation'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'blocked後にleaseが解放されること: ' + reacquire.stderr);
});

test('codex.sh: アダプタのソースに具体的なモデル文字列（worker.model_tiersのgpt-5.6-sol）が新たに追加されていない（AC-9, DESIGN.md）', () => {
  const source = fs.readFileSync(path.join(packageRoot(), '.agent-skill-chain', 'adapters', 'codex.sh'), 'utf8');
  assert.doesNotMatch(source, /gpt-5\.6-sol/, 'ティア対応表の具体的なモデル文字列をアダプタのソースへ追加していないこと');
});

test('config.schema.yaml: examplesを含め具体的なモデル文字列（worker.model_tiersのgpt-5.6-sol）が新たに置かれていない（SPEC.md制約, ADR-0015）', () => {
  // 具体的なモデル文字列を新たに置いてよいのは .agent-skill-chain/config/agent-skill-chain.yaml の
  // worker.model_tiers のみであり、スキーマ（examples含む）には置かない（SPEC.md 制約節）。
  // examples は実在するモデル名ではなくプレースホルダ文字列で足りる。
  const source = fs.readFileSync(path.join(packageRoot(), '.agent-skill-chain', 'schemas', 'config.schema.yaml'), 'utf8');
  assert.doesNotMatch(source, /gpt-5\.6-sol/, 'config.schema.yaml（examples含む）に具体的なモデル文字列を新たに置かないこと');
});

// --- (f) human launch_worker: 通知＋非同期deferred --------------------------------------

test('human launch_worker (local): マーカーを生成しexit 3・leaseは解放しない（作業継続中）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'human');

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], process.env);

  assert.equal(res.status, 3, `human deferredはexit 3であること。stderr=${res.stderr}`);

  const marker = path.join(worktreePath, 'issues', '1', '.agent-skill-chain', 'worker-spec.awaiting-human');
  assert.ok(fs.existsSync(marker), 'ローカルモードでawaiting-humanマーカーが生成されること');
  const body = fs.readFileSync(marker, 'utf8');
  for (const field of ['ISSUE-1', 'spec', 'spec_worker', 'lease renew', 'checkpoint', 'report status', 'lease release']) {
    assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `通知本文に「${field}」を含むこと`);
  }
  // spec segmentのみDraft PR作成手順が案内されること（AC-9: segment分岐は通知文言のみ）。
  assert.match(body, /pr create/);

  // leaseは保持継続（release_leaseを呼んでいない）ため、同issue・同segmentの再取得は競合で失敗する。
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env: process.env });
  assert.equal(reacquire.status, 1, 'human deferred中はleaseが保持され続けること');
});

test('human launch_worker (local, design segment): Draft PR作成手順は案内されないこと（specのみの非対称性）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'human');

  // design segmentを起動する前提として、design segmentのrole_contractが取得できる必要がある
  // （segment startはlease有効性のみ検査しSPEC.md等の内容は見ないため、worktree側の前提整備は不要）。
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'design'], process.env);
  assert.equal(res.status, 3, res.stderr);

  const marker = path.join(worktreePath, 'issues', '1', '.agent-skill-chain', 'worker-design.awaiting-human');
  const body = fs.readFileSync(marker, 'utf8');
  assert.doesNotMatch(body, /pr create/);
});

test('human launch_worker (github): gh issue commentで通知しexit 3・ラベル付与・leaseは解放しない', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-worker-human-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const { repo, worktreePath } = setupWorkerIssue({ backend: 'github', env, issueId: 'ISSUE-9' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });
  setWorkerAdapter(repo.dir, 'human');

  const res = runWorkerLauncher(worktreePath, ['ISSUE-9', 'spec'], env);

  assert.equal(res.status, 3, `human deferredはexit 3であること。stderr=${res.stderr}`);
  // コメントは lease acquire 自体が投稿する lease コメントに加え、human通知コメントの計2件になる。
  const comments = stub.readState().comments['9'] ?? [];
  const notification = comments.find((c) => c.body.includes('awaiting-human'));
  assert.ok(notification, 'gh issue commentでawaiting-human通知が発行されること');
  assert.match(notification!.body, /spec_worker/);

  const labels = stub.readState().issueLabels['9'] ?? [];
  assert.ok(labels.includes('worker:spec:awaiting-human'), '通知ラベルが付与されること');

  // leaseは保持継続 -> WIP判定用ラベル(writer-lease:active)は付いたまま。
  assert.ok((stub.readState().issueLabels['9'] ?? []).includes('writer-lease:active'), 'lease保持中はWIP判定ラベルも付いたままであること');
});

// --- (g) lease acquire: wip.limit事前チェック・issue内他segmentコンフリクト検査（AC-2/AC-8） ---

test('lease acquire (local backend): wip.limit（既定3）に達した4件目の取得は拒否される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquire1 = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  const acquire2 = runCli(['lease', 'acquire', 'ISSUE-2', 'spec'], { cwd: repo.dir });
  const acquire3 = runCli(['lease', 'acquire', 'ISSUE-3', 'spec'], { cwd: repo.dir });
  assert.equal(acquire1.status, 0, acquire1.stderr);
  assert.equal(acquire2.status, 0, acquire2.stderr);
  assert.equal(acquire3.status, 0, acquire3.stderr);

  const acquire4 = runCli(['lease', 'acquire', 'ISSUE-4', 'spec'], { cwd: repo.dir });
  assert.equal(acquire4.status, 1, 'wip.limit=3に達した状態での4件目は拒否されること');
  assert.match(acquire4.stderr, /WIP上限/);

  // 1件解放すればWIP枠が空き、4件目が取得できること。
  const release1 = runCli(['lease', 'release', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(release1.status, 0, release1.stderr);

  const acquire4Retry = runCli(['lease', 'acquire', 'ISSUE-4', 'spec'], { cwd: repo.dir });
  assert.equal(acquire4Retry.status, 0, 'release後はWIP枠が空きacquireできること: ' + acquire4Retry.stderr);
});

test('lease acquire (github backend): writer-lease:activeラベル数によるwip.limit事前チェックが機能する', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-wip-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  for (const n of [1, 2, 3]) {
    const acquire = runCli(['lease', 'acquire', `ISSUE-${n}`, 'spec'], { cwd: repo.dir, env });
    assert.equal(acquire.status, 0, acquire.stderr);
  }
  assert.equal(Object.keys(stub.readState().issueLabels).length, 3);

  const acquire4 = runCli(['lease', 'acquire', 'ISSUE-4', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquire4.status, 1, 'wip.limit=3に達した状態での4件目は拒否されること');
  assert.match(acquire4.stderr, /WIP上限/);
});

test('lease acquire (github backend): 同issue内の他segmentの有効leaseはコンフリクトとして拒否される（AC-2）', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-cross-segment-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  const acquireSpec = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquireSpec.status, 0, acquireSpec.stderr);

  // Then: 同issueの別segment（design）は、activeLeaseForだけでは検出できない
  // （segment不一致のため）はずが、issue横断コンフリクト検査により拒否される。
  const acquireDesign = runCli(['lease', 'acquire', 'ISSUE-9', 'design'], { cwd: repo.dir, env });
  assert.equal(acquireDesign.status, 1, '1 Issueにつき同時1つのwriter leaseのみ許可されるため拒否されること');
  assert.match(acquireDesign.stderr, /他segment/);

  // spec leaseを解放すればdesignが取得できること。
  const release = runCli(['lease', 'release', 'ISSUE-9'], { cwd: repo.dir, env });
  assert.equal(release.status, 0, release.stderr);
  const acquireDesignRetry = runCli(['lease', 'acquire', 'ISSUE-9', 'design'], { cwd: repo.dir, env });
  assert.equal(acquireDesignRetry.status, 0, acquireDesignRetry.stderr);
});

test('lease acquire (local backend): 同issue内の他segmentコンフリクトは既存の1ファイル/issue構造により既に拒否される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquireSpec = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquireSpec.status, 0, acquireSpec.stderr);

  const acquireDesign = runCli(['lease', 'acquire', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(acquireDesign.status, 1, '1 Issueにつき同時1つのwriter leaseのみ許可されるため拒否されること');
});

// --- Issue #364 (1) codex workspace-write サンドボックスと共通 .git ------------------------

test('codex launch_worker: linked worktreeの共通.gitディレクトリを追加の書込みrootとして渡し、push用の名前解決も許可する（Issue #364）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  const { stubDir, argvCapturePath } = installCodexStub(t);
  const env = envWithout([], { CODEX_AUTH_PROBE_CMD: 'true', PATH: `${stubDir}:${process.env.PATH}` });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);
  assert.equal(res.status, 0, res.stderr);

  // worktree の .git は共通 .git を指すファイルにすぎず、commit が実際に書く実体は cwd の外に
  // ある。その絶対パスが書込み root として渡らないと worker は index.lock を作れず I3 を満たせない。
  const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: worktreePath,
    encoding: 'utf8',
  }).trim();
  const argv = fs.readFileSync(argvCapturePath, 'utf8');

  assert.ok(
    argv.includes(`sandbox_workspace_write.writable_roots=["${commonDir}"]`),
    `共通.gitディレクトリが書込みrootとして渡されること (argv=${argv})`,
  );
  assert.ok(
    argv.includes('sandbox_workspace_write.network_access=true'),
    `git pushの名前解決が遮断されないこと (argv=${argv})`,
  );
  assert.ok(argv.includes('workspace-write'), 'sandboxはworkspace-writeのままであること（緩和はrootの追加に限る）');
  assert.ok(
    !argv.includes('danger-full-access') && !argv.includes('--dangerously-bypass-approvals-and-sandbox'),
    'サンドボックス自体を無効化する緩和を行わないこと',
  );
});

// --- Issue #364 (2) $var 直後の非ASCII文字による変数名の取り込み --------------------------

test('shellスクリプト全体: $var の直後に非ASCII文字を置かない（単バイトlocaleで変数名へ取り込まれ set -u 致命エラーになる。Issue #364）', () => {
  // 例: "$reason（フェイルセーフ…" は LC_CTYPE が単バイトlocale（ja_JP.eucJP 等）のとき
  // bash の識別子走査（isalnum）が先頭バイト 0xEF を英数字とみなし、未定義の変数名
  // "reason\xef" として展開しようとする。set -u 配下では致命エラーとなり、シェルは
  // その場で exit 1 する——I8 のフェイルセーフ経路自身が blocked 報告・lease 解放へ
  // 到達できずに落ちるため、${var} と明示的に区切る。
  const roots = ['.agent-skill-chain'];
  const offenders: string[] = [];
  const pattern = /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.sh')) {
        fs.readFileSync(full, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (pattern.test(line)) offenders.push(`${path.relative(packageRoot(), full)}:${i + 1}: ${line.trim()}`);
          });
      }
    }
  };
  for (const root of roots) walk(path.join(packageRoot(), root));

  assert.deepEqual(offenders, [], `\$var の直後は ${'${var}'} と明示区切りにすること:\n${offenders.join('\n')}`);
});
