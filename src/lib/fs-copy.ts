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
   * mirror先の検査境界。境界自身からleafまでの既存componentは通常directory/fileだけを許し、
   * symlinkやspecial fileを追従しない。省略時はdestの親directoryを境界にする。
   */
  destinationBoundary?: string;
  /** mirror元の信頼境界。省略時はsrc自身を境界にする。 */
  sourceBoundary?: string;
}

/**
 * 既存ファイルと内容が同一なら idempotent に skip、異なれば CliError で即座に停止する
 * （非破壊: 既存の異なる内容を暗黙に上書き・放置しない。setup 系コマンドの既定動作）。
 *
 * `dryRun: true` は「書込みをしない」だけで「検査をしない」わけではない（Issue #169:
 * 衝突検知は dry-run でも従来どおり行われる）。
 */
export function copyTreeFailOnConflict(src: string, dest: string, options: CopyOptions = {}): CopyResult[] {
  const { dryRun = false } = options;
  const results: CopyResult[] = [];

  function walk(s: string, d: string): void {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      if (!dryRun) fs.mkdirSync(d, { recursive: true });
      for (const child of fs.readdirSync(s)) {
        walk(path.join(s, child), path.join(d, child));
      }
      return;
    }
    if (fs.existsSync(d)) {
      const same = fs.readFileSync(s).equals(fs.readFileSync(d));
      if (!same) {
        throw new CliError(
          `導入先に既存の異なる内容のファイルがあるため展開を中断しました: ${d}` +
            `（内容が競合しています。手動で確認・解消してから再実行してください）`,
        );
      }
      results.push({ path: d, action: 'unchanged', planned: dryRun });
      return;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
    results.push({ path: d, action: 'created', planned: dryRun });
  }

  if (fs.existsSync(src)) walk(src, dest);
  return results;
}

/**
 * `.github/` は配布元 `.agent-skill-chain/templates/github/.github/` の展開結果そのもの
 * （AGENTS.md が定めるGitHub配布・マルチAI対応の方針）であり、常に完全一致させるミラーコピー。
 */
export function copyTreeMirror(src: string, dest: string, options: CopyOptions = {}): CopyResult[] {
  const { dryRun = false } = options;
  const sourceRoot = path.resolve(src);
  const sourceBoundary = path.resolve(options.sourceBoundary ?? sourceRoot);
  const destination = path.resolve(dest);
  const destinationBoundary = path.resolve(options.destinationBoundary ?? path.dirname(destination));
  const results: CopyResult[] = [];

  type PlannedDirectory = {
    source: string;
    destination: string;
    sourceIdentity: fs.Stats;
    destinationIdentity?: fs.Stats;
  };
  type PlannedFile = {
    source: string;
    destination: string;
    sourceIdentity: fs.Stats;
    destinationIdentity?: fs.Stats;
  };
  const directories: PlannedDirectory[] = [];
  const files: PlannedFile[] = [];

  function lstatIfPresent(filePath: string): fs.Stats | undefined {
    try {
      return fs.lstatSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  function relativeWithin(boundary: string, target: string): string {
    const relative = path.relative(boundary, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new CliError(`mirror先が検査境界外です: ${target}`);
    }
    return relative;
  }

  function assertSafeDestination(target: string, expected: 'directory' | 'file'): fs.Stats | undefined {
    const relative = relativeWithin(destinationBoundary, target);
    const components = relative === '' ? [] : relative.split(path.sep);
    let current = destinationBoundary;
    const paths = [current, ...components.map((component) => (current = path.join(current, component)))];

    for (let index = 0; index < paths.length; index += 1) {
      const component = paths[index]!;
      const stat = lstatIfPresent(component);
      if (!stat) return undefined;
      const isLeaf = index === paths.length - 1;
      const required = isLeaf ? expected : 'directory';
      if (required === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
        throw new CliError(
          `mirror先にsymlink・special file・種別不一致があるため追従せず停止しました: ${component}`,
        );
      }
    }
    return lstatIfPresent(target);
  }

  function assertSafeSource(target: string, expected: 'directory' | 'file'): fs.Stats {
    const relative = relativeWithin(sourceBoundary, target);
    const components = relative === '' ? [] : relative.split(path.sep);
    let current = sourceBoundary;
    const paths = [current, ...components.map((component) => (current = path.join(current, component)))];

    for (let index = 0; index < paths.length; index += 1) {
      const component = paths[index]!;
      const stat = lstatIfPresent(component);
      if (!stat) throw new CliError(`mirror元が欠落しています: ${component}`);
      const isLeaf = index === paths.length - 1;
      const required = isLeaf ? expected : 'directory';
      if (required === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
        throw new CliError(`mirror元にsymlink・special file・種別不一致があるため追従せず停止しました: ${component}`);
      }
    }
    return fs.lstatSync(target);
  }

  function plan(source: string, target: string): void {
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) {
      const sourceIdentity = assertSafeSource(source, 'directory');
      const destinationIdentity = assertSafeDestination(target, 'directory');
      directories.push({ source, destination: target, sourceIdentity, destinationIdentity });
      for (const child of fs.readdirSync(source)) {
        plan(path.join(source, child), path.join(target, child));
      }
      return;
    }
    if (!stat.isFile()) {
      throw new CliError(`mirror元にsymlink・special fileがあるため追従せず停止しました: ${source}`);
    }
    const sourceIdentity = assertSafeSource(source, 'file');
    const destinationIdentity = assertSafeDestination(target, 'file');
    files.push({ source, destination: target, sourceIdentity, destinationIdentity });
  }

  function ensureSafeDirectory(directory: string): void {
    const relative = relativeWithin(destinationBoundary, directory);
    const components = relative === '' ? [] : relative.split(path.sep);
    let current = destinationBoundary;
    for (const component of ['', ...components]) {
      if (component) current = path.join(current, component);
      const stat = lstatIfPresent(current);
      if (stat) {
        if (!stat.isDirectory()) {
          throw new CliError(`mirror先directoryがsymlinkまたは通常directoryではありません: ${current}`);
        }
      } else {
        fs.mkdirSync(current);
        const created = fs.lstatSync(current);
        if (!created.isDirectory()) {
          throw new CliError(`mirror先directoryを安全に作成できませんでした: ${current}`);
        }
      }
    }
  }

  function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
    return left.dev === right.dev && left.ino === right.ino;
  }

  function readStableSource(filePath: string, plannedIdentity: fs.Stats): { content: Buffer; mode: number } {
    const before = assertSafeSource(filePath, 'file');
    if (!sameIdentity(plannedIdentity, before)) {
      throw new CliError(`mirror元がpreflight後に置換されたため停止しました: ${filePath}`);
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || !sameIdentity(before, opened)) {
        throw new CliError(`mirror元が検査後に置換されたため停止しました: ${filePath}`);
      }
      const content = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      if (
        !sameIdentity(opened, after) ||
        opened.size !== after.size ||
        opened.mtimeMs !== after.mtimeMs ||
        opened.ctimeMs !== after.ctimeMs
      ) {
        throw new CliError(`mirror元が読取り中に変更されたため停止しました: ${filePath}`);
      }
      return { content, mode: opened.mode & 0o777 };
    } finally {
      fs.closeSync(descriptor);
    }
  }

  function writeFileNoFollow(file: PlannedFile): void {
    const source = readStableSource(file.source, file.sourceIdentity);
    ensureSafeDirectory(path.dirname(file.destination));
    const existing = assertSafeDestination(file.destination, 'file');
    if (
      (existing !== undefined) !== (file.destinationIdentity !== undefined) ||
      (existing && file.destinationIdentity && !sameIdentity(existing, file.destinationIdentity))
    ) {
      throw new CliError(`mirror先がpreflight後に変更されたため停止しました: ${file.destination}`);
    }

    const parent = path.dirname(file.destination);
    const parentBefore = fs.lstatSync(parent);
    const flags = file.destinationIdentity
      ? fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW
      : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
    const descriptor = fs.openSync(file.destination, flags, source.mode);
    try {
      const opened = fs.fstatSync(descriptor);
      const parentAfter = fs.lstatSync(parent);
      if (
        !opened.isFile() ||
        (existing && !sameIdentity(existing, opened)) ||
        !parentAfter.isDirectory() ||
        !sameIdentity(parentBefore, parentAfter)
      ) {
        throw new CliError(`mirror先がopen前後に置換されたため停止しました: ${file.destination}`);
      }
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, source.content);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  const sourceStat = lstatIfPresent(sourceRoot);
  if (!sourceStat) return results;
  if (!sourceStat.isDirectory() && !sourceStat.isFile()) {
    throw new CliError(`mirror元にsymlink・special fileがあるため追従せず停止しました: ${sourceRoot}`);
  }

  // 全source/destinationを先に走査し、既存の危険なentryを1 byteも書く前に拒否する。
  plan(sourceRoot, destination);
  for (const file of files) {
    results.push({
      path: file.destination,
      action: file.destinationIdentity ? 'overwritten' : 'created',
      planned: dryRun,
    });
  }
  if (dryRun) return results;

  for (const directory of directories) {
    const currentSource = assertSafeSource(directory.source, 'directory');
    const currentDestination = assertSafeDestination(directory.destination, 'directory');
    if (
      !sameIdentity(directory.sourceIdentity, currentSource) ||
      (currentDestination !== undefined) !== (directory.destinationIdentity !== undefined) ||
      (currentDestination &&
        directory.destinationIdentity &&
        !sameIdentity(currentDestination, directory.destinationIdentity))
    ) {
      throw new CliError(`mirror directoryがpreflight後に置換されたため停止しました: ${directory.destination}`);
    }
    ensureSafeDirectory(directory.destination);
  }
  for (const file of files) writeFileNoFollow(file);
  return results;
}
