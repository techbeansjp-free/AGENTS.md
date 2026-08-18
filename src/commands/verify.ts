import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, worktreeRoot, resolveAsset } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { deriveSegmentOrder, loadSegments, type SegmentDefinition } from '../lib/segments.js';
import { parseIssueId, validateSegment, CliError, type Segment } from '../lib/issue.js';
import {
  findIssueWorktree,
  worktreePathRegex,
  branchNameRegex,
  listWorktrees,
  defaultBranch,
  resolveCurrentBranch,
} from '../lib/worktree.js';
import { readYamlFile } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { artifactDigestOf } from '../lib/digest.js';
import { git } from '../lib/exec.js';
import { computeTemplateSyncDiffs } from '../lib/template-sync.js';
import { checkAdrFinalizePath } from '../lib/adr-finalize-guard.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { ROOT_ARTIFACT_FILES } from '../lib/root-artifacts.js';
import {
  QUICK_EXEMPT_OUTPUTS,
  quickBlockedNotice,
  quickUnresolvedNotice,
  resolveQuickMode,
} from '../lib/quick-mode.js';
import { deriveArtifactTargets, type ArtifactTarget } from '../lib/artifact-targets.js';
import { extractSpecAcIds, parseSpecAcDeclarationHeading, type SpecAcDeclaration } from '../lib/spec-ac-ids.js';
import { ABSENT_ARTIFACT_DIGEST } from './gate.js';

function violations(lines: string[]): number {
  if (lines.length === 0) return 0;
  process.stderr.write(`${lines.join('\n')}\n`);
  return 1;
}

// ---- branch-name ----
const BRANCH_NAME_USAGE = `
使い方: agent-skill-chain verify branch-name [branch_name]

出力: 0=適合、1=違反またはスタブ未実装
`;
export async function branchName(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(BRANCH_NAME_USAGE), 0;
    const root = repoRoot();
    const config = loadConfig(root);
    // Issue #185: 判定対象は「現在の作業ツリー（cwd）で実際にチェックアウトされているブランチ」
    // であり、repoRoot()（共通/メイン作業ツリー）ではなくworktreeRoot()（現在の作業ツリー）で
    // 解決する必要がある（ADR-0004）。config（branch.pattern）はコーディネーション同一性の
    // 基点であるrepoRoot()のまま読む。
    const target = args[0] ?? resolveCurrentBranch(worktreeRoot());
    if (target === undefined) {
      return fail(
        '現在のブランチ名を解決できません（detached HEADかつ GITHUB_HEAD_REF 未設定）。branch_name を明示的に指定してください。',
      );
    }
    const regex = branchNameRegex(config);
    if (!regex.test(target)) {
      return violations([`branch '${target}' は branch.pattern（${config.branch.pattern}）に適合しません`]);
    }
    return ok();
  });
}

// ---- worktree-path ----
const WORKTREE_PATH_USAGE = `
使い方: agent-skill-chain verify worktree-path [worktree_path...]

出力: 0=適合、1=違反またはスタブ未実装
`;
export async function worktreePath(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(WORKTREE_PATH_USAGE), 0;
    const root = repoRoot();
    const config = loadConfig(root);
    const regex = worktreePathRegex(config);
    // 引数省略時は git worktree list --porcelain の全entryが対象になるが、その先頭は常に
    // 主worktree（root自身）であり、Issue worktree命名規則には決して適合しないため、
    // 除外しないと1件以上のworktreeが存在する限り必ず違反してしまう。
    const targets =
      args.length > 0 ? args : listWorktrees(root).map((w) => w.path).filter((p) => path.resolve(p) !== path.resolve(root));
    const bad = targets.filter((p) => !regex.test(path.basename(p)));
    return violations(bad.map((p) => `worktree '${p}' は worktree.path_pattern（${config.worktree.path_pattern}）に適合しません`));
  });
}

// ---- doc-length ----
const DOC_LENGTH_USAGE = `
使い方: agent-skill-chain verify doc-length

出力: 0=全対象ファイルが上限以内、1=超過またはスタブ未実装
`;
export async function docLength(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(DOC_LENGTH_USAGE), 0;
    const root = repoRoot();
    const limits: [string, number][] = [[path.join(root, 'AGENTS.md'), 150]];
    const templatesDir = resolveAsset('templates', root);
    for (const rel of [
      path.join(`issue`, 'SPEC.md'),
      path.join(`issue`, 'DESIGN.md'),
      path.join(`issue`, 'PLAN.md'),
      path.join(`issue`, 'VALIDATION.md'),
      path.join('adr', 'ADR.md'),
    ]) {
      const p = path.join(templatesDir, rel);
      if (fs.existsSync(p)) limits.push([p, 100]);
    }
    const bad = limits
      .map(([file, limit]) => ({ file, limit, count: fs.readFileSync(file, 'utf8').split('\n').length }))
      .filter(({ count, limit }) => count > limit);
    return violations(bad.map((b) => `${b.file}: ${b.count}行（上限${b.limit}行を超過）`));
  });
}

// ---- config-doc-sync ----
const CONFIG_DOC_SYNC_USAGE = `
使い方: agent-skill-chain verify config-doc-sync

出力: 0=設定スキーマの全トップレベル項目が文書化済み、1=欠落または読込失敗
`;
export async function configDocSync(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(CONFIG_DOC_SYNC_USAGE), 0;
    const root = worktreeRoot();
    const schemaPath = resolveAsset(path.join('schemas', 'config.schema.yaml'), root);
    const documentPath = path.join(root, 'docs', 'CONFIGURATION.md');
    if (!fs.existsSync(documentPath)) {
      throw new CliError(`設定リファレンスが見つかりません: ${documentPath}`);
    }

    const schema = readYamlFile<{ properties?: Record<string, unknown> }>(schemaPath);
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      throw new CliError(`設定スキーマの properties を読み取れません: ${schemaPath}`);
    }

    const documentedKeys = new Set<string>();
    const headingPattern = /^###\s+`([^`]+)`\s*$/;
    for (const line of fs.readFileSync(documentPath, 'utf8').split(/\r?\n/)) {
      const match = headingPattern.exec(line);
      if (match) documentedKeys.add(match[1]);
    }

    const missingKeys = Object.keys(schema.properties)
      .filter((key) => key !== 'schema_version' && !documentedKeys.has(key))
      .sort();
    return violations(missingKeys.map((key) => `設定リファレンスに見出しがありません: ${key}`));
  });
}

// ---- artifacts ----
const ARTIFACTS_USAGE = `
使い方: agent-skill-chain verify artifacts <issue_id> <segment>
        agent-skill-chain verify artifacts <issue_id> --started-segments <segment[,segment...]>

quick（軽量な変更）の Issue は SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md の存在要求を免除する。
指定方法は GitHub モードでは Issue ラベル 'size:quick'、ローカルモードでは state.yaml の
'size: quick'（既定 standard）。ただし risk が normal 以外の場合、または変更差分に
docs/adr/・.agent-skill-chain/config/segments.yaml・AGENTS.md・.agent-skill-chain/schemas/ が
含まれる場合は免除せず、理由を標準エラー出力へ示したうえで通常どおり成果物を要求する。

出力: 0=対象セグメントの必須成果物は全て存在、1=欠落・不正segment・スタブ未実装
`;
// Issue #200: 「現在存在するか」だけでは、成果物ファイル自体を意図的に削除するIssue
// （本Issue #200のSPEC.md等）を自己言及的に不合格にしてしまう。baseブランチから分岐後の
// コミット履歴上でadd/modifyされた実績があるかをOR条件で加える。git log自体が失敗する場合
// （shallow clone等でdefaultBranchが解決できない等）は安全側（実績なし=false）に倒す。
function wasEverAddedOrModified(worktreePath: string, file: string): boolean {
  try {
    const base = defaultBranch(worktreePath);
    // 2ドット（片側差分）を用いる。3ドット（対称差分）だとbase側にのみ存在する
    // コミットまで含んでしまい、現ブランチが一度も触れていないファイルを誤って
    // 「実績あり」と判定しうるため使わない。
    const log = git(['log', '--diff-filter=AM', '--name-only', `${base}..HEAD`, '--', file], worktreePath);
    return log.status === 0 && log.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function checkOutputExists(worktreePath: string, output: string): boolean {
  switch (output) {
    case 'SPEC.md':
    case 'DESIGN.md':
    case 'PLAN.md':
      return fs.existsSync(path.join(worktreePath, output)) || wasEverAddedOrModified(worktreePath, output);
    case 'ADR': {
      const dir = path.join(worktreePath, 'docs', 'adr');
      return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.md'));
    }
    case 'code': {
      const base = defaultBranch(worktreePath);
      const diff = git(['diff', '--stat', `${base}...HEAD`, '--', '.', ':!docs', ':!SPEC.md', ':!DESIGN.md', ':!PLAN.md', ':!VALIDATION.md'], worktreePath);
      return diff.status === 0 && diff.stdout.trim().length > 0;
    }
    case 'unit_test_results': {
      // Issue #202: 実装セグメント自身の成果物であり、validationセグメント専用の
      // VALIDATION.mdには依存しない。'code'ケースと同一技法（baseブランチとの三点差分）
      // をpathspecのみ test/ に変更して再利用する（ADR-0006）。
      const base = defaultBranch(worktreePath);
      const diff = git(['diff', '--stat', `${base}...HEAD`, '--', 'test'], worktreePath);
      return diff.status === 0 && diff.stdout.trim().length > 0;
    }
    case 'acceptance_test_results':
    case 'regression_test_results':
      // VALIDATION.md（schemas/validation-report.schema.yaml）内に記録される抽象出力。
      // ファイル単体としては存在しないため、VALIDATION.md自体の存在（または履歴上の実績）で
      // 代替確認する。
      return (
        fs.existsSync(path.join(worktreePath, 'VALIDATION.md')) ||
        wasEverAddedOrModified(worktreePath, 'VALIDATION.md')
      );
    default:
      return false;
  }
}

function parseStartedSegments(value: string): Segment[] {
  if (value.trim() === '') return [];
  return value.split(',').map((raw) => {
    const segment = raw.trim();
    validateSegment(segment);
    return segment;
  });
}

function targetSummary(targets: readonly ArtifactTarget[]): string {
  if (targets.length === 0) return '必須成果物検査の対象集合: （空）';
  return [
    '必須成果物検査の対象集合:',
    ...targets.map((target) =>
      target.addedByClosure
        ? `  - ${target.segment}（上流閉包により追加・セグメント未開始）`
        : `  - ${target.segment}（開始済み）`,
    ),
  ].join('\n');
}

function outputsForTarget(definition: SegmentDefinition, quickExempt: boolean): string[] {
  return quickExempt
    ? definition.outputs.filter((output) => !QUICK_EXEMPT_OUTPUTS.includes(output))
    : definition.outputs;
}

export async function artifacts(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(ARTIFACTS_USAGE), 0;
    const [issueIdRaw, selector, selectorValue] = args;
    if (!issueIdRaw || !selector) throw new CliError('issue_id, segment はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);

    const batch = selector === '--started-segments';
    if (batch && (selectorValue === undefined || args.length !== 3)) {
      throw new CliError('--started-segments にはカンマ区切りの開始済みセグメント集合が必要です');
    }
    if (!batch && args.length !== 2) throw new CliError(`不明な引数です: ${args.slice(2).join(' ')}`);
    const startedSegments = batch ? parseStartedSegments(selectorValue as string) : (() => {
      validateSegment(selector);
      return [selector];
    })();

    const root = repoRoot();
    const config = loadConfig(root);
    const entry = findIssueWorktree(root, config, number);
    if (!entry) return fail(`ISSUE-${number} の worktree が見つかりません`);

    const segmentDocument = loadSegments(root);

    if (batch && startedSegments.length === 0) {
      process.stderr.write(`${targetSummary([])}\n`);
      return ok();
    }

    // Issue #425: quick の判定入力はラベル/state.yaml のみで、免除対象である成果物ファイルには
    // 一切依存しない（成果物の中にシグナルを置くと免除が原理的に発動しない循環になるため）。
    const quick = resolveQuickMode(root, entry.path, number, config.coordination.backend);
    if (quick.requested && !quick.exempt) {
      process.stderr.write(`${quickBlockedNotice(quick)}\n`);
    }
    if (!quick.signalResolved) {
      process.stderr.write(`${quickUnresolvedNotice()}\n`);
    }

    if (!batch) {
      const segment = startedSegments[0];
      const def = segmentDocument.segments.find((definition) => definition.id === segment);
      if (!def) return fail(`config/segments.yaml に segment '${segment}' が定義されていません`);
      const outputs = outputsForTarget(def, quick.exempt);
      const missing = outputs.filter((output) => !checkOutputExists(entry.path, output));
      return violations(missing.map((output) => `segment '${segment}' の必須成果物が欠落しています: ${output}`));
    }

    const addUpstreamClosure = quick.signalResolved && !quick.exempt;
    const order = addUpstreamClosure ? deriveSegmentOrder(segmentDocument.segments) : [];
    const targets = deriveArtifactTargets(startedSegments, order, addUpstreamClosure);
    process.stderr.write(`${targetSummary(targets)}\n`);

    const missing: string[] = [];
    for (const target of targets) {
      const def = segmentDocument.segments.find((definition) => definition.id === target.segment);
      if (!def) return fail(`config/segments.yaml に segment '${target.segment}' が定義されていません`);
      for (const output of outputsForTarget(def, quick.exempt)) {
        if (checkOutputExists(entry.path, output)) continue;
        const origin = target.addedByClosure ? '（上流閉包により追加・セグメント未開始）' : '';
        missing.push(`segment '${target.segment}'${origin} の必須成果物が欠落しています: ${output}`);
      }
    }
    return violations(missing);
  });
}

// ---- gate-report ----
const GATE_REPORT_USAGE = `
使い方: agent-skill-chain verify gate-report <gate_report_path>

出力: 0=スキーマ適合かつconformance・falsification記録済み、1=違反・未実装
`;
interface GateReport {
  gate: {
    id: string;
    target_sha: string;
    conformance: string;
    falsification: string;
    final: string;
    blockers: { origin: string }[];
    approved_artifacts: { path: string; digest: string }[];
  };
}
export async function gateReport(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(GATE_REPORT_USAGE), 0;
    const [reportPath] = args;
    if (!reportPath) throw new CliError('gate_report_path は必須です');
    const root = repoRoot();
    const report = readYamlFile<GateReport>(reportPath);
    const outcome = validateAgainstSchema('gate-report', report, root);
    const errors = [...outcome.errors];
    if (report.gate.conformance === 'pending') errors.push('gate.conformance が pending のままです');
    if (report.gate.falsification === 'pending') errors.push('gate.falsification が pending のままです');
    if (report.gate.final === 'pending') errors.push('gate.final が pending のままです');
    // Issue #316: approved_artifactsはreport.gate.target_sha（PRの実際のhead SHA）が指すGit object
    // として検証する。verify-and-publishジョブはprotected base（main）をcheckoutしPR headは
    // working directoryへ反映されないため（PR headはGit objectとしてfetchされるのみ）、
    // worktreeRoot()のファイルシステムを見るとSPEC.md等のIssueスコープ成果物は常に「削除されている」
    // と誤判定される（Issue #185時点の同期的レビューフロー前提がIssue #283/#284後も残っていた）。
    //
    // Issue #316: 上記のgit showベース検証は、target_shaが正当なcommit SHAであることを暗黙の
    // 前提にしている。target_shaが空文字列だと修飾なしのgit show <target_sha>:<path>はGitの
    // index参照（:0:<path>）として解釈されcommit前のstage内容を誤って検証成功させ、HEAD等の
    // ref名だとrev-parse --verifyは成功しつつも後続のgit showがrefの現在の指し先（作業ツリー・
    // 別コミット）を参照してしまう。この前提検査でtarget_shaがcommit objectとして解決可能かつ
    // 40桁16進数であることを要求し、いずれかに失敗したら成果物検証ループへ入らずfail-closedに
    // 拒否する。
    const targetSha = report.gate.target_sha;
    const targetShaResolved = git(['rev-parse', '--verify', `${targetSha}^{commit}`], root);
    if (targetShaResolved.status !== 0 || !/^[0-9a-f]{40}$/.test(targetSha)) {
      errors.push(`gate.target_sha が有効なcommitとして解決できません: ${targetSha}`);
      return violations(errors);
    }
    for (const artifact of report.gate.approved_artifacts) {
      const shown = git(['show', `${report.gate.target_sha}:${artifact.path}`], root);
      if (shown.status !== 0) {
        // Issue #316: implementation gate（gate.tsのallowAbsentがgateId==='implementation'の
        // 場合のみ真であることに対応）に限り、target_shaに実在しない成果物をABSENT_ARTIFACT_DIGEST
        // sentinelで正当に記録しうる。spec/design/validation gateでは証跡生成側がそもそも
        // sentinel digestを持つエントリを生成し得ないため、gate.id以外では例外を適用しない
        // （I8安全側原則。無条件に許容すると「不在の正当な記録」を偽装できてしまう）。
        const sentinelExempt = report.gate.id === 'implementation' && artifact.digest === ABSENT_ARTIFACT_DIGEST;
        if (!sentinelExempt) {
          errors.push(`approved_artifacts のファイルが削除されています（digest不一致として扱います）: ${artifact.path}`);
        }
      } else if (artifactDigestOf(shown.stdout) !== artifact.digest) {
        errors.push(`approved_artifacts の digest が現在のファイル内容と一致しません: ${artifact.path}`);
      }
    }
    return violations(errors);
  });
}

// ---- template-sync ----
const TEMPLATE_SYNC_USAGE = `
使い方: agent-skill-chain verify template-sync [repo_root]

出力: 0=.github/と.claude/agents/は同期済み、1=未同期・スタブ未実装
`;
export async function templateSync(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(TEMPLATE_SYNC_USAGE), 0;
    const targetRoot = args[0] ? path.resolve(args[0]) : process.cwd();
    return violations(computeTemplateSyncDiffs(targetRoot));
  });
}

// ---- root-clean ----
const ROOT_CLEAN_USAGE = `
使い方: agent-skill-chain verify root-clean

repoRoot直下に SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md（Issueセグメント成果物）が
残存していないことのみを確認する単純な存在チェック（Issue #208）。checkOutputExists()/
wasEverAddedOrModified()・segments.yamlには一切関与しない、独立した構造検査。
root-cleanup run（main post-merge cleanup自動化）の事後確認、および
agent-skill-chain-ci.yml の「verify-root-clean (merge-ready)」ステップ（マージ準備完了状態の
PRに対する事前ゲート、ISSUE-590・ADR-0046）の両方から同一ロジックのまま呼ばれる。

出力: 0=対象4ファイルすべて不在、1=いずれか残存
`;
export async function rootClean(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(ROOT_CLEAN_USAGE), 0;
    const root = repoRoot();
    const present = ROOT_ARTIFACT_FILES.filter((f) => fs.existsSync(path.join(root, f)));
    return violations(present.map((f) => `root直下に残存しています: ${f}`));
  });
}

// ---- adr ----
const ADR_USAGE = `
使い方: agent-skill-chain verify adr <adr_path>

出力: 0=ADRはライフサイクル・不変項目を遵守、1=違反・未実装
`;
export async function adr(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(ADR_USAGE), 0;
    const [adrPath] = args;
    if (!adrPath) throw new CliError('adr_path は必須です');
    const text = fs.readFileSync(adrPath, 'utf8');
    const fenceMatch = /```yaml\n([\s\S]*?)```/.exec(text);
    if (!fenceMatch) return violations([`${adrPath}: templates/adr/ADR.md 準拠のyamlフロントマターが見つかりません`]);
    const fm = fenceMatch[1];
    const errors: string[] = [];
    for (const required of ['id:', 'status:', 'supersedes:', 'superseded-by:']) {
      if (!fm.includes(required)) errors.push(`${adrPath}: フロントマターに '${required}' がありません`);
    }
    for (const section of ['## Context', '## Decision', '## Consequences']) {
      if (!text.includes(section)) errors.push(`${adrPath}: 必須セクション '${section}' がありません`);
    }
    const statusMatch = /^status:\s*(\S+)/m.exec(fm);
    if (statusMatch && !['proposed', 'accepted', 'superseded', 'deprecated'].includes(statusMatch[1])) {
      errors.push(`${adrPath}: 不正な status です: ${statusMatch[1]}`);
    }

    // Issue #188 AC-7/AC-8: status: accepted のADRについて、finalize経路（'adr finalize' CLI）を
    // 経ずにacceptedへ遷移したcommitでないかを検査する。ADRのcommit履歴は「現在チェックアウト中の
    // ブランチ」上にあるため、共通/メイン作業ツリーを指す repoRoot() ではなく、現在の作業ツリー
    // （worktreeRoot()）を基点に git log/show を実行する必要がある（ADR-0004と同型の理由。
    // verify branch-name の resolveCurrentBranch(worktreeRoot()) 参照）。
    // gitリポジトリ外（root解決不能）の場合は既存の構造検査のみに留め、本検査は適用しない。
    if (statusMatch?.[1] === 'accepted') {
      try {
        const root = worktreeRoot();
        const relPath = path.relative(root, path.resolve(adrPath));
        errors.push(...checkAdrFinalizePath(root, relPath, text));
      } catch {
        // worktreeRoot()解決不能（.git未検出）等の特殊ケースでは finalize経路ガードを適用しない。
      }
    }

    return violations(errors);
  });
}

// ---- markdown見出しセクション分割（spec-bdd・design-diagram共通） ----
//
// `#{1,6} ` で始まる行を見出しとして、見出し行自体とそれに続く本文行（次の見出し行の直前まで）を
// 1セクションとして返す。見出しの前に本文が無い場合（ファイル先頭）は heading: '' のセクションに
// 集約される（呼び出し側は空heading セクションを無視する）。
interface MdSection {
  heading: string;
  body: string[];
}
function splitMdSections(text: string): MdSection[] {
  const sections: MdSection[] = [{ heading: '', body: [] }];
  for (const line of text.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      sections.push({ heading: line, body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }
  return sections;
}

// `<...>` 形式の未置換プレースホルダ（templates/issue/*.md が使う実際の記法）。
const UNFILLED_PLACEHOLDER_RE = /<([^<>\n]*)>/g;
const TECHNICAL_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function hasUnfilledPlaceholder(value: string): boolean {
  for (const match of value.matchAll(UNFILLED_PLACEHOLDER_RE)) {
    if (!TECHNICAL_TOKEN_RE.test(match[1])) return true;
  }
  return false;
}

// ---- spec-bdd ----
const SPEC_BDD_USAGE = `
使い方: agent-skill-chain verify spec-bdd <spec_md_path>

SPEC.md の各 AC-ID（#### AC-N: ...）について、Given/When/Then/検証方法見込みが
テンプレートのプレースホルダ（<...>）のまま残っていないか、値が空でないかを検査する。
検証方法見込みは automated|manual|hybrid のいずれか（バッククォート囲み可）であることも検査する。

出力: 0=全AC-IDのBDD記載が充足、1=プレースホルダ残存・空欄・AC-ID自体の不在
`;
function extractField(body: string[], label: string): string | undefined {
  const re = new RegExp(`^-\\s*${label}:\\s*(.*)$`);
  for (const line of body) {
    const m = re.exec(line.trim());
    if (m) return m[1].trim();
  }
  return undefined;
}

export async function specBdd(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(SPEC_BDD_USAGE), 0;
    const [specPath] = args;
    if (!specPath) throw new CliError('spec_md_path は必須です');
    if (!fs.existsSync(specPath)) return fail(`${specPath} が見つかりません`);
    const text = fs.readFileSync(specPath, 'utf8');
    const sections = splitMdSections(text);
    const acSections = sections
      .map((s) => ({ ...s, declaration: parseSpecAcDeclarationHeading(s.heading) }))
      .filter((s): s is MdSection & { declaration: SpecAcDeclaration } => s.declaration !== undefined);

    const errors: string[] = [];
    if (acSections.length === 0) {
      errors.push(`${specPath}: AC-ID（#### AC-N: ...）が1つも見つかりません`);
      return violations(errors);
    }
    for (const section of acSections) {
      const { id, summary } = section.declaration;
      if (!summary.trim() || hasUnfilledPlaceholder(summary)) {
        errors.push(`${specPath}: ${id} の要約がプレースホルダのまま、または空です`);
      }
      for (const label of ['Given', 'When', 'Then']) {
        const value = extractField(section.body, label);
        if (value === undefined || !value || hasUnfilledPlaceholder(value)) {
          errors.push(`${specPath}: ${id} の ${label} が未記入またはプレースホルダのままです`);
        }
      }
      const verification = extractField(section.body, '検証方法見込み');
      if (verification === undefined || !verification || hasUnfilledPlaceholder(verification)) {
        errors.push(`${specPath}: ${id} の検証方法見込みが未記入またはプレースホルダのままです`);
      } else if (!/^`?(automated|manual|hybrid)`?$/.test(verification)) {
        errors.push(`${specPath}: ${id} の検証方法見込みは automated|manual|hybrid のいずれかである必要があります: ${verification}`);
      }
    }
    return violations(errors);
  });
}

// ---- design-diagram ----
const DESIGN_DIAGRAM_USAGE = `
使い方: agent-skill-chain verify design-diagram <design_md_path>

DESIGN.md に「### 図示要否の判断」セクションが存在し、判断（要|不要）と根拠が
プレースホルダのまま残らず記載されているかを検査する。判断が「要」の場合は
本文中に少なくとも1つの mermaid コードフェンス（\`\`\`mermaid）が存在することも検査する。
判断自体の妥当性（本当に図が必要か）は人間判断の対象であり本検査は判定しない。

出力: 0=判断根拠が充足（要の場合は図も存在）、1=セクション不在・判断/根拠が未記入
`;
export async function designDiagram(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(DESIGN_DIAGRAM_USAGE), 0;
    const [designPath] = args;
    if (!designPath) throw new CliError('design_md_path は必須です');
    if (!fs.existsSync(designPath)) return fail(`${designPath} が見つかりません`);
    const text = fs.readFileSync(designPath, 'utf8');
    const sections = splitMdSections(text);
    const section = sections.find((s) => /^###\s+図示要否の判断\s*$/.test(s.heading.trimEnd()));

    const errors: string[] = [];
    if (!section) {
      errors.push(`${designPath}: '### 図示要否の判断' セクションが見つかりません`);
      return violations(errors);
    }
    const decision = extractField(section.body, '判断')?.replace(/`/g, '').trim();
    if (decision === undefined || decision === '' || hasUnfilledPlaceholder(decision)) {
      errors.push(`${designPath}: 図示要否の判断（要|不要）が未記入またはプレースホルダのままです`);
    } else if (!['要', '不要'].includes(decision)) {
      errors.push(`${designPath}: 図示要否の判断は '要' または '不要' である必要があります: ${decision}`);
    }
    const reason = extractField(section.body, '根拠');
    if (reason === undefined || !reason || hasUnfilledPlaceholder(reason)) {
      errors.push(`${designPath}: 図示要否の根拠が未記入またはプレースホルダのままです`);
    }
    if (decision === '要' && !/```mermaid/.test(text)) {
      errors.push(`${designPath}: 判断が '要' ですが mermaid コードフェンス（\`\`\`mermaid）が見つかりません`);
    }
    return violations(errors);
  });
}

// ---- ac-coverage ----
const AC_COVERAGE_USAGE = `
使い方: agent-skill-chain verify ac-coverage <issue_id>

出力: 0=全AC-IDの検証方法・証跡が対応済み、1=孤児AC・孤児テスト参照・証跡欠落・未実装
`;
interface ValidationReport {
  acceptance_criteria: { ac_id: string; verification: { mode: string }; evidence: string[] }[];
}
export async function acCoverage(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(AC_COVERAGE_USAGE), 0;
    const [issueIdRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const entry = findIssueWorktree(root, config, number);
    if (!entry) return fail(`ISSUE-${number} の worktree が見つかりません`);

    const specPath = path.join(entry.path, 'SPEC.md');
    const validationPath = path.join(entry.path, 'VALIDATION.md');
    if (!fs.existsSync(specPath)) return fail(`SPEC.md が見つかりません: ${specPath}`);
    if (!fs.existsSync(validationPath)) return fail(`VALIDATION.md が見つかりません: ${validationPath}`);

    const specAcIds = new Set(extractSpecAcIds(fs.readFileSync(specPath, 'utf8')));
    const report = readYamlFile<ValidationReport>(validationPath);
    const outcome = validateAgainstSchema('validation-report', report, root);
    const errors = [...outcome.errors];

    const reportedIds = new Set(report.acceptance_criteria?.map((ac) => ac.ac_id) ?? []);
    for (const acId of specAcIds) {
      if (!reportedIds.has(acId)) errors.push(`孤児AC: ${acId} が VALIDATION.md に対応していません`);
    }
    for (const ac of report.acceptance_criteria ?? []) {
      if (!specAcIds.has(ac.ac_id)) errors.push(`孤児テスト参照: ${ac.ac_id} は SPEC.md に存在しません`);
      if (!ac.evidence || ac.evidence.length === 0) errors.push(`${ac.ac_id}: evidence が空です`);
    }
    return violations(errors);
  });
}
