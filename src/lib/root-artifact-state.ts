import { ROOT_ARTIFACT_FILES, type RootArtifactFile } from './root-artifacts.js';

/**
 * root成果物（`ROOT_ARTIFACT_FILES`）の3状態区分（ADR-0080）。相互排他かつ網羅的であり、
 * 対象4ファイルは必ずいずれか1つへ落ちる。
 *
 * - `deletable`: HEAD に存在し、作業ツリーにも index にも HEAD と異なる内容を持たない。
 *   作業ツリー上に実体がある場合と、起動時点で既に取り除かれている場合（index へ未記録の削除・
 *   index へ記録済みの削除の双方）を含む。削除によって失われる内容が無く HEAD から復元できる
 *   ため、不在は「HEAD と異なる内容」に当たらない。
 * - `content_loss_risk`: Git から復元できない内容を持つ。削除せず停止する側へ倒す。
 * - `absent`: 作業ツリー・index・HEAD のいずれにも存在しない。
 */
export type RootArtifactState = 'deletable' | 'content_loss_risk' | 'absent';

export interface RootArtifactStateEntry {
  file: RootArtifactFile;
  state: RootArtifactState;
  /** index にエントリが存在するか（`deletable` の削除手段の選択に使う）。 */
  inIndex: boolean;
  /** `content_loss_risk` へ倒した理由（日本語）。他の状態では undefined。 */
  reason?: string;
}

/**
 * 分類の入力。いずれも git の機械可読な観測結果そのものであり、解釈は本モジュール内で完結する
 * （解析失敗を呼び出し元へ漏らさず fail-closed で `content_loss_risk` へ倒すため）。
 */
export interface RootArtifactGitObservation {
  /** `git ls-tree HEAD -z -- <対象4ファイル>` の生出力。 */
  headTree: string;
  /** `git ls-files --stage -z -- <対象4ファイル>` の生出力。 */
  index: string;
  /** `git status --porcelain=v2 -z --untracked-files=all` の生出力。 */
  status: string;
}

interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
}

interface IndexEntry {
  mode: string;
  oid: string;
  stage: number;
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };

const TARGETS = new Set<string>(ROOT_ARTIFACT_FILES);

/** NUL 区切りのレコード列を分解する。末尾の空要素（終端 NUL の副産物）は落とす。 */
export function splitNulRecords(raw: string): string[] {
  const parts = raw.split('\0');
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** `git ls-tree <tree> -z` の1レコード `<mode> SP <type> SP <oid> TAB <path>` を読む。 */
function parseTreeOutput(raw: string): ParseOutcome<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>();
  for (const record of splitNulRecords(raw)) {
    const tab = record.indexOf('\t');
    if (tab < 0) return { ok: false, reason: `git ls-tree の出力を解釈できません: ${record}` };
    const head = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    if (head.length !== 3) return { ok: false, reason: `git ls-tree の出力を解釈できません: ${record}` };
    entries.set(filePath, { mode: head[0], type: head[1], oid: head[2] });
  }
  return { ok: true, value: entries };
}

/** `git ls-files --stage -z` の1レコード `<mode> SP <oid> SP <stage> TAB <path>` を読む。 */
function parseIndexOutput(raw: string): ParseOutcome<Map<string, IndexEntry[]>> {
  const entries = new Map<string, IndexEntry[]>();
  for (const record of splitNulRecords(raw)) {
    const tab = record.indexOf('\t');
    if (tab < 0) return { ok: false, reason: `git ls-files --stage の出力を解釈できません: ${record}` };
    const head = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    if (head.length !== 3) return { ok: false, reason: `git ls-files --stage の出力を解釈できません: ${record}` };
    const stage = Number(head[2]);
    if (!Number.isInteger(stage)) {
      return { ok: false, reason: `git ls-files --stage の stage を解釈できません: ${record}` };
    }
    const list = entries.get(filePath) ?? [];
    list.push({ mode: head[0], oid: head[1], stage });
    entries.set(filePath, list);
  }
  return { ok: true, value: entries };
}

interface StatusScan {
  /** 対象パスごとの、作業ツリー側で HEAD と異なる内容を伴う変化の理由。 */
  worktreeRisk: Map<string, string>;
}

/**
 * `git status --porcelain=v2 -z --untracked-files=all` を読む。`2`（改名・複製）レコードは
 * NUL 区切りの追加フィールドとして改名元パスを持つため、1レコードで2要素を消費する。
 * 解釈できないレコードを1件でも見つけた場合は、どの対象ファイルに関わるかを特定できないため
 * 解析全体を失敗させ、呼び出し元が対象4ファイルすべてを fail-closed で倒せるようにする。
 */
function parseStatusOutput(raw: string): ParseOutcome<StatusScan> {
  const worktreeRisk = new Map<string, string>();
  const records = splitNulRecords(raw);
  const markIfTarget = (filePath: string, reason: string): void => {
    if (TARGETS.has(filePath)) worktreeRisk.set(filePath, reason);
  };

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record === '') continue;
    const kind = record[0];

    if (kind === '#') continue;

    if (kind === '?') {
      if (record[1] !== ' ') return { ok: false, reason: `git status のレコードを解釈できません: ${record}` };
      markIfTarget(record.slice(2), '未追跡のファイルとして作業ツリーに存在します');
      continue;
    }

    if (kind === '!') {
      if (record[1] !== ' ') return { ok: false, reason: `git status のレコードを解釈できません: ${record}` };
      markIfTarget(record.slice(2), '無視対象のファイルとして作業ツリーに存在します');
      continue;
    }

    if (kind === '1') {
      const fields = record.split(' ');
      if (fields.length < 9 || fields[1].length !== 2) {
        return { ok: false, reason: `git status のレコードを解釈できません: ${record}` };
      }
      const worktreeStatus = fields[1][1];
      const filePath = fields.slice(8).join(' ');
      // `.`（作業ツリーは index と一致）と `D`（作業ツリーから取り除かれている）以外は、
      // 内容・mode・型のいずれかが HEAD と異なる状態であるため停止側へ倒す。
      if (worktreeStatus !== '.' && worktreeStatus !== 'D') {
        markIfTarget(filePath, `作業ツリーの内容が HEAD と異なります（git status: ${fields[1]}）`);
      }
      continue;
    }

    if (kind === '2') {
      const fields = record.split(' ');
      const origPath = records[i + 1];
      if (fields.length < 10 || fields[1].length !== 2 || origPath === undefined) {
        return { ok: false, reason: `git status のレコードを解釈できません: ${record}` };
      }
      i += 1;
      const filePath = fields.slice(9).join(' ');
      markIfTarget(filePath, '改名・複製の対象になっています');
      markIfTarget(origPath, '改名・複製の対象になっています');
      continue;
    }

    if (kind === 'u') {
      const fields = record.split(' ');
      if (fields.length < 11) return { ok: false, reason: `git status のレコードを解釈できません: ${record}` };
      markIfTarget(fields.slice(10).join(' '), '未マージのエントリです');
      continue;
    }

    return { ok: false, reason: `git status の未知のレコード種別です: ${record}` };
  }

  return { ok: true, value: { worktreeRisk } };
}

function allAtRisk(reason: string): RootArtifactStateEntry[] {
  return ROOT_ARTIFACT_FILES.map((file) => ({ file, state: 'content_loss_risk' as const, inIndex: false, reason }));
}

/**
 * 対象4ファイルを3状態区分へ写像する純関数（ADR-0080 の判定順序）。決定表を上から1回だけ
 * 評価し、最初に成立した区分を確定させる。
 *
 * fail-closed: 解釈できない git 出力・未マージエントリ・非 blob エントリ・HEAD と一致しない
 * blob OID または file mode は、すべて `content_loss_risk` へ倒す。復元可能性の担保を成功条件
 * ではなく停止条件として置くためであり、削除して失う側ではなく停止する側を既定にする。
 */
export function classifyRootArtifacts(observation: RootArtifactGitObservation): RootArtifactStateEntry[] {
  const headOutcome = parseTreeOutput(observation.headTree);
  if (!headOutcome.ok) return allAtRisk(headOutcome.reason);
  const indexOutcome = parseIndexOutput(observation.index);
  if (!indexOutcome.ok) return allAtRisk(indexOutcome.reason);
  const statusOutcome = parseStatusOutput(observation.status);
  if (!statusOutcome.ok) return allAtRisk(statusOutcome.reason);

  const head = headOutcome.value;
  const index = indexOutcome.value;
  const { worktreeRisk } = statusOutcome.value;

  return ROOT_ARTIFACT_FILES.map((file) => {
    const headEntry = head.get(file);
    const indexEntries = index.get(file) ?? [];
    const inIndex = indexEntries.length > 0;
    const risk = (reason: string): RootArtifactStateEntry => ({
      file,
      state: 'content_loss_risk',
      inIndex,
      reason,
    });

    const worktreeReason = worktreeRisk.get(file);
    if (worktreeReason) return risk(worktreeReason);
    if (indexEntries.length > 1 || indexEntries.some((entry) => entry.stage !== 0)) {
      return risk('index に未マージのエントリがあります');
    }
    if (headEntry && headEntry.type !== 'blob') {
      return risk(`HEAD のエントリが通常ファイルではありません（type: ${headEntry.type}）`);
    }
    if (indexEntries.length === 1) {
      const staged = indexEntries[0];
      if (!headEntry) return risk('HEAD に存在せず index にのみ存在します');
      if (staged.oid !== headEntry.oid) return risk('index の内容が HEAD と異なります');
      if (staged.mode !== headEntry.mode) return risk('index の file mode が HEAD と異なります');
    }
    if (headEntry) return { file, state: 'deletable', inIndex };
    return { file, state: 'absent', inIndex };
  });
}

export { ROOT_ARTIFACT_FILES };
export type { RootArtifactFile };
