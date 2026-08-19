import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionMarkerRelativePath } from '../../src/lib/version-marker.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

export interface TmpRepo {
  dir: string;
  remoteDir: string;
  cleanup(): void;
}

export type CoordinationBackend = 'local' | 'github';

/**
 * `.agent-skill-chain/` 正本資産一式を複製した、独立した bare remote 付きの一時 git repo を作る。
 * setup を経由せず、テストが必要とする最小限のリポジトリ状態を直接組み立てる
 * （setup コマンド自体のテストは test/integration/setup.test.ts が別途担う）。
 *
 * backend: 'local' なら config/agent-skill-chain.yaml の coordination.backend を local に書き換える
 * （既定の github だと lease/issue resume/cleanup 等が gh 呼び出しを要求し、gh-stub 無しでは
 * テストできないため）。
 */
export function createTmpRepo({
  backend = 'local',
  selfPackage = false,
}: { backend?: CoordinationBackend; selfPackage?: boolean } = {}): TmpRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-repo-'));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-remote-'));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remoteDir], { stdio: 'pipe' });

  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'agent-skill-chain test']);
  git(dir, ['remote', 'add', 'origin', remoteDir]);

  // 本物のリポジトリ（このパッケージ自身）の .agent-skill-chain/ を複製するが、
  // .installed_version は init 実行によって生成される実行時状態でありテンプレートに含めない
  // （本物側で init 済みだとテスト fixture が「init未導入」を装えなくなる）。
  const installedVersionAbs = path.join(packageRoot, versionMarkerRelativePath());
  fs.cpSync(path.join(packageRoot, '.agent-skill-chain'), path.join(dir, '.agent-skill-chain'), {
    recursive: true,
    filter: (src) => src !== installedVersionAbs,
  });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, 'docs', 'GLOSSARY.md'), path.join(dir, 'docs', 'GLOSSARY.md'));
  fs.copyFileSync(path.join(packageRoot, 'AGENTS.md'), path.join(dir, 'AGENTS.md'));

  if (backend === 'local') {
    const configPath = path.join(dir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
    const text = fs.readFileSync(configPath, 'utf8');
    const patched = text.replace('backend: github            # github | local', 'backend: local              # github | local');
    if (patched === text) {
      throw new Error('coordination.backend: github の書き換えに失敗しました（config/agent-skill-chain.yaml の書式が変わった可能性）');
    }
    fs.writeFileSync(configPath, patched);
  }

  fs.writeFileSync(path.join(dir, 'README.md'), '# test fixture repo\n');
  // Issue #759: 初期commitへ agent-skill-chain 本体を名乗る package.json を含める。ローカル
  // ゲートの準備段は base SHA のコミット内容だけを入力に調達モードを決めるため、この有無が
  // `clone_build`（自リポジトリ形状）と `package_copy`（consumer 形状）の分岐そのものになる。
  if (selfPackage) {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'agent-skill-chain',
          version: '0.0.0-fixture',
          private: true,
          bin: { 'agent-skill-chain': './bin/agents-md.js' },
          scripts: { build: 'true' },
        },
        null,
        2,
      )}\n`,
    );
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: initial commit']);
  git(dir, ['push', '-u', 'origin', 'main']);

  return {
    dir,
    remoteDir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(remoteDir, { recursive: true, force: true });
    },
  };
}

/** worktree.timestamp.format（既定 "%Y%m%d_%H%M%S"）に適合する固定タイムスタンプ。 */
export const FIXED_TIMESTAMP = '20260101_000000';

export type ReviewAdapter = 'claude' | 'codex' | 'human';

/**
 * review.adapter を書き換える。
 *
 * 書き換え前後でテキストが変わらないこと（= 既に目的の値だった場合）を失敗とはしない
 * （本物のリポジトリ側の既定値が変わった場合に誤って no-op 判定してしまうバグの修正）。
 * 代わりに、書き換え後のファイルを読み直し、実際に目的の adapter 値になっていることを検証する。
 */
export function setAdapter(repoDir: string, adapter: ReviewAdapter): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/adapter: \w+/, `adapter: ${adapter}`);
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`adapter: ${adapter}\\b`).test(after)) {
    throw new Error(`review.adapter を ${adapter} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`);
  }
}

/**
 * issue_sync ブロック（ADR-0021）を書き換える。既定 config は `enabled: true` を持つため
 * （ISSUE-567）、明示的な無効化（オプトアウト）や転記先・本文上限を差し替えるために使う（Issue #354）。
 */
export function setIssueSync(
  repoDir: string,
  options: { enabled: boolean; target?: 'issue_body' | 'pr_body' | 'both'; maxBodyChars?: number },
): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const block =
    [
      'issue_sync:',
      `  enabled: ${options.enabled}`,
      `  target: ${options.target ?? 'issue_body'}`,
      `  max_body_chars: ${options.maxBodyChars ?? 60000}`,
    ].join('\n') + '\n';
  const patched = text.replace(/^issue_sync:\n(?: {2}.*\n)*/m, block);
  if (patched === text) {
    throw new Error('issue_sync ブロックを書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
  fs.writeFileSync(configPath, patched);
}

/**
 * review.adapter 行そのものを config から取り除く（schema上 review.adapter は任意項目）。
 * CLI 側の既定値フォールバック（未設定時 claude）を、本物のリポジトリ側の現在値に依存せず検証するために使う。
 *
 * review: ブロック直下の adapter 行のみを対象にする（worker.adapter 行も同名で存在するため、
 * ブロックを跨いだ誤マッチを避ける）。
 */
export function unsetAdapter(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/(review:\n)(\s*adapter: \w+.*\n)/, '$1');
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (/review:\n\s*adapter: \w+/.test(after)) {
    throw new Error('review.adapter 行を削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
}

/**
 * worker.adapter を書き換える（launch_worker が起動するセグメント作業ワーカーの実体）。
 * setAdapter と同型だが、review: ブロックの adapter 行と誤マッチしないよう worker: ブロックに
 * スコープする。
 */
export function setWorkerAdapter(repoDir: string, adapter: ReviewAdapter): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/(worker:\n\s*adapter: )\w+/, `$1${adapter}`);
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`worker:\\n\\s*adapter: ${adapter}\\b`).test(after)) {
    throw new Error(`worker.adapter を ${adapter} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`);
  }
}

/** worker.agent_tool_dispatch.enabledを明示的に切り替える（Issue #448）。 */
export function setWorkerAgentToolDispatch(repoDir: string, enabled: boolean): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(
    /( {2}agent_tool_dispatch:\n {4}enabled: )(?:true|false)/,
    `$1${enabled}`,
  );
  if (patched === text && !new RegExp(`agent_tool_dispatch:\\n\\s*enabled: ${enabled}\\b`).test(text)) {
    throw new Error('worker.agent_tool_dispatch.enabledを書き換えられませんでした');
  }
  fs.writeFileSync(configPath, patched);
}

/**
 * worker.segment_overrides ブロック全体を config から取り除く（ISSUE-307）。
 * 本物のリポジトリの既定 config は worker.segment_overrides.implementation を持つため、
 * 「セグメント別上書きを持たない既存の設定ファイル」（後方互換, SPEC.md AC-3）をテストで
 * 再現するために使う。
 */
export function removeWorkerSegmentOverrides(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/ {2}segment_overrides:\n(?: {4}.*\n)*/, '');
  if (/segment_overrides:/.test(patched)) {
    throw new Error('worker.segment_overrides ブロックを削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
  fs.writeFileSync(configPath, patched);
}

/**
 * worker.model_tiers ブロック全体を config から取り除く（ISSUE-307）。
 * 「ティア対応表を持たない既存の設定ファイル」（後方互換, SPEC.md AC-3）をテストで再現し、
 * かつ「ティア指定はあるが対応表を引けない」解決失敗（AC-2）を再現するために使う。
 */
export function removeWorkerModelTiers(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/ {2}model_tiers:\n(?: {4}.*\n)*/, '');
  if (/model_tiers:/.test(patched)) {
    throw new Error('worker.model_tiers ブロックを削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
  fs.writeFileSync(configPath, patched);
}

/**
 * worker.segment_overrides.<segment> を1件追加する（ISSUE-307）。segment_overrides ブロックが
 * 既に存在する場合はその直下に追記し、存在しない場合は worker.adapter 行の直後に新設する。
 */
export function setWorkerSegmentOverride(
  repoDir: string,
  segment: 'spec' | 'design' | 'implementation' | 'validation',
  override: { adapter?: ReviewAdapter; model_tier?: string; reasoning_effort?: string },
): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const flow = `{${Object.entries(override)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')}}`;
  const line = `    ${segment}: ${flow}\n`;

  let patched: string;
  if (/ {2}segment_overrides:\n/.test(text)) {
    patched = text.replace(/( {2}segment_overrides:\n)/, `$1${line}`);
  } else {
    patched = text.replace(/(worker:\n {2}adapter: \w+.*\n)/, `$1  segment_overrides:\n${line}`);
  }
  if (patched === text) {
    throw new Error(
      `worker.segment_overrides.${segment} を追加できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`,
    );
  }
  fs.writeFileSync(configPath, patched);
}

/**
 * worker.adapter 行そのものを config から取り除く（schema上 worker.adapter は任意項目）。
 * CLI 側の既定値フォールバック（未設定時 human）を検証するために使う。
 */
export function unsetWorkerAdapter(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  let patched = text.replace(/(worker:\n)(\s*adapter: \w+.*\n)/, '$1');

  // worker: 直下に他のキー（segment_overrides・model_tiers等、ISSUE-307）が一切残らない場合、
  // "worker:\n" のままだとYAML上 null になり、スキーマの type:object 検証に通らない
  // （additionalProperties:false と require:[] は object を前提とする）。ISSUE-307で
  // removeWorkerSegmentOverrides/removeWorkerModelTiersと組み合わせて呼ぶ場合に必要になる。
  const lines = patched.split('\n');
  const workerIdx = lines.findIndex((l) => l === 'worker:');
  if (workerIdx !== -1 && !/^\s+\S/.test(lines[workerIdx + 1] ?? '')) {
    lines[workerIdx] = 'worker: {}';
    patched = lines.join('\n');
  }

  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (/worker:\n\s*adapter: \w+/.test(after)) {
    throw new Error('worker.adapter 行を削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
}

/**
 * merge.autonomous（Issue #427）を書き換える。本物のリポジトリの config は dogfooding のため
 * `merge: {autonomous: true}` を持つ（進行役による自走的マージ運用を明示承認済みの開発環境の
 * ため）。「未設定＝既定 false」を検証するテストは removeMergeAutonomous と組み合わせて使う。
 */
export function setMergeAutonomous(repoDir: string, autonomous: boolean): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const block = `merge:\n  autonomous: ${autonomous}\n`;
  const patched = /^merge:\n(?: {2}.*\n)*/m.test(text)
    ? text.replace(/^merge:\n(?: {2}.*\n)*/m, block)
    : `${text}\n${block}`;
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`merge:\\n\\s*autonomous: ${autonomous}\\b`).test(after)) {
    throw new Error(`merge.autonomous を ${autonomous} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`);
  }
}

/**
 * merge.autonomous: true を維持したまま merge.auto_update_branch（Issue #493）を明示設定する。
 * pr merge のbase branch最新性チェックが対象PRをbehindと判定した際の自動最新化オプトインを
 * テストで制御するために使う（既定は未設定＝false相当で最新化を試みず中断する）。
 */
export function setMergeAutoUpdateBranch(repoDir: string, enabled: boolean): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const block = `merge:\n  autonomous: true\n  auto_update_branch: ${enabled}\n`;
  const patched = /^merge:\n(?: {2}.*\n)*/m.test(text)
    ? text.replace(/^merge:\n(?: {2}.*\n)*/m, block)
    : `${text}\n${block}`;
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`merge:\\n\\s*autonomous: true\\n\\s*auto_update_branch: ${enabled}\\b`).test(after)) {
    throw new Error(
      `merge.auto_update_branch を ${enabled} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`,
    );
  }
}

/**
 * merge ブロック全体を config から取り除く（schema上 merge は任意項目）。CLI 側の既定値
 * フォールバック（未設定時 false 相当＝マージ自体を拒否）を、本物のリポジトリ側の dogfooding
 * 設定値（`merge.autonomous: true`）に依存せず検証するために使う。
 */
export function removeMergeAutonomous(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/^merge:\n(?: {2}.*\n)*/m, '');
  if (/^merge:/m.test(patched)) {
    throw new Error('merge ブロックを削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
  fs.writeFileSync(configPath, patched);
}

/**
 * human_confirmation.before_implementation（Issue #427）を書き換える。本物のリポジトリの
 * config は dogfooding のため `human_confirmation: {before_implementation: false}` を持つ
 * （merge.autonomous と同じ精神で、進行役による自走的な実装セグメント着手を明示承認済みの
 * 開発環境のため）。「未設定＝既定 true（人間確認を要求）」を検証するテストは
 * removeHumanConfirmationBeforeImplementation と組み合わせて使う。
 */
export function setHumanConfirmationBeforeImplementation(repoDir: string, required: boolean): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const block = `human_confirmation:\n  before_implementation: ${required}\n`;
  const patched = /^human_confirmation:\n(?: {2}.*\n)*/m.test(text)
    ? text.replace(/^human_confirmation:\n(?: {2}.*\n)*/m, block)
    : `${text}\n${block}`;
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`human_confirmation:\\n\\s*before_implementation: ${required}\\b`).test(after)) {
    throw new Error(
      `human_confirmation.before_implementation を ${required} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`,
    );
  }
}

/**
 * human_confirmation ブロック全体を config から取り除く（schema上 human_confirmation は
 * 任意項目）。CLI側の既定値フォールバック（未設定時 before_implementation: true 相当＝
 * 人間確認を要求）を、本物のリポジトリ側の dogfooding 設定値に依存せず検証するために使う。
 */
export function removeHumanConfirmationBeforeImplementation(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/^human_confirmation:\n(?: {2}.*\n)*/m, '');
  if (/^human_confirmation:/m.test(patched)) {
    throw new Error('human_confirmation ブロックを削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
  fs.writeFileSync(configPath, patched);
}
