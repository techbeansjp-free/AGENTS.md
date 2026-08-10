import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, repoRoot, resolveAsset, ASSET_NAMESPACE } from '../lib/paths.js';
import { copyTreeFailOnConflict, copyTreeMirror } from '../lib/fs-copy.js';
import { ROOT_LEVEL_ENTRIES, NAMESPACED_ENTRIES } from '../lib/asset-manifest.js';
import { readYamlFile } from '../lib/yaml-io.js';
import { gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { parseDedicatedAppId } from '../lib/trust-backend.js';

const SETUP_USAGE = `
使い方: agent-skill-chain setup [target_dir]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。導入した内容の一覧を標準出力へ。
  失敗時: 終了コード1以上。標準エラー出力に理由。
`;

const GITHUB_USAGE = `
使い方: agent-skill-chain setup github [target_dir] [--dry-run]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  .github/ への実書込みを一切行わず、sync-templatesの変更予定一覧のみを標準出力へ
            表示する。setup-labels・setup-ruleset（GitHub APIへの書込み）は実行しない。

出力:
  成功時: 終了コード0。sync-templates・setup-labels・setup-ruleset の実行結果
          （--dry-run時はsync-templatesの変更予定一覧とスキップ通知）を標準出力へ。
  失敗時: 終了コード1以上。どの下位処理で失敗したかを標準エラー出力に明示。
`;

const LABELS_USAGE = `
使い方: agent-skill-chain setup labels [owner/repo]

出力:
  成功時: 終了コード0。作成・更新したラベル一覧を標準出力へ。
  失敗時: 終了コード1以上。gh api のエラーを標準エラー出力に転記。
`;

const RULESET_USAGE = `
使い方: agent-skill-chain setup ruleset [owner/repo]

環境変数:
  ASC_GATE_APP_ID: required gate Checkを発行する専用GitHub App ID（secretではない）。
                    テンプレートのrequired_status_checksにgate Check context（
                    agent-skill-chain/{spec,design,implementation,validation}-gate）が
                    1件も存在しない場合（既定の配布テンプレート）は不要。1件以上存在する
                    場合のみ必須。未作成の場合の作成・installation手順は
                    docs/ASC_GATE_APP_ID_RUNBOOK.md 参照。

出力:
  成功時: 終了コード0。適用したrulesetの内容を標準出力へ。
  失敗時: 終了コード1以上。gh api のエラーを標準エラー出力に転記。
`;

const GATE_CHECK_NAMES = ['spec', 'design', 'implementation', 'validation']
  .map((gate) => `agent-skill-chain/${gate}-gate`);

export interface GithubBundleDecision {
  /** true の場合のみ githubBundle()（GitHub固有処理）を実行する。 */
  run: boolean;
  /** run: false の場合に summary へ積む、スキップ理由を含む情報行。run: true の場合は空文字列。 */
  message: string;
}

/**
 * Issue #188 AC-1/AC-2: コピー済み config の `coordination.backend` を読み、GitHub固有処理
 * （テンプレート同期・label作成・ruleset適用）を実行してよいかを判定する純関数。
 * 副作用（githubBundle の実行）とは分離し、単体テスト可能にする（DESIGN.md 参照）。
 *
 * 安全側既定: backend が github と明示されている場合のみ実行する（AC-2、現状維持）。
 * backend が local の場合・config が存在しない/読めない場合は、無条件に外部副作用を起こさない
 * ことを優先しスキップする（AC-1）。GitHub固有処理が必要な場合は `setup github` を明示実行するよう促す。
 */
export function decideGithubBundle(targetDir: string): GithubBundleDecision {
  const configPath = path.join(targetDir, ASSET_NAMESPACE, 'config', 'agent-skill-chain.yaml');
  const skip = (reason: string): GithubBundleDecision => ({
    run: false,
    message: `[setup github] スキップ: ${reason}（GitHub固有処理が必要な場合は setup github を明示実行してください）`,
  });
  if (!fs.existsSync(configPath)) {
    return skip('config/agent-skill-chain.yaml が見つかりません');
  }
  try {
    const config = readYamlFile<{ coordination?: { backend?: string } }>(configPath);
    const backend = config.coordination?.backend;
    if (backend === 'github') {
      return { run: true, message: '' };
    }
    return skip(`coordination.backend が github ではありません（現在: ${backend ?? '不明'}）`);
  } catch (error) {
    return skip(`config/agent-skill-chain.yaml の読込に失敗しました: ${(error as Error).message}`);
  }
}

export async function setup(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(SETUP_USAGE);
      return 0;
    }
    // Issue #169 ADR-1: setup（bare）は非推奨。init（+ 必要なら setup github）へ移行してもらうため
    // 処理開始前に警告するが、戻り値・生成物は変更しない（既存テストとの後方互換維持）。
    process.stderr.write('警告: setup は非推奨です。init（+ 必要なら setup github）を使用してください。\n');
    const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
    fs.mkdirSync(targetDir, { recursive: true });

    const summary: string[] = [];
    for (const entry of ROOT_LEVEL_ENTRIES) {
      const src = path.join(packageRoot(), entry);
      if (!fs.existsSync(src)) continue;
      const results = copyTreeFailOnConflict(src, path.join(targetDir, entry), { root: targetDir });
      summary.push(...results.map((r) => `${r.action}: ${r.path}`));
    }
    for (const entry of NAMESPACED_ENTRIES) {
      const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
      if (!fs.existsSync(src)) continue;
      const results = copyTreeFailOnConflict(src, path.join(targetDir, ASSET_NAMESPACE, entry), { root: targetDir });
      summary.push(...results.map((r) => `${r.action}: ${r.path}`));
    }

    // 非推奨aliasから外部状態やconsumerの.githubを暗黙変更しない。GitHub連携は
    // `setup github` という明示的なopt-inだけが実行する。
    summary.push('[setup github] 未実行: 必要な場合だけ setup github を明示実行してください');

    return ok(summary.join('\n'));
  });
}

function githubBundle(targetDir: string, dryRun = false): { status: number; message: string } {
  const lines: string[] = [];

  // ISSUE-538: --dry-run は「一切の外部書込みを行わない」という一貫した意味を持つため、
  // setup-labels・setup-ruleset（GitHub APIへの書込み）はそもそも呼び出さない。両者の前段でのみ
  // 使う rulesetPreflight（ASC_GATE_APP_ID の解決）も、書込み自体を行わないdry-run時は不要なため
  // 呼び出さない（未設定でも --dry-run が失敗しない）。
  if (dryRun) {
    const syncExit = syncStep(targetDir, { dryRun: true });
    if (syncExit.status !== 0) return { status: 1, message: `[sync templates] ${syncExit.message}` };
    lines.push(`[sync templates]\n${syncExit.message}`);
    lines.push('[setup labels]\n--dry-run のためスキップしました（GitHub APIへの書込みは行いません）');
    lines.push('[setup ruleset]\n--dry-run のためスキップしました（GitHub APIへの書込みは行いません）');
    return { status: 0, message: lines.join('\n') };
  }

  const rulesetPreflight = loadRenderedRuleset(targetDir, process.env);
  if (rulesetPreflight.status !== 0) {
    return { status: 1, message: `[setup ruleset preflight] ${rulesetPreflight.message}` };
  }
  const syncExit = syncStep(targetDir);
  if (syncExit.status !== 0) return { status: 1, message: `[sync templates] ${syncExit.message}` };
  lines.push(`[sync templates]\n${syncExit.message}`);

  const labelsExit = labelsStep(undefined, targetDir);
  if (labelsExit.status !== 0) return { status: 1, message: `[setup labels] ${labelsExit.message}` };
  lines.push(`[setup labels]\n${labelsExit.message}`);

  const rulesetExit = rulesetStep(undefined, targetDir, rulesetPreflight.body);
  if (rulesetExit.status !== 0) return { status: 1, message: `[setup ruleset] ${rulesetExit.message}` };
  lines.push(`[setup ruleset]\n${rulesetExit.message}`);

  return { status: 0, message: lines.join('\n') };
}

type RulesetDocument = {
  name?: unknown;
  rules?: {
    type?: unknown;
    parameters?: {
      required_status_checks?: { context?: unknown; integration_id?: unknown }[];
    };
  }[];
};

export function renderRulesetWithDedicatedApp(value: unknown, appIdValue: unknown): RulesetDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ruleset templateがobjectではありません');
  }
  const rendered = structuredClone(value) as RulesetDocument;
  const rules = Array.isArray(rendered.rules)
    ? rendered.rules.filter((rule) => rule.type === 'required_status_checks')
    : [];
  if (rules.length !== 1 || !Array.isArray(rules[0].parameters?.required_status_checks)) {
    throw new Error('ruleset templateのrequired_status_checks定義が一意ではありません');
  }
  const checks = rules[0].parameters.required_status_checks;

  // ISSUE-593: 配布テンプレートの既定はgate check contextを1件も含まない（発行元workflowが
  // 存在しないため）。この場合はASC_GATE_APP_IDを要求せずテンプレートをそのまま返す。手元の
  // テンプレート複製にgate check contextを再度加えた利用者（専用App運用を選ぶ場合）のみ、
  // 従来どおりASC_GATE_APP_ID必須・4件一意性検証・integration_id結線を適用する。
  const presentGateChecks = GATE_CHECK_NAMES.filter((name) => checks.some((check) => check.context === name));
  if (presentGateChecks.length === 0) {
    return rendered;
  }

  const appId = parseDedicatedAppId(appIdValue);
  for (const name of GATE_CHECK_NAMES) {
    const matching = checks.filter((check) => check.context === name);
    if (matching.length !== 1) throw new Error(`ruleset templateの${name}定義が一意ではありません`);
    matching[0].integration_id = appId;
  }
  return rendered;
}

function loadRenderedRuleset(
  cwd: string,
  env: NodeJS.ProcessEnv,
): { status: 0; body: string; ruleset: RulesetDocument } | { status: 1; message: string } {
  try {
    const rulesetPath = resolveAsset(path.join('templates', 'github', 'provisioning', 'rulesets', 'main.json'), cwd);
    const source = JSON.parse(fs.readFileSync(rulesetPath, 'utf8')) as unknown;
    const ruleset = renderRulesetWithDedicatedApp(source, env.ASC_GATE_APP_ID);
    return { status: 0, body: `${JSON.stringify(ruleset, null, 2)}\n`, ruleset };
  } catch (error) {
    return {
      status: 1,
      message: `専用Appをrulesetへ固定できません: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function syncStep(targetDir: string, options: { dryRun?: boolean } = {}): { status: number; message: string } {
  const { dryRun = false } = options;
  const source = resolveAsset(path.join('templates', 'github', '.github'), targetDir);
  const dest = path.join(targetDir, '.github');
  const prefix = dryRun ? 'planned ' : '';
  try {
    // ISSUE-538: 大文字小文字のみ異なる既存ファイルとの衝突検知は dryRun の値に関わらず
    // 常に有効にする（衝突検知は計画段階で行われ、dryRunでも実書込み無しに同じ結果になる）。
    const results = copyTreeMirror(source, dest, { root: targetDir, dryRun, detectCaseCollision: true });
    return {
      status: 0,
      message: results.map((r) => `${prefix}${r.action}: ${r.path}`).join('\n') || '(同期対象なし)',
    };
  } catch (error) {
    return { status: 1, message: error instanceof Error ? error.message : String(error) };
  }
}

interface LabelDef {
  name: string;
  color: string;
  description: string;
}

function repoFlag(ownerRepo?: string): string[] {
  return ownerRepo ? ['--repo', ownerRepo] : [];
}

/** GitHub Labels API の description 上限（文字数）。超過すると `gh label create` が HTTP 422 で失敗する。 */
export const GITHUB_LABEL_DESCRIPTION_MAX_LENGTH = 100;

/**
 * Issue #439: labels.yaml の description が GitHub Labels API の上限（100文字）を超えていないか
 * を、実際に `gh label create` を呼ぶ前に機械検査する。超過を検出したら該当ラベル名・実文字数を
 * 含む日本語メッセージを返し、labelsStep はどのラベルも適用せずに失敗する（一部だけ適用された
 * 中途半端な状態を避けるため）。
 */
export function validateLabelDescriptions(labels: LabelDef[]): string | undefined {
  const violations = labels.filter((label) => label.description.length > GITHUB_LABEL_DESCRIPTION_MAX_LENGTH);
  if (violations.length === 0) return undefined;
  return violations
    .map(
      (label) =>
        `ラベル '${label.name}' の description が ${label.description.length} 文字あり、GitHub Labels API の上限（${GITHUB_LABEL_DESCRIPTION_MAX_LENGTH} 文字）を超えています`,
    )
    .join('\n');
}

function labelsStep(ownerRepo: string | undefined, cwd: string): { status: number; message: string } {
  const labelsPath = resolveAsset(path.join('templates', 'github', 'provisioning', 'labels.yaml'), cwd);
  const doc = readYamlFile<{ labels: LabelDef[] }>(labelsPath);
  const lengthViolation = validateLabelDescriptions(doc.labels);
  if (lengthViolation) return { status: 1, message: lengthViolation };
  const applied: string[] = [];
  for (const label of doc.labels) {
    const result = gh(
      [
        'label',
        'create',
        label.name,
        '--color',
        label.color,
        '--description',
        label.description,
        '--force',
        ...repoFlag(ownerRepo),
      ],
      cwd,
    );
    if (result.status !== 0) {
      return { status: 1, message: `ラベル '${label.name}' の適用に失敗しました: ${result.stderr.trim()}` };
    }
    applied.push(label.name);
  }
  return { status: 0, message: applied.join(', ') };
}

function rulesetStep(
  ownerRepo: string | undefined,
  cwd: string,
  renderedBody?: string,
): { status: number; message: string } {
  const loaded = renderedBody
    ? { status: 0 as const, body: renderedBody, ruleset: JSON.parse(renderedBody) as RulesetDocument }
    : loadRenderedRuleset(cwd, process.env);
  if (loaded.status !== 0) return loaded;
  const ruleset = loaded.ruleset;
  if (typeof ruleset.name !== 'string' || ruleset.name.length === 0) {
    return { status: 1, message: 'ruleset templateのnameが不正です' };
  }
  const prefix = ownerRepo ? `repos/${ownerRepo}` : 'repos/{owner}/{repo}';

  const list = gh(['api', `${prefix}/rulesets`], cwd);
  if (list.status !== 0) return { status: 1, message: `既存ruleset一覧の取得に失敗しました: ${list.stderr.trim()}` };
  let existingId: number | undefined;
  try {
    const rulesets = JSON.parse(list.stdout) as { id: number; name: string }[];
    existingId = rulesets.find((r) => r.name === ruleset.name)?.id;
  } catch {
    // 空応答等は「未作成」として扱う。
  }

  const apiPath = existingId ? `${prefix}/rulesets/${existingId}` : `${prefix}/rulesets`;
  const method = existingId ? 'PUT' : 'POST';
  const result = gh(['api', '-X', method, apiPath, '--input', '-'], cwd, loaded.body);
  if (result.status !== 0) return { status: 1, message: `ruleset 適用に失敗しました: ${result.stderr.trim()}` };
  return { status: 0, message: result.stdout.trim() };
}

export async function github(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(GITHUB_USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();
    const result = githubBundle(targetDir, dryRun);
    if (result.status !== 0) return fail(result.message);
    return ok(result.message);
  });
}

export async function labels(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(LABELS_USAGE);
      return 0;
    }
    const result = labelsStep(args[0], repoRoot());
    if (result.status !== 0) return fail(result.message);
    return ok(result.message);
  });
}

export async function ruleset(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RULESET_USAGE);
      return 0;
    }
    const result = rulesetStep(args[0], repoRoot());
    if (result.status !== 0) return fail(result.message);
    return ok(result.message);
  });
}
