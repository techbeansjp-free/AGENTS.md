import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "../lib/atomic.js";
import { resolveContained } from "../lib/security.js";
import { findPackageRoot } from "../lib/package-root.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { isRecord } from "../types.js";

const packageRoot = findPackageRoot(import.meta.url);
const ROOT_ASSETS = ["AGENTS.md"];
const NAMESPACE_ROOT_ASSETS = ["00_利用案内.md"];
const NAMESPACE_ASSETS = ["docs", "skills", "templates", "schemas", "policy"];
const MANAGED_RECORD = ".agent-skill-chain/managed-assets.json";
const SHA256 = /^[a-f0-9]{64}$/u;

interface ManagedAssetRecord {
  version: unknown;
  files: Record<string, string>;
}

interface ManagedAsset {
  relative: string;
  file: string;
  expected: string;
}

interface UninstallResult {
  applied: boolean;
  removable: string[];
  retained: string[];
  removed: string[];
  pending: string[];
  recovery: string;
  consumerAssetsPreserved?: string[];
}

function isPackageOwnedPath(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  return (
    normalized === "AGENTS.md" ||
    NAMESPACE_ROOT_ASSETS.some(
      (file) => normalized === `.agent-skill-chain/${file}`,
    ) ||
    NAMESPACE_ASSETS.some((directory) =>
      normalized.startsWith(`.agent-skill-chain/${directory}/`),
    )
  );
}

function digest(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function relativeKey(target: string, file: string): string {
  return path.relative(target, file).replaceAll(path.sep, "/");
}

function isRegularFile(file: string): boolean {
  return fs.lstatSync(file).isFile();
}

function pathEntryExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function resolveManagedAsset(target: string, relative: string): string {
  if (relative !== relative.normalize("NFC"))
    throw new Error(`managed asset pathのUnicode正規化が不正です: ${relative}`);
  const portable = relative.replaceAll("\\", "/");
  const segments = portable.split("/");
  if (
    path.posix.isAbsolute(portable) ||
    path.win32.isAbsolute(relative) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    !isPackageOwnedPath(portable)
  )
    throw new Error(`managed asset recordが不正です: ${relative}`);
  return resolveContained(target, portable, { allowMissingLeaf: true });
}

function readManagedAssetRecord(target: string): {
  recordPath: string;
  record: ManagedAssetRecord;
  assets: ManagedAsset[];
} {
  const recordPath = resolveContained(target, MANAGED_RECORD);
  if (!isRegularFile(recordPath))
    throw new Error("managed asset recordは通常fileでなければなりません");
  const parsed: unknown = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.files))
    throw new Error("managed asset recordが不正です");
  const files: Record<string, string> = {};
  const assets: ManagedAsset[] = [];
  for (const [recordKey, expected] of Object.entries(parsed.files)) {
    if (typeof expected !== "string" || !SHA256.test(expected))
      throw new Error(`managed asset recordが不正です: ${recordKey}`);
    const relative = recordKey.replaceAll("\\", "/");
    const file = resolveManagedAsset(target, recordKey);
    if (files[relative] !== undefined)
      throw new Error(`managed asset pathが重複しています: ${recordKey}`);
    files[relative] = expected;
    assets.push({ relative, file, expected });
  }
  return {
    recordPath,
    record: { version: parsed.version, files },
    assets,
  };
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walkFiles(resolved)
      : entry.isFile()
        ? [resolved]
        : [];
  });
}

function mappings(target: string): Array<{ src: string; dest: string }> {
  const result = ROOT_ASSETS.map((name) => ({
    src: path.join(packageRoot, name),
    dest: path.join(target, name),
  }));
  for (const file of NAMESPACE_ROOT_ASSETS)
    result.push({
      src: path.join(packageRoot, ".agent-skill-chain", file),
      dest: path.join(target, ".agent-skill-chain", file),
    });
  for (const directory of NAMESPACE_ASSETS) {
    const source = path.join(packageRoot, ".agent-skill-chain", directory);
    if (!fs.existsSync(source)) continue;
    for (const file of walkFiles(source)) {
      const relative = path.relative(source, file);
      result.push({
        src: path.join(source, relative),
        dest: path.join(target, ".agent-skill-chain", directory, relative),
      });
    }
  }
  return result;
}

export function init(target: string, options: { apply: boolean }) {
  const assets = mappings(target);
  const conflicts = assets
    .filter(
      ({ src, dest }) =>
        pathEntryExists(dest) &&
        (!isRegularFile(dest) || digest(src) !== digest(dest)),
    )
    .map(({ dest }) => dest);
  if (conflicts.length > 0)
    throw new Error(
      `初期導入先が競合しています。ファイルは書き込んでいません: ${conflicts.join(", ")}`,
    );
  if (!options.apply)
    return { applied: false, assets: assets.map(({ dest }) => dest) };
  const record: { version: string; files: Record<string, string> } = {
    version: PACKAGE_VERSION,
    files: {},
  };
  for (const { src, dest } of assets) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!pathEntryExists(dest))
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    record.files[relativeKey(target, dest)] = digest(dest);
  }
  writeFileAtomic(
    path.join(target, MANAGED_RECORD),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return { applied: true, assets: Object.keys(record.files) };
}

export function upgrade(target: string, options: { apply: boolean }) {
  const recordPath = path.join(target, MANAGED_RECORD);
  if (!fs.existsSync(recordPath))
    throw new Error("未導入です。先にinstallを実行してください");
  const { record: old } = readManagedAssetRecord(target);
  const current = mappings(target);
  const retained: string[] = [];
  const planned: Array<{
    src: string;
    dest: string;
    key: string;
    expected: string | undefined;
  }> = [];
  for (const item of current) {
    const key = relativeKey(target, item.dest);
    const expected = old.files[key];
    if (
      pathEntryExists(item.dest) &&
      (!isRegularFile(item.dest) || !expected || digest(item.dest) !== expected)
    )
      retained.push(key);
    else planned.push({ ...item, key, expected });
  }
  if (!options.apply)
    return {
      applied: false,
      planned: planned.map((item) => item.key),
      retained,
    };
  const next: { version: string; files: Record<string, string> } = {
    version: PACKAGE_VERSION,
    files: { ...old.files },
  };
  for (const item of planned) {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    if (pathEntryExists(item.dest)) {
      if (
        !item.expected ||
        !isRegularFile(item.dest) ||
        digest(item.dest) !== item.expected
      ) {
        retained.push(item.key);
        continue;
      }
      fs.copyFileSync(item.src, item.dest);
    } else fs.copyFileSync(item.src, item.dest, fs.constants.COPYFILE_EXCL);
    next.files[item.key] = digest(item.dest);
  }
  writeFileAtomic(recordPath, `${JSON.stringify(next, null, 2)}\n`);
  return { applied: true, retained };
}

export function uninstall(
  target: string,
  options: { apply: boolean },
): UninstallResult {
  const recordPath = path.join(target, MANAGED_RECORD);
  if (!fs.existsSync(recordPath)) throw new Error("未導入です");
  const managed = readManagedAssetRecord(target);
  const removable: string[] = [];
  const retained: string[] = [];
  for (const { relative, file, expected } of managed.assets) {
    if (!pathEntryExists(file)) continue;
    if (isRegularFile(file) && digest(file) === expected) removable.push(file);
    else retained.push(relative);
  }
  if (!options.apply)
    return {
      applied: false,
      removable,
      retained,
      removed: [],
      pending: [],
      recovery: "previewのため変更はありません",
    };

  const candidates: ManagedAsset[] = [];
  for (const asset of managed.assets) {
    if (!removable.includes(asset.file)) continue;
    const file = resolveManagedAsset(target, asset.relative);
    if (
      !pathEntryExists(file) ||
      !isRegularFile(file) ||
      digest(file) !== asset.expected
    ) {
      if (pathEntryExists(file) && !retained.includes(asset.relative))
        retained.push(asset.relative);
      continue;
    }
    candidates.push({ ...asset, file });
  }

  const removed: string[] = [];
  const pending: string[] = [];
  for (const asset of candidates) {
    try {
      const file = resolveManagedAsset(target, asset.relative);
      if (
        !pathEntryExists(file) ||
        !isRegularFile(file) ||
        digest(file) !== asset.expected
      ) {
        if (pathEntryExists(file) && !retained.includes(asset.relative))
          retained.push(asset.relative);
        continue;
      }
      fs.rmSync(file);
      removed.push(asset.relative);
    } catch {
      pending.push(asset.relative);
    }
  }
  if (pending.length === 0) {
    try {
      fs.rmSync(managed.recordPath);
    } catch {
      pending.push(MANAGED_RECORD);
    }
  }
  const applied = pending.length === 0;
  return {
    applied,
    removable,
    retained,
    removed,
    pending,
    recovery: applied
      ? "不要"
      : "権限と未処理対象を確認し、managed asset recordを保持したままdelete --applyを再実行してください",
    consumerAssetsPreserved: [
      ".agent-skill-chain/tmp",
      ".agent-skill-chain/project-policy.json",
      ".agent-skill-chain/project",
      "docs/specs",
    ],
  };
}

export function doctor(target: string) {
  const legacy = [".agents", ".workflow"].filter((name) =>
    fs.existsSync(path.join(target, name)),
  );
  const installed = fs.existsSync(
    path.join(target, ".agent-skill-chain", "managed-assets.json"),
  );
  return {
    healthy: installed,
    installed,
    legacyDetected: legacy,
    legacyRuntimeEnabled: false,
    migration: legacy.length
      ? "診断のみ。旧資産は実行も変換もしません"
      : "なし",
  };
}
