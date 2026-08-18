import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP, type CoordinationBackend } from './tmp-repo.js';
import { runCli, binPath } from './cli.js';

// ゲートレビュア起動ラッパー（.agent-skill-chain/scripts/gate-launch-reviewer.sh）を実際の bash で
// 駆動するテスト群の共通ヘルパ。gate-adapters.test.ts と、分類C（外部資格情報ストア限定構成）の
// 回帰テスト（Issue #758）が同じ起動経路を共有する。

export interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 起動ラッパー（gate-launch-reviewer.sh）を bash で実行し、終了コードをそのまま観測する。 */
export function runLauncher(
  repoDir: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = repoDir,
): ScriptResult {
  const script = path.join(repoDir, '.agent-skill-chain', 'scripts', 'gate-launch-reviewer.sh');
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

/** 消費者環境の node_modules/.bin/agent-skill-chain 相当を tmp repo へ用意し、パッケージ CLI へ結線する。 */
export function installCliShim(repoDir: string): void {
  const binDir = path.join(repoDir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, 'agent-skill-chain');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"\n`, { mode: 0o755 });
}

/** issue start → SPEC.md → checkpoint → gate review を行い、pending gate-report を得る共通準備。 */
export function setupGateReview(opts: { backend?: CoordinationBackend; env?: NodeJS.ProcessEnv } = {}) {
  const { backend = 'local', env = process.env } = opts;
  const repo = createTmpRepo({ backend });
  installCliShim(repo.dir);

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n', 'utf8');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const targetSha = checkpoint.stdout.trim();

  const review = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath, env });
  assert.equal(review.status, 0, review.stderr);
  const reportPath = /gate_report_path:\s*(\S+)/.exec(review.stdout)![1];

  return { repo, worktreePath, reportPath, targetSha };
}

export function readFinal(reportPath: string): string {
  return (parse(fs.readFileSync(reportPath, 'utf8')) as { gate: { final: string; conformance: string } }).gate.final;
}

export const REVIEW_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_AUTH_PROBE_CMD',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CREDENTIAL_STORE_CMD',
  'CLAUDE_CREDENTIAL_STORE_TIMEOUT_SEC',
  'CLAUDE_EXECUTABLE',
  'CLAUDE_CORE_REVIEW_MODEL',
  'CLAUDE_CORE_REVIEW_MODEL_TIER',
  'CLAUDE_CORE_REVIEW_REASONING_TIER',
  'CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD',
  'CODEX_AUTH_PROBE_CMD',
  'CODEX_HOME',
  'CODEX_EXECUTABLE',
  'CODEX_REVIEWER_CMD',
  'CODEX_REVIEWER_MODEL',
  'CODEX_REVIEWER_REASONING_EFFORT',
  'CODEX_CORE_REVIEWER_ATTESTED',
  'GATE_REVIEWER_CMD',
  'GATE_REVIEWER_RETRIES',
  'GATE_REVIEWER_RETRY_INTERVAL_SEC',
  'GATE_REVIEWER_TIMEOUT_SEC',
  'ASC_REVIEWER_ORIGINAL_HOME',
  'ASC_REVIEWER_SANITIZED_ROOT',
  'ASC_BASE_REF',
  'ASC_REVIEW_SUBJECT',
  'ASC_REVIEW_ADAPTER_REQUESTED',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_CONFIG_DIR',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
] as const;

/**
 * 呼出元のレビュー設定を除去し、テストが明示した値だけを加えた hermetic env を作る。
 *
 * Issue #758: CLAUDE_CREDENTIAL_STORE_CMD は既定で空文字を与える。空文字は「取得手段なし」を
 * 意味するため、実行ホストが macOS であっても実機の資格情報ストアへ問い合わせない。これを
 * 与えないと、分類C経路を対象としないテストが実行ホスト依存の経路（実 Keychain 問い合わせ・
 * 対話的承認要求）へ入りうる。分類Cを対象とするテストは extra で明示的に上書きする。
 */
export function envWithout(keys: string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of new Set([...REVIEW_ENV_KEYS, ...keys])) delete env[k];
  return { ...env, CLAUDE_CREDENTIAL_STORE_CMD: '', ...extra };
}
