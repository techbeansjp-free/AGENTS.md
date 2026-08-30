import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { PocDeclaration } from "../domain/mode.js";
import {
  POC_OBSERVATION_SCHEMA,
  pocDeclarationDigest,
  pocObservationEvidenceDigest,
  pocObservationResultDigest,
  pocScenarioExecutionDigest,
  type PocObservationEvidence,
  type PocObservationResult,
  type PocScenarioExecution,
} from "../domain/poc-observation.js";
import { resolveContained, stableJson } from "../lib/security.js";

interface PocFixtureEntry {
  relative: string;
  kind: "directory" | "file";
  digest?: string;
}

interface PocHeadFixtureEntry extends PocFixtureEntry {
  content?: Buffer;
}

const MAX_ENTRIES = 256;
const MAX_DEPTH = 16;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const FIXED_GIT = "/usr/bin/git";
const FIXED_BWRAP = "/usr/bin/bwrap";
const FIXED_PRLIMIT = "/usr/bin/prlimit";

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectPocFixture(root: string): PocFixtureEntry[] {
  const resolved = path.resolve(root);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("PoC fixtureはsymlinkでない通常directoryが必要です");
  if (fs.realpathSync(resolved) !== resolved)
    throw new Error("PoC fixtureにsymlink祖先を使用できません");
  const entries: PocFixtureEntry[] = [];
  let totalBytes = 0;
  const visit = (directory: string, parent: string): void => {
    for (const item of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => lexicalCompare(left.name, right.name))) {
      if (item.name.normalize("NFC") !== item.name || item.name === ".git")
        throw new Error("PoC fixtureに非NFC名または.gitを含められません");
      const relative = parent ? `${parent}/${item.name}` : item.name;
      if (relative.split("/").length > MAX_DEPTH)
        throw new Error(
          `PoC fixtureのpath depthが上限を超えています: ${relative}`,
        );
      const absolute = path.join(directory, item.name);
      const itemStat = fs.lstatSync(absolute);
      if (itemStat.isSymbolicLink())
        throw new Error(`PoC fixtureのsymlinkを拒否しました: ${relative}`);
      if (fs.realpathSync(absolute) !== absolute)
        throw new Error(`PoC fixtureのsymlink祖先を拒否しました: ${relative}`);
      if (itemStat.isDirectory()) {
        entries.push({ relative, kind: "directory" });
        visit(absolute, relative);
      } else if (itemStat.isFile()) {
        if (itemStat.nlink !== 1)
          throw new Error(`PoC fixtureのhardlinkを拒否しました: ${relative}`);
        if (itemStat.size > MAX_FILE_BYTES)
          throw new Error(`PoC fixture fileが上限を超えています: ${relative}`);
        totalBytes += itemStat.size;
        if (totalBytes > MAX_TOTAL_BYTES)
          throw new Error("PoC fixtureの総byte数が上限を超えています");
        entries.push({
          relative,
          kind: "file",
          digest: sha256(fs.readFileSync(absolute)),
        });
      } else
        throw new Error(
          `PoC fixtureは通常fileとdirectoryだけを使用できます: ${relative}`,
        );
      if (entries.length > MAX_ENTRIES)
        throw new Error("PoC fixtureのentry数が上限を超えています");
    }
  };
  visit(resolved, "");
  return entries;
}

export function calculatePocFixtureDigest(root: string): string {
  return sha256(stableJson(inspectPocFixture(root)));
}

function fixedExecutable(file: string, label: string): void {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0)
    throw new Error(`PoC隔離実行には固定${file} (${label}) が必要です`);
}

function gitDirectories(repositoryRoot: string): {
  gitDirectory: string;
  commonDirectory: string;
  gitDirectoryInWorktree: boolean;
} {
  const dotGit = path.join(repositoryRoot, ".git");
  const stat = fs.lstatSync(dotGit);
  let gitDirectory: string;
  let gitDirectoryInWorktree = false;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    gitDirectory = dotGit;
    gitDirectoryInWorktree = true;
  } else if (stat.isFile() && !stat.isSymbolicLink()) {
    const match = /^gitdir: (.+)\n?$/u.exec(fs.readFileSync(dotGit, "utf8"));
    if (!match) throw new Error("PoC repositoryの.git fileが不正です");
    gitDirectory = path.resolve(repositoryRoot, match[1]!);
  } else throw new Error("PoC repositoryの.git境界が不正です");
  if (!fs.lstatSync(gitDirectory).isDirectory())
    throw new Error(
      "PoC repositoryのGit directoryが通常directoryではありません",
    );
  const commonFile = path.join(gitDirectory, "commondir");
  const commonDirectory = fs.existsSync(commonFile)
    ? path.resolve(gitDirectory, fs.readFileSync(commonFile, "utf8").trim())
    : gitDirectory;
  if (!fs.lstatSync(commonDirectory).isDirectory())
    throw new Error("PoC repositoryのGit common directoryが不正です");
  return { gitDirectory, commonDirectory, gitDirectoryInWorktree };
}

function runFixedGit(repositoryRoot: string, args: string[]): Buffer {
  fixedExecutable(FIXED_GIT, "Git");
  const directories = gitDirectories(repositoryRoot);
  const gitDirectory = directories.gitDirectoryInWorktree
    ? "/repo/.git"
    : "/gitdir";
  const commonDirectory =
    directories.commonDirectory === directories.gitDirectory
      ? gitDirectory
      : "/git-common";
  const extraMounts = [
    ...(directories.gitDirectoryInWorktree
      ? []
      : ["--ro-bind", directories.gitDirectory, "/gitdir"]),
    ...(directories.commonDirectory === directories.gitDirectory
      ? []
      : ["--ro-bind", directories.commonDirectory, "/git-common"]),
  ];
  const result = spawnSync(
    FIXED_PRLIMIT,
    [
      "--cpu=10",
      "--fsize=1048576",
      "--nofile=64",
      "--as=536870912",
      "--",
      FIXED_BWRAP,
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--dev",
      "/dev",
      "--ro-bind-try",
      "/lib",
      "/lib",
      "--ro-bind-try",
      "/lib64",
      "/lib64",
      "--dir",
      "/runtime",
      "--ro-bind",
      FIXED_GIT,
      "/runtime/git",
      "--ro-bind",
      repositoryRoot,
      "/repo",
      ...extraMounts,
      "--chdir",
      "/repo",
      "--clearenv",
      "--setenv",
      "GIT_CONFIG_GLOBAL",
      "/dev/null",
      "--setenv",
      "GIT_CONFIG_NOSYSTEM",
      "1",
      "--setenv",
      "GIT_NO_LAZY_FETCH",
      "1",
      "--setenv",
      "GIT_NO_REPLACE_OBJECTS",
      "1",
      "--setenv",
      "GIT_OPTIONAL_LOCKS",
      "0",
      "--setenv",
      "GIT_DIR",
      gitDirectory,
      "--setenv",
      "GIT_COMMON_DIR",
      commonDirectory,
      "--setenv",
      "GIT_WORK_TREE",
      "/repo",
      "--setenv",
      "LANG",
      "C.UTF-8",
      "/runtime/git",
      ...args,
    ],
    {
      encoding: null,
      timeout: 10_000,
      maxBuffer: MAX_TOTAL_BYTES + 1024 * 1024,
      env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" },
    },
  );
  if (result.error || result.status !== 0 || result.signal !== null)
    throw new Error(
      `PoC fixtureのGit HEAD検証に失敗しました: ${result.error?.message ?? Buffer.from(result.stderr ?? []).toString("utf8")}`,
    );
  return result.stdout ?? Buffer.alloc(0);
}

export function assertPocHeadChangeScope(input: {
  repositoryRoot: string;
  baselineHeadSha: string;
  headSha: string;
  fixtureRoot: string;
}): string[] {
  if (
    !/^[a-f0-9]{40}$/u.test(input.baselineHeadSha) ||
    !/^[a-f0-9]{40}$/u.test(input.headSha)
  )
    throw new Error(
      "PoC change scopeには完全なbaseline/current HEAD SHAが必要です",
    );
  const mergeBase = runFixedGit(input.repositoryRoot, [
    "merge-base",
    input.baselineHeadSha,
    input.headSha,
  ])
    .toString("utf8")
    .trim();
  if (mergeBase !== input.baselineHeadSha)
    throw new Error("PoC baselineはcurrent HEADのancestorでなければなりません");
  const chunks = runFixedGit(input.repositoryRoot, [
    "-c",
    "diff.external=",
    "-c",
    "diff.ignoreSubmodules=none",
    "diff-tree",
    "-r",
    "--no-commit-id",
    "--raw",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    input.baselineHeadSha,
    input.headSha,
    "--",
  ])
    .toString("utf8")
    .split("\0");
  const paths: string[] = [];
  for (let index = 0; index < chunks.length - 1; index += 2) {
    const metadata = chunks[index];
    const changedPath = chunks[index + 1];
    if (!metadata || !changedPath)
      throw new Error("PoC actual Git diff recordが不正です");
    const match =
      /^:(\d{6}) (\d{6}) ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) ([AMD])$/u.exec(
        metadata,
      );
    if (!match)
      throw new Error("PoC actual Git diffのstatusまたは形式が不正です");
    if (
      !["000000", "100644", "100755"].includes(match[1]!) ||
      !["000000", "100644", "100755"].includes(match[2]!) ||
      (match[3] === match[4] && match[1] !== match[2])
    )
      throw new Error(
        `PoC actual Git diffのfile typeを拒否しました: ${changedPath}`,
      );
    if (
      changedPath.normalize("NFC") !== changedPath ||
      !changedPath.startsWith(`${input.fixtureRoot}/`)
    )
      throw new Error(
        `PoC actual Git diffがfixture root外です: ${changedPath}`,
      );
    paths.push(changedPath);
    if (paths.length > MAX_ENTRIES)
      throw new Error("PoC actual Git diffのpath数が上限を超えています");
  }
  if (paths.length === 0)
    throw new Error("PoC baselineからcurrent HEADへのfixture変更がありません");
  return paths;
}

function fixtureAtHead(input: {
  repositoryRoot: string;
  fixtureRelative: string;
  headSha: string;
}): PocHeadFixtureEntry[] {
  if (!/^[a-f0-9]{40}$/u.test(input.headSha))
    throw new Error("PoC fixtureの検証対象HEAD SHAが不正です");
  const topLevel = runFixedGit(input.repositoryRoot, [
    "rev-parse",
    "--show-toplevel",
  ])
    .toString("utf8")
    .trim();
  if (
    topLevel !== "/repo" ||
    fs.realpathSync(input.repositoryRoot) !== input.repositoryRoot
  )
    throw new Error(
      "PoC fixtureのrepository rootがGit worktree rootではありません",
    );
  const actualHead = runFixedGit(input.repositoryRoot, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ])
    .toString("utf8")
    .trim();
  if (actualHead !== input.headSha)
    throw new Error("PoC fixtureの検証対象HEADが現在のGit HEADと一致しません");
  const liveStatus = runFixedGit(input.repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
    "--",
    input.fixtureRelative,
  ]);
  if (liveStatus.byteLength !== 0)
    throw new Error(
      "PoC fixtureにHEADと不一致のdirty、untracked、ignored pathがあります",
    );
  const treeish = `${input.headSha}:${input.fixtureRelative}`;
  if (
    runFixedGit(input.repositoryRoot, ["cat-file", "-t", treeish])
      .toString("utf8")
      .trim() !== "tree"
  )
    throw new Error("PoC fixture rootはHEAD上のtreeでなければなりません");
  const records = runFixedGit(input.repositoryRoot, [
    "--literal-pathspecs",
    "ls-tree",
    "-r",
    "-t",
    "-z",
    treeish,
  ])
    .toString("utf8")
    .split("\0")
    .filter((record) => record !== "");
  if (records.length === 0 || records.length > MAX_ENTRIES)
    throw new Error("PoC fixture HEAD treeのentry数が不正です");
  const expected: PocHeadFixtureEntry[] = [];
  let totalBytes = 0;
  for (const record of records) {
    const match = /^(\d{6}) (blob|tree) ([a-f0-9]{40,64})\t(.+)$/u.exec(record);
    if (!match) throw new Error("PoC fixtureのGit tree recordが不正です");
    const [, mode, type, objectId, relative] = match;
    if (
      !relative ||
      relative.normalize("NFC") !== relative ||
      relative.split("/").some((part) => part === ".git" || part === "..") ||
      relative.split("/").length > MAX_DEPTH
    )
      throw new Error("PoC fixtureのGit tree pathが安全ではありません");
    if (type === "tree") expected.push({ relative, kind: "directory" });
    else {
      if (mode !== "100644" && mode !== "100755")
        throw new Error(
          `PoC fixtureのGit file modeを拒否しました: ${relative}`,
        );
      const content = runFixedGit(input.repositoryRoot, [
        "cat-file",
        "blob",
        objectId!,
      ]);
      if (content.byteLength > MAX_FILE_BYTES)
        throw new Error(
          `PoC fixture HEAD blobが上限を超えています: ${relative}`,
        );
      totalBytes += content.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error("PoC fixture HEAD blob総byte数が上限を超えています");
      expected.push({
        relative,
        kind: "file",
        digest: sha256(content),
        content,
      });
    }
  }
  expected.sort((left, right) => lexicalCompare(left.relative, right.relative));
  return expected;
}

function materializeFixture(
  target: string,
  entries: readonly PocHeadFixtureEntry[],
): void {
  fs.mkdirSync(target, { mode: 0o700 });
  for (const entry of entries) {
    const absolute = resolveContained(target, entry.relative, {
      allowMissingLeaf: true,
    });
    if (entry.kind === "directory") fs.mkdirSync(absolute, { mode: 0o700 });
    else {
      if (!entry.content)
        throw new Error(`PoC fixture HEAD blobがありません: ${entry.relative}`);
      fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
      fs.writeFileSync(absolute, entry.content, { flag: "wx", mode: 0o600 });
    }
  }
}

function fileDigest(file: string, label: string): string {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
    throw new Error(`${label}はsymlink・hardlinkでない通常fileが必要です`);
  if (fs.realpathSync(file) !== file)
    throw new Error(`${label}にsymlink祖先を使用できません`);
  return sha256(fs.readFileSync(file));
}

function permissionFlag(): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(process.versions.node);
  if (!match || Number(match[1]) < 20)
    throw new Error("PoC隔離runnerにはNode.js 20以上が必要です");
  const flag =
    Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 13)
      ? "--permission"
      : "--experimental-permission";
  const probe = spawnSync(
    process.execPath,
    ["--no-warnings", flag, "--eval", ""],
    {
      encoding: "utf8",
      timeout: 5_000,
      env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" },
    },
  );
  if (probe.status !== 0 || probe.signal !== null)
    throw new Error(
      "PoC隔離runnerのNode Permission Model preflightに失敗しました",
    );
  return flag;
}

function preflight(): string {
  fixedExecutable(FIXED_BWRAP, "bubblewrap");
  fixedExecutable(FIXED_PRLIMIT, "resource limiter");
  const bwrap = spawnSync(FIXED_BWRAP, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" },
  });
  const prlimit = spawnSync(FIXED_PRLIMIT, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" },
  });
  if (bwrap.status !== 0 || !/^bubblewrap \d/u.test(bwrap.stdout ?? ""))
    throw new Error("PoC隔離実行のbubblewrap preflightに失敗しました");
  if (
    prlimit.status !== 0 ||
    !/^prlimit from util-linux /u.test(prlimit.stdout ?? "")
  )
    throw new Error("PoC隔離実行のprlimit preflightに失敗しました");
  return permissionFlag();
}

export function executePocSandboxObservation(input: {
  repositoryRoot: string;
  declaration: PocDeclaration;
  baselineHeadSha: string;
  headSha: string;
  observedAt: string;
}): PocObservationEvidence {
  const permission = preflight();
  assertPocHeadChangeScope({
    repositoryRoot: input.repositoryRoot,
    baselineHeadSha: input.baselineHeadSha,
    headSha: input.headSha,
    fixtureRoot: input.declaration.fixture.root,
  });
  if (!input.declaration.fixture.root.startsWith("test/fixtures/poc/"))
    throw new Error("PoC fixtureはtest/fixtures/poc/配下が必要です");
  const headFixture = fixtureAtHead({
    repositoryRoot: input.repositoryRoot,
    fixtureRelative: input.declaration.fixture.root,
    headSha: input.headSha,
  });
  const headIdentity = headFixture.map(({ relative, kind, digest }) => ({
    relative,
    kind,
    ...(digest ? { digest } : {}),
  }));
  const sourceDigest = sha256(stableJson(headIdentity));
  const liveFixture = path.join(
    input.repositoryRoot,
    ...input.declaration.fixture.root.split("/"),
  );
  if (calculatePocFixtureDigest(liveFixture) !== sourceDigest)
    throw new Error(
      "PoC live fixtureのfile境界またはcontentがexact HEADと一致しません",
    );
  const headRunner = headFixture.find(
    ({ relative, kind }) =>
      relative === input.declaration.fixture.runner.path && kind === "file",
  );
  if (!headRunner?.digest)
    throw new Error("PoC runnerはHEAD fixture内の通常fileでなければなりません");
  const runnerDigest = headRunner.digest;

  const measured = new Map<string, PocObservationResult>();
  const executions: PocScenarioExecution[] = [];
  for (const scenario of input.declaration.scenarios) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "asc-poc-"));
    const scenarioRoot = path.join(temporary, "scenario");
    try {
      materializeFixture(scenarioRoot, headFixture);
      if (calculatePocFixtureDigest(scenarioRoot) !== sourceDigest)
        throw new Error(
          "PoC fixtureのHEAD一時copy digestがsourceと一致しません",
        );
      const copiedRunner = resolveContained(
        scenarioRoot,
        input.declaration.fixture.runner.path,
      );
      if (fileDigest(copiedRunner, "PoC一時copy runner") !== runnerDigest)
        throw new Error("PoC一時copy runner digestが宣言と一致しません");
      const outputRoot = path.join(temporary, "outputs");
      fs.mkdirSync(outputRoot, { mode: 0o700 });
      const outputFiles = new Map<string, string>();
      for (const observable of input.declaration.observables.filter(
        ({ scenarioId, kind }) =>
          scenarioId === scenario.id && kind === "file-digest",
      )) {
        if (!observable.target)
          throw new Error(
            `file-digest observable ${observable.id} にtargetがありません`,
          );
        const destination = resolveContained(scenarioRoot, observable.target);
        if (!fs.existsSync(destination) || !fs.lstatSync(destination).isFile())
          throw new Error(
            `PoC file-digest targetが通常fileではありません: ${observable.target}`,
          );
        const output = path.join(outputRoot, `${observable.id}.out`);
        fs.copyFileSync(destination, output, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(output, 0o600);
        outputFiles.set(observable.target, output);
      }
      const outputMounts = [...outputFiles.entries()].flatMap(
        ([target, output]) => ["--bind", output, `/scenario/${target}`],
      );
      const writePermissions = [...outputFiles.keys()].map(
        (target) => `--allow-fs-write=/scenario/${target}`,
      );
      const execution = spawnSync(
        FIXED_PRLIMIT,
        [
          "--cpu=20",
          "--fsize=1048576",
          "--nofile=64",
          "--as=805306368",
          "--",
          FIXED_BWRAP,
          "--unshare-all",
          "--die-with-parent",
          "--new-session",
          "--ro-bind-try",
          "/lib",
          "/lib",
          "--ro-bind-try",
          "/lib64",
          "/lib64",
          "--dir",
          "/runtime",
          "--ro-bind",
          process.execPath,
          "/runtime/node",
          "--ro-bind",
          scenarioRoot,
          "/scenario",
          ...outputMounts,
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--chdir",
          "/scenario",
          "--clearenv",
          "--setenv",
          "PATH",
          "/runtime",
          "--setenv",
          "LANG",
          "C.UTF-8",
          "/runtime/node",
          "--no-warnings",
          "--jitless",
          "--max-old-space-size=192",
          permission,
          "--allow-fs-read=/scenario",
          ...writePermissions,
          `/scenario/${input.declaration.fixture.runner.path}`,
          ...scenario.argv,
        ],
        {
          encoding: null,
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" },
        },
      );
      if (execution.error)
        throw new Error(
          `PoC隔離runner実行に失敗しました: ${execution.error.message}`,
        );
      const executionIdentity: Omit<PocScenarioExecution, "executionDigest"> = {
        scenarioId: scenario.id,
        exitCode: execution.status ?? -1,
        signal: execution.signal,
      };
      executions.push({
        ...executionIdentity,
        executionDigest: pocScenarioExecutionDigest(executionIdentity),
      });
      const stdout = execution.stdout ?? Buffer.alloc(0);
      const stderr = execution.stderr ?? Buffer.alloc(0);
      for (const observable of input.declaration.observables.filter(
        ({ scenarioId }) => scenarioId === scenario.id,
      )) {
        let actual: string | number;
        if (observable.kind === "exit-code") actual = execution.status ?? -1;
        else if (observable.kind === "stdout-digest") actual = sha256(stdout);
        else if (observable.kind === "stderr-digest") actual = sha256(stderr);
        else {
          if (!observable.target)
            throw new Error(
              `file-digest observable ${observable.id} にtargetがありません`,
            );
          const output = outputFiles.get(observable.target);
          if (!output)
            throw new Error(
              `PoC observable ${observable.id} の出力mountがありません`,
            );
          actual = fileDigest(output, `PoC observable ${observable.id}`);
        }
        const identity: Omit<PocObservationResult, "resultDigest"> = {
          observableId: observable.id,
          scenarioId: observable.scenarioId,
          kind: observable.kind,
          target: observable.target ?? null,
          expected: observable.expected,
          actual,
          status: actual === observable.expected ? "passed" : "failed",
        };
        measured.set(observable.id, {
          ...identity,
          resultDigest: pocObservationResultDigest(identity),
        });
      }
      if (fileDigest(copiedRunner, "PoC実行後runner") !== runnerDigest)
        throw new Error("PoC runnerが一時copy内で変更されました");
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const results = input.declaration.observables.map((observable) => {
    const result = measured.get(observable.id);
    if (!result)
      throw new Error(`PoC observable ${observable.id}を観測できませんでした`);
    return result;
  });
  if (
    executions.length !== input.declaration.scenarios.length ||
    executions.some(
      ({ exitCode, signal }) => exitCode !== 0 || signal !== null,
    ) ||
    results.some(({ status }) => status !== "passed")
  )
    throw new Error("PoC隔離runnerまたはobservableが不合格です");
  if (
    runFixedGit(input.repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignored=matching",
      "--",
      input.declaration.fixture.root,
    ]).byteLength !== 0
  )
    throw new Error("PoC実行後にlive fixtureがHEADからdriftしました");
  const identity: Omit<PocObservationEvidence, "evidenceDigest"> = {
    schemaVersion: POC_OBSERVATION_SCHEMA,
    declarationDigest: pocDeclarationDigest(input.declaration),
    headSha: input.headSha,
    observedAt: input.observedAt,
    fixture: {
      id: input.declaration.fixture.id,
      root: input.declaration.fixture.root,
      digest: sourceDigest,
    },
    runner: { ...input.declaration.fixture.runner, digest: runnerDigest },
    executions,
    results,
  };
  return {
    ...identity,
    evidenceDigest: pocObservationEvidenceDigest(identity),
  };
}
