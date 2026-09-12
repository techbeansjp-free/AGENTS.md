import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface AtomicWriteOptions {
  /** Exact permission bits for the published regular file. Defaults to 0600. */
  fileMode?: number;
  /**
   * Keep an interrupted temporary file outside a digest-controlled target
   * directory. The directory must be on the same filesystem as destination.
   */
  temporaryDirectory?: string;
  /**
   * Runs immediately after the destination entry is atomically renamed.
   * Throwing reports failure but cannot roll back the published entry.
   */
  onPublished?: () => void;
  /**
   * Runs after the destination rename and required directory syncs. Throwing
   * reports a post-commit failure and cannot roll back the published entry.
   */
  onDurableCommit?: () => void;
}

interface ExclusivePinnedWriteHooks {
  /** Test-only fault injection immediately after the directory is pinned. */
  beforeWrite?: () => void;
  /** Test-only fault injection after create and before identity observation. */
  afterCreateBeforeIdentity?: (descriptor: number) => void;
  /** Test-only fault injection after exclusive create and before full write. */
  afterCreateBeforeWrite?: (descriptor: number) => void;
  /** Test-only fault injection after the complete file is durable. */
  afterWriteBeforeVerify?: () => void;
  /** Test-only fault injection before rollback removes the created entry. */
  beforeCleanup?: () => void;
  /** Test-only replacement for the final pinned-directory close. */
  closePinnedDirectory?: (descriptor: number) => void;
}

export class ExclusivePinnedWriteError extends Error {
  constructor(
    readonly createdEntrySanitized: boolean,
    options: { cause: unknown },
  ) {
    super(
      `exclusive file作成後に失敗しました。無関係entryの誤削除を避けるためpathname削除は行わず、作成descriptorを${createdEntrySanitized ? "空にしました" : "空にできませんでした"}。作成entryが残存している可能性があります`,
      options,
    );
    this.name = "ExclusivePinnedWriteError";
  }
}

interface PinnedDirectory {
  descriptor: number;
  path: string;
  dev: number;
  ino: number;
}

function pinDirectory(directory: string): PinnedDirectory {
  const resolved = path.resolve(directory);
  const directoryFlags =
    fs.constants.O_RDONLY |
    (process.platform === "win32"
      ? 0
      : fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const descriptor = fs.openSync(resolved, directoryFlags);
  try {
    const opened = fs.fstatSync(descriptor);
    const named = fs.lstatSync(resolved);
    if (
      !opened.isDirectory() ||
      named.isSymbolicLink() ||
      !named.isDirectory() ||
      opened.dev !== named.dev ||
      opened.ino !== named.ino ||
      fs.realpathSync(resolved) !== resolved
    )
      throw new Error(`atomic write directoryが不正です: ${resolved}`);
    return {
      descriptor,
      path: resolved,
      dev: opened.dev,
      ino: opened.ino,
    };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function assertPinnedDirectory(directory: PinnedDirectory): void {
  const opened = fs.fstatSync(directory.descriptor);
  const named = fs.lstatSync(directory.path);
  if (
    !opened.isDirectory() ||
    named.isSymbolicLink() ||
    !named.isDirectory() ||
    opened.dev !== directory.dev ||
    opened.ino !== directory.ino ||
    named.dev !== directory.dev ||
    named.ino !== directory.ino ||
    fs.realpathSync(directory.path) !== directory.path
  )
    throw new Error(
      `atomic write directoryが実行中に変更されました: ${directory.path}`,
    );
}

function descriptorPath(directory: PinnedDirectory, leaf: string): string {
  return process.platform === "linux"
    ? `/proc/self/fd/${directory.descriptor}/${leaf}`
    : path.join(directory.path, leaf);
}

function descriptorDirectoryPath(directory: PinnedDirectory): string {
  const candidates =
    process.platform === "linux"
      ? [`/proc/self/fd/${directory.descriptor}`]
      : process.platform === "win32"
        ? []
        : [`/dev/fd/${directory.descriptor}`];
  let unsupportedDarwinDescriptorAlias = false;
  for (const candidate of candidates) {
    let observedDescriptor: number | undefined;
    try {
      // Darwin's fdescfs can report a synthetic st_dev for /dev/fd/N when the
      // path itself is statted. Reopening the exact descriptor alias and using
      // fstat observes the underlying directory identity on every supported OS.
      observedDescriptor = fs.openSync(candidate, fs.constants.O_RDONLY);
      const observed = fs.fstatSync(observedDescriptor);
      if (
        observed.isDirectory() &&
        observed.dev === directory.dev &&
        observed.ino === directory.ino
      ) {
        if (process.platform === "darwin") {
          unsupportedDarwinDescriptorAlias = true;
          continue;
        }
        return candidate;
      }
    } catch {
      // A missing descriptor filesystem is handled by the fail-closed error.
    } finally {
      if (observedDescriptor !== undefined) fs.closeSync(observedDescriptor);
    }
  }
  if (unsupportedDarwinDescriptorAlias)
    throw new Error(
      "macOSの/dev/fdは末尾pathを探索できないため、安全なdirectory descriptor相対file作成には利用できません",
    );
  throw new Error(
    "exclusive file作成にはdirectory descriptor相対pathが必要です",
  );
}

/**
 * Publish a new file without ever resolving the caller-controlled parent again.
 *
 * The directory descriptor pins the object used by create and sanitization. If the
 * named parent moves, both operations still address the pinned directory. A
 * platform without a descriptor-relative path surface is rejected before the
 * destination entry is created. A post-create failure truncates the still-open
 * descriptor and retains its directory entry: unlink-by-name cannot atomically
 * bind an inode and could delete an unrelated replacement.
 */
export function writeFileExclusivePinned(
  directory: string,
  leaf: string,
  contents: string,
  hooks: ExclusivePinnedWriteHooks = {},
): string {
  if (leaf !== path.basename(leaf) || leaf === "." || leaf === "..")
    throw new Error("exclusive file作成のleafが不正です");
  const pinned = pinDirectory(directory);
  let descriptor: number | undefined;
  let created = false;
  let failure: unknown;
  try {
    const pinnedTarget = path.join(descriptorDirectoryPath(pinned), leaf);
    hooks.beforeWrite?.();
    assertPinnedDirectory(pinned);
    descriptor = fs.openSync(
      pinnedTarget,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    hooks.afterCreateBeforeIdentity?.(descriptor);
    const createdIdentity = fs.fstatSync(descriptor);
    if (!createdIdentity.isFile())
      throw new Error("exclusive file作成先が通常fileではありません");
    hooks.afterCreateBeforeWrite?.(descriptor);
    assertPinnedDirectory(pinned);
    writeFully(descriptor, Buffer.from(contents));
    fs.fsyncSync(descriptor);
    hooks.afterWriteBeforeVerify?.();
    assertPinnedDirectory(pinned);
    fsyncDirectory(pinned);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const written = path.join(pinned.path, leaf);
    try {
      (hooks.closePinnedDirectory ?? fs.closeSync)(pinned.descriptor);
    } catch {
      // File and directory contents are already durable. A descriptor cleanup
      // failure cannot make the completed draft uncertain or roll it back.
    }
    return written;
  } catch (error) {
    failure = error;
  }
  try {
    hooks.beforeCleanup?.();
  } catch (error) {
    failure = new AggregateError(
      [failure, error],
      "cleanup hookが失敗しました",
    );
  }
  let sanitized = false;
  if (created && descriptor !== undefined) {
    try {
      fs.ftruncateSync(descriptor, 0);
      fs.fsyncSync(descriptor);
      sanitized = true;
    } catch (error) {
      failure = new AggregateError(
        [failure, error],
        "作成descriptorを空にできませんでした",
      );
    }
  }
  if (descriptor !== undefined) {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    fs.closeSync(pinned.descriptor);
  } catch (error) {
    failure ??= error;
  }
  if (created)
    throw new ExclusivePinnedWriteError(sanitized, { cause: failure });
  throw failure;
}

function writeFully(descriptor: number, contents: Buffer): void {
  let offset = 0;
  while (offset < contents.length) {
    const written = fs.writeSync(
      descriptor,
      contents,
      offset,
      contents.length - offset,
      offset,
    );
    if (written <= 0)
      throw new Error("atomic writeを完全に書き込めませんでした");
    offset += written;
  }
}

function fsyncDirectory(directory: PinnedDirectory): void {
  if (process.platform !== "win32") fs.fsyncSync(directory.descriptor);
}

export function publishDirectoryAtomic(
  destination: string,
  writer: (temporary: string) => void,
): void {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    parent,
    `.pending-${process.pid}-${crypto.randomBytes(8).toString("hex")}`,
  );
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    writer(temporary);
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function writeFileAtomic(
  destination: string,
  contents: string,
  options: AtomicWriteOptions = {},
): void {
  const fileMode = options.fileMode ?? 0o600;
  if (!Number.isInteger(fileMode) || fileMode < 0 || fileMode > 0o777)
    throw new Error("atomic writeのfile modeが不正です");
  const resolvedDestination = path.resolve(destination);
  const destinationDirectory = path.dirname(resolvedDestination);
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const temporaryDirectory = path.resolve(
    options.temporaryDirectory ?? destinationDirectory,
  );
  const target = pinDirectory(destinationDirectory);
  let source: PinnedDirectory;
  try {
    source = pinDirectory(temporaryDirectory);
  } catch (error) {
    fs.closeSync(target.descriptor);
    throw error;
  }
  if (target.dev !== source.dev) {
    fs.closeSync(source.descriptor);
    fs.closeSync(target.descriptor);
    throw new Error(
      "atomic writeのtemporary directoryは同一filesystemが必要です",
    );
  }
  const destinationLeaf = path.basename(resolvedDestination);
  const temporaryLeaf = `.${destinationLeaf}.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
  const temporary = descriptorPath(source, temporaryLeaf);
  const publishTarget = descriptorPath(target, destinationLeaf);
  const expected = Buffer.from(contents);
  let temporaryDescriptor: number | undefined;
  let failure: unknown;
  try {
    temporaryDescriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      fileMode,
    );
    fs.fchmodSync(temporaryDescriptor, fileMode);
    writeFully(temporaryDescriptor, expected);
    fs.fsyncSync(temporaryDescriptor);
    fs.closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    assertPinnedDirectory(source);
    assertPinnedDirectory(target);
    fs.renameSync(temporary, publishTarget);
    options.onPublished?.();
    fsyncDirectory(target);
    if (source.dev !== target.dev || source.ino !== target.ino)
      fsyncDirectory(source);
    options.onDurableCommit?.();
    assertPinnedDirectory(source);
    assertPinnedDirectory(target);
    const reread = fs.readFileSync(publishTarget);
    if (!reread.equals(expected))
      throw new Error("atomic writeの書き込み後読み取り確認に失敗しました");
  } catch (error) {
    failure = error;
  }
  if (temporaryDescriptor !== undefined) {
    try {
      fs.closeSync(temporaryDescriptor);
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    fs.unlinkSync(temporary);
    fsyncDirectory(source);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      failure ??= error;
  }
  try {
    fs.closeSync(source.descriptor);
  } catch (error) {
    failure ??= error;
  }
  try {
    fs.closeSync(target.descriptor);
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}
