import { parse as parseYaml } from 'yaml';
import { loadConfig, type AgentSkillChainConfig } from './config.js';
import { artifactDigestOf } from './digest.js';
import { git, gitBytes } from './exec.js';
import type { Segment } from './issue.js';

export const DEFAULT_PROMPT_MAX_INPUT_BYTES = 1_500_000;
const CONFIG_PATH = '.agent-skill-chain/config/agent-skill-chain.yaml';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface PromptInputFile {
  path: string;
  bytes: number;
  digest: string;
  content: Buffer;
  text?: string;
  nonText: boolean;
}

export interface ResolvedPromptInput {
  path: string;
  file?: PromptInputFile;
}

export interface ReviewerPromptInputs {
  targetArtifacts: ResolvedPromptInput[];
  upstreamArtifacts: ResolvedPromptInput[];
  constitution: ResolvedPromptInput[];
  evidenceFiles: PromptInputFile[];
  adrDerivationUnavailable: boolean;
}

export interface OmittedPromptInput {
  file: PromptInputFile;
  reason: '非テキスト' | '予算超過';
}

export interface ClassifiedEvidenceFiles {
  expanded: Array<PromptInputFile & { renderBytes: number }>;
  omitted: OmittedPromptInput[];
  usedBytes: number;
}

export interface PromptBudgetMetrics {
  limit: number;
  mandatoryBytes: number;
  listReservationBytes: number;
  evidenceBudgetBytes: number;
  candidateCount: number;
}

function decodeUtf8(content: Buffer): string | undefined {
  if (content.includes(0)) return undefined;
  try {
    return UTF8_DECODER.decode(content);
  } catch {
    return undefined;
  }
}

function readPromptInput(root: string, targetSha: string, inputPath: string): ResolvedPromptInput {
  const result = gitBytes(['show', `${targetSha}:${inputPath}`], root);
  if (result.status !== 0) return { path: inputPath };
  const text = decodeUtf8(result.stdout);
  return {
    path: inputPath,
    file: {
      path: inputPath,
      bytes: result.stdout.byteLength,
      digest: artifactDigestOf(result.stdout),
      content: result.stdout,
      ...(text === undefined ? {} : { text }),
      nonText: text === undefined,
    },
  };
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function changedAdrPaths(root: string, baseSha: string, targetSha: string): string[] {
  const result = git(['diff', '--name-only', '-z', '--find-renames', `${baseSha}...${targetSha}`, '--', 'docs/adr/'], root);
  if (result.status !== 0) {
    throw new Error(`当該IssueのADR集合を取得できません: ${result.stderr.trim()}`);
  }
  const paths = result.stdout.split('\0');
  if (paths.at(-1) === '') paths.pop();
  return unique(paths.filter((entry) => entry.startsWith('docs/adr/')));
}

function targetTreePaths(root: string, targetSha: string): string[] {
  const result = git(['ls-tree', '-r', '--name-only', '-z', targetSha], root);
  if (result.status !== 0) throw new Error(`target SHAのツリーを取得できません: ${result.stderr.trim()}`);
  const paths = result.stdout.split('\0');
  if (paths.at(-1) === '') paths.pop();
  return paths;
}

const PATH_MENTION_LEFT_BOUNDARY = /[\s"'`([{<（［｛〈《「『【〔]/u;
const PATH_MENTION_RIGHT_BOUNDARY = /[\s"'`)\]}>、。，．,;；:：!?！？）］｝〉》」』】〕]/u;

/** リポジトリ相対パスを、別パスの部分文字列ではなく独立した名指しとして照合する。 */
function containsExactPathMention(sourceText: string, candidatePath: string): boolean {
  let offset = sourceText.indexOf(candidatePath);
  while (offset >= 0) {
    const before = offset === 0 ? undefined : sourceText[offset - 1];
    const end = offset + candidatePath.length;
    const after = end === sourceText.length ? undefined : sourceText[end];
    const leftIsBoundary = before === undefined || PATH_MENTION_LEFT_BOUNDARY.test(before);
    const rightIsBoundary = after === undefined || PATH_MENTION_RIGHT_BOUNDARY.test(after);
    if (leftIsBoundary && rightIsBoundary) return true;
    offset = sourceText.indexOf(candidatePath, offset + 1);
  }
  return false;
}

/** gate_id別の固定表から、必須入力と1段だけの根拠ファイル集合を解決する。 */
export function resolveReviewerPromptInputs(options: {
  root: string;
  gateId: Segment;
  targetSha: string;
  baseSha?: string;
  targetArtifactPaths: readonly string[];
}): ReviewerPromptInputs {
  const adrPaths = options.baseSha ? changedAdrPaths(options.root, options.baseSha, options.targetSha) : [];
  const upstreamPaths =
    options.gateId === 'spec'
      ? []
      : options.gateId === 'design'
        ? ['SPEC.md']
        : ['SPEC.md', 'DESIGN.md', 'PLAN.md', ...adrPaths];
  const extractionSourcePaths =
    options.gateId === 'spec'
      ? ['SPEC.md']
      : options.gateId === 'design'
        ? [...options.targetArtifactPaths, 'SPEC.md']
        : options.gateId === 'implementation'
          ? upstreamPaths
          : ['VALIDATION.md', ...upstreamPaths];

  const targetArtifacts = options.targetArtifactPaths.map((entry) =>
    readPromptInput(options.root, options.targetSha, entry),
  );
  const upstreamArtifacts = unique(upstreamPaths).map((entry) =>
    readPromptInput(options.root, options.targetSha, entry),
  );
  const constitution = [readPromptInput(options.root, options.targetSha, 'AGENTS.md')];
  const requiredPaths = new Set(
    unique([
      ...targetArtifacts.map((entry) => entry.path),
      ...upstreamArtifacts.map((entry) => entry.path),
      ...constitution.map((entry) => entry.path),
    ]),
  );
  const sourceText = unique(extractionSourcePaths)
    .map((entry) => readPromptInput(options.root, options.targetSha, entry).file?.text ?? '')
    .join('\n');
  const evidenceFiles = targetTreePaths(options.root, options.targetSha)
    .filter((entry) => !requiredPaths.has(entry) && containsExactPathMention(sourceText, entry))
    .map((entry) => readPromptInput(options.root, options.targetSha, entry).file)
    .filter((entry): entry is PromptInputFile => entry !== undefined);

  return {
    targetArtifacts,
    upstreamArtifacts,
    constitution,
    evidenceFiles,
    adrDerivationUnavailable: !options.baseSha && options.gateId !== 'spec',
  };
}

/** prompt生成用設定を作業ツリーではなくtarget SHAの設定blobだけから解決する。 */
export function resolveReviewerPromptConfig(root: string, targetSha: string): AgentSkillChainConfig | undefined {
  const result = gitBytes(['show', `${targetSha}:${CONFIG_PATH}`], root);
  if (result.status !== 0) return undefined;
  const text = decodeUtf8(result.stdout);
  if (text === undefined) throw new Error(`${CONFIG_PATH} のtarget SHA blobはUTF-8テキストである必要があります`);
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new Error(`${CONFIG_PATH} のtarget SHA blobを解釈できません: ${(error as Error).message}`);
  }
  return loadConfig(root, parsed) as AgentSkillChainConfig;
}

/** 上限値を作業ツリーではなくtarget SHAの設定blobだけから解決する。 */
export function resolvePromptInputLimit(root: string, targetSha: string): number {
  return resolveReviewerPromptConfig(root, targetSha)?.review.prompt_max_input_bytes ?? DEFAULT_PROMPT_MAX_INPUT_BYTES;
}

export function formatPromptInputPath(inputPath: string): string {
  return JSON.stringify(inputPath).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function expandedInputListLine(file: PromptInputFile): string {
  return `- ${formatPromptInputPath(file.path)} | ${file.bytes} B | ${file.digest}`;
}

export function omittedInputListLine(entry: OmittedPromptInput): string {
  return `${expandedInputListLine(entry.file)} | 理由: ${entry.reason}`;
}

function insertedLineBytes(line: string): number {
  return Buffer.byteLength(`\n${line}`, 'utf8');
}

/** 分類前でも一覧が上限内へ収まるよう、各候補について長い方の行形式を予約する。 */
export function reserveInputListBytes(
  requiredFiles: readonly PromptInputFile[],
  evidenceFiles: readonly PromptInputFile[],
): number {
  let bytes = insertedLineBytes('- (なし)') * 2;
  for (const file of [...requiredFiles, ...evidenceFiles]) {
    const expanded = insertedLineBytes(expandedInputListLine(file));
    const omittedNonText = insertedLineBytes(omittedInputListLine({ file, reason: '非テキスト' }));
    const omittedBudget = insertedLineBytes(omittedInputListLine({ file, reason: '予算超過' }));
    bytes += Math.max(expanded, omittedNonText, omittedBudget);
  }
  return bytes;
}

/** 日本語メタデータにM自身を表示するため、桁数が安定するまで必須区間を固定点計算する。 */
export function resolvePromptBudget(options: {
  limit: number;
  listReservationBytes: number;
  candidateCount: number;
  renderMandatory: (metrics: PromptBudgetMetrics) => string;
}): PromptBudgetMetrics {
  let mandatoryBytes = 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const evidenceBudgetBytes = Math.max(0, options.limit - mandatoryBytes - options.listReservationBytes);
    const metrics: PromptBudgetMetrics = {
      limit: options.limit,
      mandatoryBytes,
      listReservationBytes: options.listReservationBytes,
      evidenceBudgetBytes,
      candidateCount: options.candidateCount,
    };
    const next = Buffer.byteLength(options.renderMandatory(metrics), 'utf8');
    if (next === mandatoryBytes) {
      if (mandatoryBytes + options.listReservationBytes > options.limit) {
        throw new Error(
          `判定プロンプトの必須区間と一覧予約が上限を超えました` +
            `（M=${mandatoryBytes} B, L=${options.listReservationBytes} B, 候補件数=${options.candidateCount}, 上限=${options.limit} B）。` +
            '対象Issueを分割するか、target SHAのreview.prompt_max_input_bytesを引き上げてcommit後に再実行してください。',
        );
      }
      return metrics;
    }
    mandatoryBytes = next;
  }
  throw new Error('判定プロンプトの必須区間レンダー長Mを安定して算出できません');
}

/** 非テキストを先に除外し、残るテキストを走査順の先着適合で分類する。 */
export function classifyEvidenceFiles(
  files: readonly PromptInputFile[],
  budgetBytes: number,
  renderBytes: (file: PromptInputFile) => number,
): ClassifiedEvidenceFiles {
  const expanded: ClassifiedEvidenceFiles['expanded'] = [];
  const omitted: OmittedPromptInput[] = [];
  let remaining = budgetBytes;
  let usedBytes = 0;
  for (const file of files) {
    if (file.nonText) {
      omitted.push({ file, reason: '非テキスト' });
      continue;
    }
    const bytes = renderBytes(file);
    if (bytes > remaining) {
      omitted.push({ file, reason: '予算超過' });
      continue;
    }
    expanded.push({ ...file, renderBytes: bytes });
    remaining -= bytes;
    usedBytes += bytes;
  }
  return { expanded, omitted, usedBytes };
}

export function assertPromptWithinLimit(prompt: string, metrics: PromptBudgetMetrics): void {
  const actual = Buffer.byteLength(prompt, 'utf8');
  if (actual > metrics.limit) {
    throw new Error(
      `完成した判定プロンプトが上限を超えました` +
        `（実測=${actual} B, M=${metrics.mandatoryBytes} B, L=${metrics.listReservationBytes} B, ` +
        `候補件数=${metrics.candidateCount}, 上限=${metrics.limit} B）。` +
        '対象Issueを分割するか、target SHAのreview.prompt_max_input_bytesを引き上げてcommit後に再実行してください。',
    );
  }
}
