import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './issue.js';

export interface CopyResult {
  path: string;
  action: 'created' | 'unchanged' | 'overwritten';
  /** true の場合、実際にはファイルシステムへ書き込まれていない（`dryRun: true` で算出した予定）。 */
  planned?: boolean;
}

export interface CopyOptions {
  /** true の場合、衝突検知・戻り値算出は通常どおり行うが、ファイルシステムへは一切書き込まない。 */
  dryRun?: boolean;
  /**
   * 信頼境界となるディレクトリ（導入先リポジトリのルート）。`dest` はこの配下でなければならず、
   * 境界から `dest` までの中間componentもsymlink非追従で検査・生成する。省略時は `dest` の親を
   * 境界とみなす（境界より上の既存祖先ディレクトリは管理対象外）。
   */
  root?: string;
  /**
   * @internal
   * 検査後置換（TOCTOU）に対する防御を自動検証するための注入点。検査完了後・書込み開始前に呼ばれる。
   */
  onPlanComplete?: () => void;
}

/** ファイル実体の同一性。検査時と書込み時で同じ実体を触っているかの判定に使う。 */
interface Identity {
  dev: bigint;
  ino: bigint;
}

type CopyPolicy = 'fail-on-conflict' | 'mirror';

interface DirStep {
  kind: 'dir';
  dest: string;
  display: string;
  /** 信頼境界そのもの。境界より上の祖先は管理対象外のため recursive で作成してよい。 */
  boundary: boolean;
  identity: Identity | null;
}

interface FileStep {
  kind: 'file';
  src: string;
  dest: string;
  display: string;
  action: 'created' | 'unchanged' | 'overwritten';
  srcIdentity: Identity;
  srcMode: number;
  parent: string;
  parentIdentity: Identity | null;
}

type CopyStep = DirStep | FileStep;

function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * symlinkを追従しないopenが使えない実行環境では、暗黙に追従して境界外へ書き込むより中断する方が安全。
 */
function noFollowFlag(): number {
  const flag = fs.constants.O_NOFOLLOW;
  if (typeof flag !== 'number' || flag === 0) {
    throw new CliError(
      'この実行環境ではsymlinkを追従しないファイル操作（O_NOFOLLOW）が利用できないため、' +
        '導入先を安全に検査できません（対応外環境として展開を中断しました）。',
    );
  }
  return flag;
}

function identityOf(stat: fs.BigIntStats): Identity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function lstatOrNull(target: string): fs.BigIntStats | null {
  try {
    return fs.lstatSync(target, { bigint: true });
  } catch (error) {
    const code = errnoOf(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

type Origin = 'source' | 'dest';

function originLabel(origin: Origin): string {
  return origin === 'source' ? '配布元' : '導入先';
}

function symlinkRejected(display: string, origin: Origin = 'dest'): CliError {
  return new CliError(
    `${originLabel(origin)}にsymlinkがあるため展開を中断しました: ${display}` +
      '（リンク先へは読み書きしません。symlinkを解消してから再実行してください）',
  );
}

function replacedDuringCopy(display: string, origin: Origin = 'dest'): CliError {
  return new CliError(
    `検査後に${originLabel(origin)}が置き換えられたため展開を中断しました: ${display}` +
      '（別の処理が同じパスを操作しています。状態を確認してから再実行してください）',
  );
}

/**
 * 信頼境界の絶対パスを求める。境界そのものは呼び出し側が指定した導入先であり、境界より上の
 * 祖先ディレクトリは管理対象外なので realpath で解決してよい（一時ディレクトリの親がsymlinkで
 * ある環境でも正しく動くために必要）。存在しない末端componentはそのまま連結する。
 */
function canonicalizeBoundary(boundary: string): string {
  const missing: string[] = [];
  let existing = boundary;
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...missing);
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') {
        throw new CliError(`導入先のルートを解決できないため展開を中断しました: ${boundary}（${messageOf(error)}）`);
      }
      const parent = path.dirname(existing);
      if (parent === existing) {
        throw new CliError(`導入先のルートを解決できないため展開を中断しました: ${boundary}`);
      }
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

interface Boundary {
  /** 信頼境界の実パス（祖先のsymlinkを解決済み）。 */
  boundary: string;
  /** 信頼境界の表示用パス（利用者が指定したパスのまま）。 */
  boundaryDisplay: string;
  /** 信頼境界から配布先までのcomponent列。 */
  components: string[];
}

function resolveBoundary(dest: string, root: string | undefined): Boundary {
  const destRaw = path.resolve(dest);
  const rootRaw = root === undefined ? path.dirname(destRaw) : path.resolve(root);
  const relative = path.relative(rootRaw, destRaw);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new CliError(
      `配布先が導入先ルートの外を指しているため展開を中断しました: ${dest}（ルート: ${rootRaw}）`,
    );
  }
  return {
    boundary: canonicalizeBoundary(rootRaw),
    boundaryDisplay: rootRaw,
    components: relative === '' ? [] : relative.split(path.sep),
  };
}

/** symlinkを追従せずに読み込む。検査時と同じ実体であることも確認する。 */
function readNoFollow(target: string, display: string, expected: Identity, origin: Origin): Buffer {
  const flags = fs.constants.O_RDONLY | noFollowFlag();
  let fd: number;
  try {
    fd = fs.openSync(target, flags);
  } catch (error) {
    if (errnoOf(error) === 'ELOOP') throw symlinkRejected(display, origin);
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile()) throw replacedDuringCopy(display, origin);
    if (!sameIdentity(identityOf(stat), expected)) throw replacedDuringCopy(display, origin);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** symlinkを追従せずに書き込む。`exclusive` では既存entryがあれば必ず失敗する。 */
function writeNoFollow(target: string, display: string, data: Buffer, mode: number, exclusive: boolean): void {
  const base = fs.constants.O_WRONLY | fs.constants.O_CREAT | noFollowFlag();
  const flags = exclusive ? base | fs.constants.O_EXCL : base | fs.constants.O_TRUNC;
  let fd: number;
  try {
    fd = fs.openSync(target, flags, mode);
  } catch (error) {
    const code = errnoOf(error);
    if (code === 'ELOOP') throw symlinkRejected(display);
    if (code === 'EEXIST') throw replacedDuringCopy(display);
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile()) throw replacedDuringCopy(display);
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

class CopyPlan {
  readonly steps: CopyStep[] = [];
  private readonly plannedDirs = new Set<string>();

  constructor(private readonly policy: CopyPolicy) {}

  /** ディレクトリを検査し、必要なら作成予定として積む。symlinkと種別違いはここで停止する。 */
  addDir(dest: string, display: string, boundary: boolean): void {
    if (this.plannedDirs.has(dest)) return;
    const stat = lstatOrNull(dest);
    if (stat) {
      if (stat.isSymbolicLink()) throw symlinkRejected(display);
      if (!stat.isDirectory()) {
        throw new CliError(
          `導入先の同名entryがディレクトリではないため展開を中断しました: ${display}` +
            '（手動で確認・解消してから再実行してください）',
        );
      }
    }
    this.plannedDirs.add(dest);
    this.steps.push({ kind: 'dir', dest, display, boundary, identity: stat ? identityOf(stat) : null });
  }

  addFile(src: string, srcStat: fs.BigIntStats, dest: string, display: string): void {
    const parent = path.dirname(dest);
    const parentStat = lstatOrNull(parent);
    const destStat = lstatOrNull(dest);
    const srcIdentity = identityOf(srcStat);
    const step: FileStep = {
      kind: 'file',
      src,
      dest,
      display,
      action: 'created',
      srcIdentity,
      srcMode: Number(srcStat.mode & 0o777n),
      parent,
      parentIdentity: parentStat ? identityOf(parentStat) : null,
    };
    if (!destStat) {
      this.steps.push(step);
      return;
    }
    if (destStat.isSymbolicLink()) throw symlinkRejected(display);
    if (destStat.isDirectory()) {
      throw new CliError(
        `導入先の同名entryがディレクトリのため展開を中断しました: ${display}` +
          '（手動で確認・解消してから再実行してください）',
      );
    }
    if (!destStat.isFile()) {
      throw new CliError(
        `導入先の同名entryが通常ファイルではないため展開を中断しました: ${display}` +
          '（手動で確認・解消してから再実行してください）',
      );
    }
    if (this.policy === 'mirror') {
      this.steps.push({ ...step, action: 'overwritten' });
      return;
    }
    const same = readNoFollow(src, src, srcIdentity, 'source').equals(
      readNoFollow(dest, display, identityOf(destStat), 'dest'),
    );
    if (!same) {
      throw new CliError(
        `導入先に既存の異なる内容のファイルがあるため展開を中断しました: ${display}` +
          `（内容が競合しています。手動で確認・解消してから再実行してください）`,
      );
    }
    this.steps.push({ ...step, action: 'unchanged' });
  }
}

/** 配布元entryの種別。symlink・FIFO・device・socketは1byteも配布せずに停止させる。 */
function classifySource(target: string, display: string): { stat: fs.BigIntStats; directory: boolean } {
  const stat = fs.lstatSync(target, { bigint: true });
  if (stat.isSymbolicLink()) {
    throw new CliError(
      `配布元にsymlinkがあるため展開を中断しました: ${display}（リンク先は配布しません）`,
    );
  }
  if (stat.isDirectory()) return { stat, directory: true };
  if (stat.isFile()) return { stat, directory: false };
  throw new CliError(
    `配布元に通常ファイル・ディレクトリ以外のentryがあるため展開を中断しました: ${display}`,
  );
}

function planTree(src: string, dest: string, display: string, plan: CopyPlan): void {
  const { stat, directory } = classifySource(src, src);
  if (!directory) {
    plan.addFile(src, stat, dest, display);
    return;
  }
  plan.addDir(dest, display, false);
  const children = fs.readdirSync(src, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const child of children) {
    planTree(path.join(src, child.name), path.join(dest, child.name), path.join(display, child.name), plan);
  }
}

/**
 * 検査済みディレクトリを実際に用意する。作成は非recursiveなので、途中でsymlinkに置き換えられた
 * 場合はEEXISTで失敗し、リンク先には作られない。
 */
function ensureDirectory(step: DirStep): Identity {
  const before = lstatOrNull(step.dest);
  if (before) {
    if (before.isSymbolicLink()) throw symlinkRejected(step.display);
    if (!before.isDirectory()) throw replacedDuringCopy(step.display);
    if (step.identity && !sameIdentity(identityOf(before), step.identity)) throw replacedDuringCopy(step.display);
    return identityOf(before);
  }
  try {
    if (step.boundary) fs.mkdirSync(step.dest, { recursive: true });
    else fs.mkdirSync(step.dest);
  } catch (error) {
    if (errnoOf(error) !== 'EEXIST') throw error;
  }
  const after = lstatOrNull(step.dest);
  if (!after || after.isSymbolicLink() || !after.isDirectory()) throw symlinkRejected(step.display);
  return identityOf(after);
}

function applyPlan(steps: CopyStep[]): void {
  const directories = new Map<string, Identity>();
  for (const step of steps) {
    if (step.kind === 'dir') {
      directories.set(step.dest, ensureDirectory(step));
      continue;
    }
    if (step.action === 'unchanged') continue;
    const expectedParent = directories.get(step.parent) ?? step.parentIdentity;
    const parentNow = lstatOrNull(step.parent);
    if (!parentNow || parentNow.isSymbolicLink() || !parentNow.isDirectory()) {
      throw symlinkRejected(path.dirname(step.display));
    }
    if (expectedParent && !sameIdentity(identityOf(parentNow), expectedParent)) {
      throw replacedDuringCopy(path.dirname(step.display));
    }
    const data = readNoFollow(step.src, step.src, step.srcIdentity, 'source');
    writeNoFollow(step.dest, step.display, data, step.srcMode, step.action === 'created');
  }
}

function copyTree(src: string, dest: string, options: CopyOptions, policy: CopyPolicy): CopyResult[] {
  const { dryRun = false } = options;
  noFollowFlag();
  const srcRoot = path.resolve(src);
  const srcStat = lstatOrNull(srcRoot);
  if (srcStat === null) return [];

  const { boundary, boundaryDisplay, components } = resolveBoundary(dest, options.root);
  if (components.length === 0 && srcStat.isFile()) {
    throw new CliError(
      `導入先ルートと配布先が同一パスですが配布元がディレクトリではありません: ${boundaryDisplay}`,
    );
  }

  const plan = new CopyPlan(policy);
  plan.addDir(boundary, boundaryDisplay, true);
  // 信頼境界から配布先までの中間componentも、symlinkを追従しないことをここで確定させる。
  let currentDest = boundary;
  let currentDisplay = boundaryDisplay;
  for (const component of components.slice(0, -1)) {
    currentDest = path.join(currentDest, component);
    currentDisplay = path.join(currentDisplay, component);
    plan.addDir(currentDest, currentDisplay, false);
  }
  const destReal = path.join(boundary, ...components);
  planTree(srcRoot, destReal, path.join(boundaryDisplay, ...components), plan);

  options.onPlanComplete?.();
  if (!dryRun) applyPlan(plan.steps);

  return plan.steps
    .filter((step): step is FileStep => step.kind === 'file')
    .map((step) => ({ path: step.display, action: step.action, planned: dryRun }));
}

/**
 * 既存ファイルと内容が同一なら idempotent に skip、異なれば CliError で即座に停止する
 * （非破壊: 既存の異なる内容を暗黙に上書き・放置しない。setup 系コマンドの既定動作）。
 *
 * `dryRun: true` は「書込みをしない」だけで「検査をしない」わけではない（Issue #169:
 * 衝突検知は dry-run でも従来どおり行われる）。
 *
 * Issue #288: 配布元・配布先ともsymlinkを一切追従しない。全entryの検査が終わるまで1byteも
 * 書き込まないため、後段で異常を検知した場合も前段のファイルは作られない。
 */
export function copyTreeFailOnConflict(src: string, dest: string, options: CopyOptions = {}): CopyResult[] {
  return copyTree(src, dest, options, 'fail-on-conflict');
}

/**
 * `.github/` は配布元 `.agent-skill-chain/templates/github/.github/` の展開結果そのもの
 * （AGENTS.md が定めるGitHub配布・マルチAI対応の方針）であり、常に完全一致させるミラーコピー。
 *
 * Issue #288: 「異なる内容でも上書きする」という意味は保ったまま、symlink非追従の境界だけを
 * fail-on-conflict と共有する。
 */
export function copyTreeMirror(src: string, dest: string, options: CopyOptions = {}): CopyResult[] {
  return copyTree(src, dest, options, 'mirror');
}
