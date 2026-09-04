import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";
import { findPackageRoot } from "../lib/package-root.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { isRecord } from "../types.js";
import {
  inspectExecutableVersion,
  MINIMUM_GH_VERSION,
  MINIMUM_GIT_VERSION,
} from "../lib/executable-version.js";
import { loadProjectPolicySet } from "./policy.js";
import {
  DEPRECATED_POLICY_SCHEMA_ALIASES,
  SUPPORTED_POLICY_SCHEMA_VERSIONS,
} from "../lib/version.js";
import { readStoredStagingRecord } from "./staging.js";
import {
  MODE_DECISION_FILE,
  STEP_JOURNAL_FILE,
  inspectWorkflowStagingArtifacts,
} from "./workflow.js";
import { surveyWorktrees, type WorktreeSurvey } from "./worktree-survey.js";

const packageRoot = findPackageRoot(import.meta.url);
/**
 * repository直下へ展開するhost入口。
 *
 * **hostごとに常時読まれるfile名が違う。** Codexは`AGENTS.md`、Claude Codeは
 * `CLAUDE.md`を読む。片方だけを配ると、もう片方のhostでは規範文書へ到達する
 * 常時の入口が存在しない（Issue #1219）。
 *
 * **skillは代替にならない。** `HOST_SKILL_TARGETS`は呼び出されたときに読まれる
 * 登録口であり、常時読まれる入口ではない。
 */
const ROOT_ASSETS = ["AGENTS.md", "CLAUDE.md"];
const NAMESPACE_ROOT_ASSETS = ["00_利用案内.md"];
const NAMESPACE_ASSETS = ["docs", "skills", "templates", "schemas", "policy"];
const MANAGED_RECORD = ".agent-skill-chain/managed-assets.json";
const HOST_SKILL_SOURCE = ".agent-skill-chain/skills/asc-step/SKILL.md";
const HOST_SKILL_TARGETS = [
  ".claude/skills/asc-step/SKILL.md",
  ".agents/skills/asc-step/SKILL.md",
] as const;
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
    /**
     * **`ROOT_ASSETS`を正本にする。** file名を直接書くと、host入口を足したときに
     * 展開はされるがrecord検証で拒否される（Issue #1219で`CLAUDE.md`を足して観測した）。
     */
    ROOT_ASSETS.includes(normalized) ||
    HOST_SKILL_TARGETS.includes(
      normalized as (typeof HOST_SKILL_TARGETS)[number],
    ) ||
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
  const destination = (relative: string): string =>
    resolveContained(target, relative, { allowMissingLeaf: true });
  const result = ROOT_ASSETS.map((name) => ({
    src: path.join(packageRoot, name),
    dest: destination(name),
  }));
  for (const file of NAMESPACE_ROOT_ASSETS)
    result.push({
      src: path.join(packageRoot, ".agent-skill-chain", file),
      dest: destination(path.join(".agent-skill-chain", file)),
    });
  for (const directory of NAMESPACE_ASSETS) {
    const source = path.join(packageRoot, ".agent-skill-chain", directory);
    if (!fs.existsSync(source)) continue;
    for (const file of walkFiles(source)) {
      const relative = path.relative(source, file);
      result.push({
        src: path.join(source, relative),
        dest: destination(path.join(".agent-skill-chain", directory, relative)),
      });
    }
  }
  for (const relative of HOST_SKILL_TARGETS)
    result.push({
      src: path.join(packageRoot, HOST_SKILL_SOURCE),
      dest: destination(relative),
    });
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
  const adoptable: string[] = [];
  const planned: Array<{
    src: string;
    dest: string;
    key: string;
    expected: string | undefined;
  }> = [];
  for (const item of current) {
    const key = relativeKey(target, item.dest);
    const expected = old.files[key];
    if (!pathEntryExists(item.dest)) {
      planned.push({ ...item, key, expected });
      continue;
    }
    if (!isRegularFile(item.dest)) {
      retained.push(key);
      continue;
    }
    if (expected) {
      if (digest(item.dest) === expected)
        planned.push({ ...item, key, expected });
      else retained.push(key);
      continue;
    }
    if (digest(item.dest) === digest(item.src)) {
      planned.push({ ...item, key, expected });
      adoptable.push(key);
    } else retained.push(key);
  }
  if (!options.apply)
    return {
      applied: false,
      planned: planned.map((item) => item.key),
      adopted: adoptable,
      retained,
    };
  const next: { version: string; files: Record<string, string> } = {
    version: PACKAGE_VERSION,
    files: { ...old.files },
  };
  const adopted: string[] = [];
  for (const item of planned) {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    if (pathEntryExists(item.dest)) {
      if (!isRegularFile(item.dest)) {
        retained.push(item.key);
        continue;
      }
      if (item.expected) {
        if (digest(item.dest) !== item.expected) {
          retained.push(item.key);
          continue;
        }
        fs.copyFileSync(item.src, item.dest);
      } else {
        if (digest(item.dest) !== digest(item.src)) {
          retained.push(item.key);
          continue;
        }
        adopted.push(item.key);
      }
    } else fs.copyFileSync(item.src, item.dest, fs.constants.COPYFILE_EXCL);
    next.files[item.key] = digest(item.dest);
  }
  writeFileAtomic(recordPath, `${JSON.stringify(next, null, 2)}\n`);
  return { applied: true, adopted, retained };
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

function hasLegacyAgentsAssets(target: string): boolean {
  const agents = path.join(target, ".agents");
  if (!pathEntryExists(agents)) return false;
  if (!fs.lstatSync(agents).isDirectory()) return true;
  return walkFiles(agents).some(
    (file) => relativeKey(target, file) !== HOST_SKILL_TARGETS[1],
  );
}

function validateAdapterFrontmatter(markdown: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(markdown)?.[1];
  return Boolean(
    frontmatter &&
    /^name:\s*asc-step\s*$/mu.test(frontmatter) &&
    /^description:\s*\S.+$/mu.test(frontmatter),
  );
}

function inspectDoctorWorkflowStaging(staging: string) {
  const record = readStoredStagingRecord(staging);
  const modeFile = path.join(staging, MODE_DECISION_FILE);
  const journalFile = path.join(staging, STEP_JOURNAL_FILE);
  return inspectWorkflowStagingArtifacts({
    staging,
    mode: record.mode,
    state: record.state,
    ...(fs.existsSync(modeFile)
      ? { modeDecisionSource: fs.readFileSync(modeFile, "utf8") }
      : {}),
    ...(fs.existsSync(journalFile)
      ? { journalSource: fs.readFileSync(journalFile, "utf8") }
      : {}),
  });
}

function injectedWorktreeSurvey(value: unknown): WorktreeSurvey | undefined {
  if (value === undefined) return undefined;
  if (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    Array.isArray(value.cleanupReady) &&
    Array.isArray(value.retained) &&
    Array.isArray(value.inProgress) &&
    Array.isArray(value.errors)
  )
    return value as unknown as WorktreeSurvey;
  return surveyWorktrees(value);
}

export function doctor(target: string, worktreeObservations?: unknown) {
  const worktreeSurvey = injectedWorktreeSurvey(worktreeObservations);
  const legacy = [
    ...(hasLegacyAgentsAssets(target) ? [".agents"] : []),
    ...(pathEntryExists(path.join(target, ".workflow")) ? [".workflow"] : []),
  ];
  const recordPath = path.join(target, MANAGED_RECORD);
  const installed = pathEntryExists(recordPath);
  const diagnostics: string[] = [];
  let files: Record<string, string> = {};
  let managedAssets: ManagedAsset[] = [];
  if (!installed)
    diagnostics.push(`${MANAGED_RECORD}: managed recordがありません`);
  else {
    try {
      const managed = readManagedAssetRecord(target);
      files = managed.record.files;
      managedAssets = managed.assets;
    } catch (error) {
      diagnostics.push(
        `${MANAGED_RECORD}: ${error instanceof Error ? error.message : "検証できません"}`,
      );
    }
  }

  for (const asset of managedAssets) {
    if (!pathEntryExists(asset.file) || !isRegularFile(asset.file)) {
      diagnostics.push(`${asset.relative}: managed通常fileがありません`);
      continue;
    }
    if (digest(asset.file) !== asset.expected)
      diagnostics.push(`${asset.relative}: managed hashが一致しません`);
  }

  const source = path.join(target, HOST_SKILL_SOURCE);
  let sourceHash: string | undefined;
  if (!pathEntryExists(source) || !isRegularFile(source))
    diagnostics.push(`${HOST_SKILL_SOURCE}: 通常fileがありません`);
  else {
    const markdown = fs.readFileSync(source, "utf8");
    sourceHash = digest(source);
    if (!validateAdapterFrontmatter(markdown))
      diagnostics.push(`${HOST_SKILL_SOURCE}: frontmatterが不正です`);
    if (
      !markdown.includes(
        "../../../.agent-skill-chain/docs/01_開発ワークフロー.md",
      ) ||
      !markdown.includes(".agent-skill-chain/skills/step-NN-")
    )
      diagnostics.push(`${HOST_SKILL_SOURCE}: 正本linkが不正です`);
  }

  for (const relative of HOST_SKILL_TARGETS) {
    const file = path.join(target, relative);
    if (!pathEntryExists(file) || !isRegularFile(file)) {
      diagnostics.push(`${relative}: 通常fileがありません`);
      continue;
    }
    const actual = digest(file);
    if (!sourceHash || actual !== sourceHash)
      diagnostics.push(`${relative}: adapter正本とhashが一致しません`);
    if (files[relative] !== actual)
      diagnostics.push(`${relative}: managed recordとhashが一致しません`);
  }
  const policyFile = path.join(
    target,
    ".agent-skill-chain",
    "project-policy.json",
  );
  let projectPolicyStatus:
    "missing" | "valid" | "invalid" | "unsupported-version" = "missing";
  let projectPolicyMessage =
    "project policyは未作成です。install健全性とは別に利用project ownerが作成・検証してください";
  if (fs.existsSync(policyFile)) {
    try {
      const parsed: unknown = parseJsonStrict(
        fs.readFileSync(policyFile, "utf8"),
        "project policy",
      );
      const schemaVersion = isRecord(parsed) ? parsed.schemaVersion : undefined;
      const knownVersion =
        schemaVersion === "agent-skill-chain/project-policy-manifest/v1" ||
        (typeof schemaVersion === "string" &&
          (SUPPORTED_POLICY_SCHEMA_VERSIONS.includes(schemaVersion) ||
            Object.prototype.hasOwnProperty.call(
              DEPRECATED_POLICY_SCHEMA_ALIASES,
              schemaVersion,
            )));
      if (!knownVersion) {
        projectPolicyStatus = "unsupported-version";
        projectPolicyMessage =
          "project policyのschemaVersionは未対応です。入力を保持してstaged migrationを計画してください";
      } else {
        loadProjectPolicySet(target);
        projectPolicyStatus = "valid";
        projectPolicyMessage =
          "project policyはschemaとruntimeの現行契約に適合しています";
      }
    } catch {
      projectPolicyStatus = "invalid";
      projectPolicyMessage =
        "project policyが不正です。入力を変更せずpolicy validateの診断を確認してください";
    }
  }
  const issuesRoot = path.join(target, ".agent-skill-chain", "tmp", "issues");
  const workflowStagings: Array<
    | ReturnType<typeof inspectDoctorWorkflowStaging>
    | { staging: string; valid: false; errors: string[] }
  > = [];
  if (pathEntryExists(issuesRoot) && fs.lstatSync(issuesRoot).isDirectory()) {
    for (const entry of fs.readdirSync(issuesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const staging = path.join(issuesRoot, entry.name);
      try {
        workflowStagings.push(inspectDoctorWorkflowStaging(staging));
      } catch (error) {
        workflowStagings.push({
          staging,
          valid: false,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  }
  const workflowHealthy = workflowStagings.every((staging) => staging.valid);
  const tooling = {
    git: inspectExecutableVersion(
      "git",
      ["--version"],
      target,
      MINIMUM_GIT_VERSION,
    ),
    gh: inspectExecutableVersion(
      "gh",
      ["--version"],
      target,
      MINIMUM_GH_VERSION,
    ),
  };
  const toolingDiagnostics = [tooling.git, tooling.gh].flatMap((tool) =>
    tool.diagnostic ? [tool.diagnostic] : [],
  );
  return {
    healthy: installed && diagnostics.length === 0,
    installed,
    adapters: {
      expected: [...HOST_SKILL_TARGETS],
      healthy: diagnostics.length === 0,
      diagnostics,
    },
    legacyDetected: legacy,
    legacyRuntimeEnabled: false,
    projectPolicyStatus,
    projectPolicyMessage,
    tooling: {
      healthy: toolingDiagnostics.length === 0,
      diagnostics: toolingDiagnostics,
      git: tooling.git,
      gh: tooling.gh,
    },
    workflow: {
      healthy: workflowHealthy,
      stagings: workflowStagings,
    },
    worktrees: worktreeSurvey
      ? {
          cleanupReadyCount: worktreeSurvey.cleanupReady.length,
          retainedCount: worktreeSurvey.retained.length,
          inProgressCount: worktreeSurvey.inProgress.length,
          diagnostics: [
            ...worktreeSurvey.cleanupReady.map(
              (worktreePath) =>
                `既定branchへmerge済みで後片付け可能です: ${worktreePath}`,
            ),
            ...worktreeSurvey.errors.map(
              (error) => `worktree走査を完了できませんでした: ${error}`,
            ),
          ],
        }
      : undefined,
    migration: legacy.length
      ? "診断のみ。旧資産は実行も変換もしません"
      : "なし",
  };
}
