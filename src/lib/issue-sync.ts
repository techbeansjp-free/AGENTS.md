import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gh, git } from './exec.js';
import { tryReadYamlFile } from './yaml-io.js';
import { reviewFilePath } from './local-state.js';
import { SEGMENTS, type Segment } from './issue.js';
import type { AgentSkillChainConfig } from './config.js';

/**
 * ADR-0021（GitHubモードにおける成果物内容の正本のIssue/PR本文への拡張）の転記処理。
 *
 * 一方向（Git → GitHub Issue/PR 本文）の機械的転記のみを行う。転記結果をゲート判定・検証の
 * 入力として読み戻すことはしない。したがって本モジュールの失敗は呼び出し元の成否を変えず、
 * 理由を返して呼び出し元が警告として出力する。
 */

export const SYNC_BEGIN_MARKER = '<!-- agent-skill-chain:issue-sync:begin (do not edit manually) -->';
export const SYNC_END_MARKER = '<!-- agent-skill-chain:issue-sync:end -->';

/** 転記対象の成果物。4セグメントの主成果物として固定であり設定では変えられない（ADR-0021）。 */
export const SYNC_SOURCE_FILES = ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md'] as const;

const DEFAULT_TARGET: SyncTarget = `issue_body`;
const DEFAULT_MAX_BODY_CHARS = 60000;

/** open な PR 探索の取得上限。1リポジトリのopen PR数として十分な既定値。 */
const PR_LIST_LIMIT = '100';

export type SyncTarget = `issue_body` | `pr_body` | `both`;

export interface SyncTargetRef {
  kind: `issue` | `pr`;
  number: string;
}

export interface RenderInput {
  targetSha: string;
  gateStates: { gate: Segment; final: string }[];
  artifacts: { name: string; content: string }[];
  /** 全文が本文上限に収まらない場合に、Git側参照の案内文へ縮退させる。 */
  overflow: boolean;
  maxBodyChars: number;
}

/** マーカー文字列が成果物本文に含まれていた場合に区間構造が壊れるため、無害な表記へ置き換える。 */
function neutralizeMarkers(text: string): string {
  return text.split(SYNC_BEGIN_MARKER).join('(agent-skill-chain sync marker: begin)')
    .split(SYNC_END_MARKER).join('(agent-skill-chain sync marker: end)');
}

function renderHeader(input: RenderInput): string[] {
  const states = input.gateStates.map((s) => `${s.gate}-gate: ${s.final}`).join(' / ');
  return [
    '## agent-skill-chain 同期セクション（機械生成・手動編集禁止）',
    '',
    `- 最終同期 commit: \`${input.targetSha}\``,
    `- ゲート状態: ${states}`,
  ];
}

/** マーカー区間の中身（マーカー行を含む）を組み立てる。 */
export function renderSyncBlock(input: RenderInput): string {
  const lines = [SYNC_BEGIN_MARKER, '', ...renderHeader(input), ''];
  if (input.overflow) {
    const names = input.artifacts.map((a) => `\`${a.name}\``).join('・');
    lines.push(
      `- 本文上限（${input.maxBodyChars} 文字）を超えるため全文は転記していません。` +
        `全文は ${names || '成果物ファイル'} を Git 側で参照してください（最終同期 commit: \`${input.targetSha}\`）。`,
    );
  } else if (input.artifacts.length === 0) {
    lines.push('- 転記対象の成果物はまだ作成されていません。');
  } else {
    for (const artifact of input.artifacts) {
      lines.push(`### ${artifact.name}（全文）`, '', neutralizeMarkers(artifact.content).trimEnd(), '');
    }
  }
  lines.push(SYNC_END_MARKER);
  return lines.join('\n');
}

/** 本文からマーカー区間（マーカー行を含む）を切り出す。区間が無ければ undefined。 */
export function extractSyncBlock(body: string): string | undefined {
  const start = body.indexOf(SYNC_BEGIN_MARKER);
  if (start === -1) return undefined;
  const end = body.indexOf(SYNC_END_MARKER, start);
  if (end === -1) return undefined;
  return body.slice(start, end + SYNC_END_MARKER.length);
}

/**
 * マーカー区間だけを置換した本文を返す。区間が無い場合は末尾へ新設する。
 * マーカー外の文字列は 1 文字も変更しない。
 */
export function replaceSyncBlock(body: string, block: string): string {
  const start = body.indexOf(SYNC_BEGIN_MARKER);
  const end = start === -1 ? -1 : body.indexOf(SYNC_END_MARKER, start);
  if (start === -1 || end === -1) {
    const base = body.trimEnd();
    return base.length === 0 ? `${block}\n` : `${base}\n\n${block}\n`;
  }
  return body.slice(0, start) + block + body.slice(end + SYNC_END_MARKER.length);
}

function resolveSyncSettings(config: AgentSkillChainConfig): {
  enabled: boolean;
  target: SyncTarget;
  maxBodyChars: number;
} {
  const section = config.issue_sync;
  return {
    enabled: section?.enabled === true && config.coordination.backend === `github`,
    target: section?.target ?? DEFAULT_TARGET,
    maxBodyChars: section?.max_body_chars ?? DEFAULT_MAX_BODY_CHARS,
  };
}

function collectGateStates(root: string, issueNumber: string): { gate: Segment; final: string }[] {
  return SEGMENTS.map((gate) => {
    const record = tryReadYamlFile<{ gate?: { final?: string } }>(
      reviewFilePath(root, issueNumber, gate, `github`),
    );
    return { gate, final: record?.gate?.final ?? '未到達' };
  });
}

function collectArtifacts(root: string, targetSha: string): { name: string; content: string }[] {
  const collected: { name: string; content: string }[] = [];
  for (const name of SYNC_SOURCE_FILES) {
    const shown = git(['show', `${targetSha}:${name}`], root);
    if (shown.status === 0 && shown.stdout.trim().length > 0) {
      collected.push({ name, content: shown.stdout });
    }
  }
  return collected;
}

interface OpenPullRequest {
  number?: number;
  body?: string | null;
  headRefName?: string | null;
}

/**
 * 当該Issueに紐づく open な PR を探す。PR本文の close 参照と head ブランチ名の命名規則の
 * 2 経路で判定し、一意に定まらない場合（0件・複数件）は転記対象にしない（ADR-0021）。
 */
export function selectUniqueOpenPr(
  pulls: OpenPullRequest[],
  issueNumber: string,
): { number?: string; reason?: string } {
  const closeRe = new RegExp(`\\b(closes|close|closed|fixes|fix|fixed|resolves|resolve|resolved)\\s+#${issueNumber}\\b`, 'i');
  const branchRe = new RegExp(`^[a-z]+/${issueNumber}-`);
  const matched = pulls.filter((pull) => {
    if (typeof pull.number !== 'number') return false;
    if (typeof pull.body === 'string' && closeRe.test(pull.body)) return true;
    return typeof pull.headRefName === 'string' && branchRe.test(pull.headRefName);
  });
  if (matched.length === 1) return { number: String(matched[0].number) };
  return {
    reason:
      matched.length === 0
        ? `ISSUE-${issueNumber} に紐づく open な PR が見つからないため PR 本文への転記をスキップします`
        : `ISSUE-${issueNumber} に紐づく open な PR が ${matched.length} 件あり一意に定まらないため PR 本文への転記をスキップします`,
  };
}

function listOpenPulls(root: string): { pulls?: OpenPullRequest[]; error?: string } {
  const result = gh(
    ['pr', 'list', '--state', 'open', '--json', 'number,body,headRefName', '--limit', PR_LIST_LIMIT],
    root,
  );
  if (result.status !== 0) return { error: `open な PR の一覧取得に失敗しました: ${result.stderr.trim()}` };
  try {
    const parsed = JSON.parse(result.stdout) as OpenPullRequest[];
    return { pulls: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { error: 'open な PR の一覧応答を解釈できませんでした' };
  }
}

function readBody(root: string, ref: SyncTargetRef): { body?: string; error?: string } {
  const command = ref.kind === `pr` ? 'pr' : `issue`;
  const result = gh([command, 'view', ref.number, '--json', 'body'], root);
  if (result.status !== 0) return { error: `本文の取得に失敗しました: ${result.stderr.trim()}` };
  try {
    const parsed = JSON.parse(result.stdout) as { body?: string | null };
    return { body: typeof parsed.body === 'string' ? parsed.body : '' };
  } catch {
    return { error: '本文の取得応答を解釈できませんでした' };
  }
}

function writeBody(root: string, ref: SyncTargetRef, body: string): string | undefined {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-body-sync-'));
  const bodyFile = path.join(dir, 'body.md');
  try {
    fs.writeFileSync(bodyFile, body, 'utf8');
    const command = ref.kind === `pr` ? 'pr' : `issue`;
    const result = gh([command, 'edit', ref.number, '--body-file', bodyFile], root);
    if (result.status !== 0) return `本文の書込みに失敗しました: ${result.stderr.trim()}`;
    return undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 読み直し比較による compare-and-swap 相当の競合検知つき書込み。
 *
 * GitHub は本文更新に前提バージョンを指定する手段を提供しないため、書込み直前に本文を読み直し、
 * 直前に観測したマーカー区間と一致するかを比較する。不一致なら 1 回だけ取り直してやり直し、
 * それでも不一致なら書込まずスキップする（次のゲート通過時に最新内容で再転記される）。
 */
function writeWithConflictDetection(
  root: string,
  ref: SyncTargetRef,
  block: string,
  maxBodyChars: number,
  renderOverflow: () => string,
): string[] {
  const notes: string[] = [];
  const initial = readBody(root, ref);
  if (initial.error) return [`${ref.kind} #${ref.number}: ${initial.error}`];

  let current = initial.body ?? '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const observed = extractSyncBlock(current);
    let nextBody = replaceSyncBlock(current, block);
    if (nextBody.length > maxBodyChars) {
      nextBody = replaceSyncBlock(current, renderOverflow());
      notes.push(
        `${ref.kind} #${ref.number}: 本文が上限 ${maxBodyChars} 文字を超えるため全文ではなく Git 側参照の案内文を転記します`,
      );
    }
    if (nextBody === current) {
      notes.push(`${ref.kind} #${ref.number}: 転記内容に変化が無いため書込みを省略しました`);
      return notes;
    }

    const reread = readBody(root, ref);
    if (reread.error) {
      notes.push(`${ref.kind} #${ref.number}: ${reread.error}`);
      return notes;
    }
    const rereadBody = reread.body ?? '';
    if (extractSyncBlock(rereadBody) !== observed) {
      if (attempt === 1) {
        current = rereadBody;
        continue;
      }
      notes.push(
        `${ref.kind} #${ref.number}: 書込み直前に本文が別プロセスから更新されたため転記をスキップしました（再取得後も不一致）`,
      );
      return notes;
    }

    const error = writeBody(root, ref, nextBody);
    if (error) notes.push(`${ref.kind} #${ref.number}: ${error}`);
    return notes;
  }
  return notes;
}

/**
 * ゲート通過時の転記本体。有効でない場合は何もせず空配列を返す。
 * 戻り値は警告・スキップ理由のメッセージ列であり、呼び出し元の成否は変えない。
 */
export function syncGateArtifacts(params: {
  root: string;
  issueNumber: string;
  config: AgentSkillChainConfig;
  targetSha: string;
}): string[] {
  const { root, issueNumber, config, targetSha } = params;
  const settings = resolveSyncSettings(config);
  if (!settings.enabled) return [];

  const gateStates = collectGateStates(root, issueNumber);
  const artifacts = collectArtifacts(root, targetSha);
  const base: Omit<RenderInput, 'overflow'> = {
    targetSha,
    gateStates,
    artifacts,
    maxBodyChars: settings.maxBodyChars,
  };
  const block = renderSyncBlock({ ...base, overflow: false });
  const renderOverflow = (): string => renderSyncBlock({ ...base, overflow: true });

  const notes: string[] = [];
  const refs: SyncTargetRef[] = [];
  if (settings.target === `issue_body` || settings.target === `both`) {
    refs.push({ kind: `issue`, number: issueNumber });
  }
  if (settings.target === `pr_body` || settings.target === `both`) {
    const listed = listOpenPulls(root);
    if (listed.error) {
      notes.push(listed.error);
    } else {
      const selected = selectUniqueOpenPr(listed.pulls ?? [], issueNumber);
      if (selected.number) refs.push({ kind: `pr`, number: selected.number });
      else if (selected.reason) notes.push(selected.reason);
    }
  }

  for (const ref of refs) {
    notes.push(...writeWithConflictDetection(root, ref, block, settings.maxBodyChars, renderOverflow));
  }
  return notes;
}
