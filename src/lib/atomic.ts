import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface AtomicWriteOptions {
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
      0o600,
    );
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
