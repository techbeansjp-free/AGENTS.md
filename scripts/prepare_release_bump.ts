import { spawnSync } from "node:child_process";
import { nextAutoReleaseVersion } from "../src/domain/release.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { parseJsonStrict, stableJson } from "../src/lib/security.js";
import { isPackageVersion } from "../src/lib/version.js";

/**
 * release bump branchを基準SHA `B` から作り直し、品質gateの対象headを確定する。
 *
 * **導出元は常に`B`である**（Issue #1051のINV-04）。既存branchは導出元ではなく、
 * 書き換えを省けるかの判定材料としてのみ参照する（INV-06）。成立させられない場合は
 * remoteを更新せず非0で終了する（INV-05）。
 *
 * 引数を取らず、対象はprocessの`cwd`である。**正常時は何も出力しない。**
 */

/** bump commitのsubject接頭辞。`scripts/check_file_audit.ts`の除外条件と一致させる。 */
const BUMP_SUBJECT_PREFIX = "chore(release): bump version to ";

/** 正規bump差分が触れてよいfile。TERM-ASC-081の閉じた集合の外延。 */
const BUMP_PATHS = ["package.json", "package-lock.json"] as const;

const COMMIT_IDENTITY = [
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=41898282+github-actions[bot]@users.noreply.github.com",
];

class PrepareBumpError extends Error {}

function stop(reason: string): never {
  throw new PrepareBumpError(reason);
}

function git(
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: result.error
      ? `${String(result.stderr ?? "")}${result.error.message}`
      : String(result.stderr ?? ""),
  };
}

/**
 * 終了値を確認してからstdoutを使う。
 *
 * **終了値を見ずに出力だけを使うと壊れた値を掴む。** `git rev-parse "<sha>^"`は
 * root commitに対して非0で終了しながらstdoutへ`<sha>^`を出力する（Issue #1051のE-08）。
 */
function gitOutput(args: string[], cwd: string, reason: string): string {
  const result = git(args, cwd);
  if (result.status !== 0) stop(`${reason}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function readAt(commit: string, file: string, cwd: string): string {
  return gitOutput(
    ["show", `${commit}:${file}`, "--"],
    cwd,
    `${commit}の${file}を読めません`,
  );
}

function versionOf(source: string, file: string): string {
  const value = parseJsonStrict(source, file);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    stop(`${file}がobjectではありません`);
  const version = (value as Record<string, unknown>).version;
  if (typeof version !== "string")
    stop(`${file}のversionが文字列ではありません`);
  return version;
}

/** 3 fieldを取り除いた残余を返す。取り除けない構造は`undefined`にして呼び出し側で拒否する。 */
function withoutBumpFields(
  manifest: string,
  lockfile: string,
): { residue: string; fields: string[] } | undefined {
  const parsedManifest = parseJsonStrict(manifest, "package.json");
  const parsedLockfile = parseJsonStrict(lockfile, "package-lock.json");
  if (
    typeof parsedManifest !== "object" ||
    parsedManifest === null ||
    Array.isArray(parsedManifest) ||
    typeof parsedLockfile !== "object" ||
    parsedLockfile === null ||
    Array.isArray(parsedLockfile)
  )
    return undefined;
  const manifestRecord = { ...(parsedManifest as Record<string, unknown>) };
  const lockfileRecord = { ...(parsedLockfile as Record<string, unknown>) };
  const packages = lockfileRecord.packages;
  if (
    typeof packages !== "object" ||
    packages === null ||
    Array.isArray(packages)
  )
    return undefined;
  const rootPackage = (packages as Record<string, unknown>)[""];
  if (
    typeof rootPackage !== "object" ||
    rootPackage === null ||
    Array.isArray(rootPackage)
  )
    return undefined;
  const fields = [
    manifestRecord.version,
    lockfileRecord.version,
    (rootPackage as Record<string, unknown>).version,
  ];
  if (fields.some((field) => typeof field !== "string")) return undefined;
  const strippedRoot = { ...(rootPackage as Record<string, unknown>) };
  delete strippedRoot.version;
  delete manifestRecord.version;
  delete lockfileRecord.version;
  lockfileRecord.packages = {
    ...(packages as Record<string, unknown>),
    "": strippedRoot,
  };
  return {
    residue: stableJson([manifestRecord, lockfileRecord]),
    fields: fields as string[],
  };
}

/**
 * `before`と`after`の差分が正規bump差分（TERM-ASC-081）だけかを2段階で判定する。
 *
 * **第1段階で変更後の3 fieldがすべて`V`であることを確認してから、第2段階で残余を比較する。**
 * 双方の3 fieldを`V`へ置換してから比較する単段の判定は、変更後の誤値を隠す
 * （Issue #1051のH-03。`package-lock.json`の2 fieldが`999.0.0`でも一致してしまう）。
 */
/**
 * `__proto__`をmember keyに持つJSONを拒否する。
 *
 * **strict parserは`__proto__`をown propertyとして保持しない。** 素のobjectへ
 * `object[key] = value`で組み立てるとprototype setterが働き、`Object.entries`にも
 * 安定化比較にも現れない。その結果、`__proto__`だけを変えた差分が正規bump差分として
 * 通ってしまう。parserは保護fileであり本件では変更しないため、**入口でfail-closedにする。**
 * `package.json`と`package-lock.json`はこのkeyを正当に持たない。
 *
 * **rawな文字列一致では足りない。** JSON keyはescapeで書けるため、`"__\u0070roto__"`は
 * 同じkeyでありながら`"__proto__"`という並びを持たない。逆に、値の中に同じ断片を含む
 * 正当なJSONを誤って拒否する。**decode後のmember keyだけを見る。** `JSON.parse`は
 * DefineOwnPropertyでobjectを組むためreviverのkeyへ`__proto__`が現れる。
 */
function containsProtoKey(source: string): boolean {
  let found = false;
  try {
    JSON.parse(source, function reviver(key: string, value: unknown): unknown {
      if (key === "__proto__") found = true;
      return value;
    });
  } catch {
    return true;
  }
  return found;
}

export function canonicalBumpDiff(
  before: { manifest: string; lockfile: string },
  after: { manifest: string; lockfile: string },
  version: string,
): boolean {
  if (
    [before.manifest, before.lockfile, after.manifest, after.lockfile].some(
      containsProtoKey,
    )
  )
    return false;
  const strippedAfter = withoutBumpFields(after.manifest, after.lockfile);
  const strippedBefore = withoutBumpFields(before.manifest, before.lockfile);
  if (!strippedAfter || !strippedBefore) return false;
  if (!strippedAfter.fields.every((field) => field === version)) return false;
  return strippedAfter.residue === strippedBefore.residue;
}

function changedPaths(base: string, candidate: string, cwd: string): string[] {
  const output = gitOutput(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--name-only",
      base,
      candidate,
      "--",
    ],
    cwd,
    "候補の差分pathを取得できません",
  );
  return output.split(/\r?\n/u).filter(Boolean);
}

/** 既存head `R` を書き換えずに再利用してよいか（TB-B01の3条件）。 */
function reusable(
  head: string,
  base: string,
  candidateTree: string,
  version: string,
  cwd: string,
): boolean {
  const parents = gitOutput(
    ["rev-list", "--parents", "-n", "1", head],
    cwd,
    "既存headの親を取得できません",
  ).split(/\s+/u);
  if (parents.length !== 2 || parents[1] !== base) return false;
  const tree = gitOutput(
    ["rev-parse", "--verify", `${head}^{tree}`],
    cwd,
    "既存headのtreeを取得できません",
  );
  if (tree !== candidateTree) return false;
  const subject = gitOutput(
    ["show", "-s", "--format=%s", head],
    cwd,
    "既存headのsubjectを取得できません",
  );
  return subject.startsWith(`${BUMP_SUBJECT_PREFIX}${version}`);
}

/**
 * 観測済みremote headに対する条件付き更新でpushする。
 *
 * **未作成refにも空expectのleaseを使う。** 通常pushは、未作成と観測した後に別主体が
 * 作成した場合をfast-forwardとして受理し競合を素通りする（E-04）。空expect leaseは
 * 未作成なら作成し、先を越されていれば拒否する（E-05・E-06）。
 * **`git push`の結果をパイプで受けない**（E-09）。
 */
function pushWithLease(branch: string, expected: string, cwd: string): void {
  const reference = `refs/heads/${branch}`;
  const result = git(
    [
      "push",
      `--force-with-lease=${reference}:${expected}`,
      "origin",
      `HEAD:${reference}`,
    ],
    cwd,
  );
  if (result.status !== 0)
    stop(
      `bump branchのremote refを条件付き更新できません: ${result.stderr.trim()}`,
    );
}

export function prepareReleaseBump(
  cwd: string,
  environment: NodeJS.ProcessEnv,
): void {
  const version = environment.RELEASE_VERSION;
  if (typeof version !== "string" || !isPackageVersion(version))
    stop("RELEASE_VERSIONが有効なpackage versionではありません");
  if (git(["fetch", "origin", "main"], cwd).status !== 0)
    stop("既定branchをfetchできないため基準SHAを確定できません");
  const base = gitOutput(
    ["rev-parse", "--verify", "origin/main^{commit}"],
    cwd,
    "基準SHAを確定できません",
  );
  const baseManifest = readAt(base, "package.json", cwd);
  const baseVersion = versionOf(baseManifest, "package.json");
  if (baseVersion === version) {
    gitOutput(["switch", "--detach", base], cwd, "基準SHAをdetachできません");
    return;
  }
  if (nextAutoReleaseVersion(baseVersion) !== version)
    stop(
      `目標versionが基準SHAのversionの次版ではありません: 基準SHA ${baseVersion} 目標 ${version}`,
    );
  gitOutput(["switch", "--detach", base], cwd, "基準SHAをdetachできません");
  /**
   * **`--ignore-scripts`を外さない。** これが無いと`B`の`preversion`・`version`・
   * `postversion`が動く。lifecycleは判定より前に任意のcommandを実行できるため、
   * 「書き込みは最後の1回のpushだけ」も「失敗時にremoteを更新しない」も破れる。
   * `npm version`が設定した3 fieldを`version` lifecycleが書き戻すこともできる。
   */
  const bump = spawnSync(
    "npm",
    [
      "version",
      version,
      "--no-git-tag-version",
      "--allow-same-version",
      "--ignore-scripts",
    ],
    { cwd, encoding: "utf8" },
  );
  if (bump.status !== 0)
    stop(`versionを更新できません: ${String(bump.stderr ?? "").trim()}`);
  gitOutput(["add", ...BUMP_PATHS], cwd, "正規bump差分をstageできません");
  gitOutput(
    [
      ...COMMIT_IDENTITY,
      "commit",
      "--message",
      `${BUMP_SUBJECT_PREFIX}${version} [skip ci]`,
    ],
    cwd,
    "bump commitを作成できません",
  );
  const candidate = gitOutput(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    cwd,
    "候補commitを確定できません",
  );
  const paths = changedPaths(base, candidate, cwd);
  if (
    paths.length !== BUMP_PATHS.length ||
    !BUMP_PATHS.every((file) => paths.includes(file))
  )
    stop(`正規bump差分を超えるpathが含まれます: ${paths.join("、")}`);
  if (
    !canonicalBumpDiff(
      {
        manifest: baseManifest,
        lockfile: readAt(base, "package-lock.json", cwd),
      },
      {
        manifest: readAt(candidate, "package.json", cwd),
        lockfile: readAt(candidate, "package-lock.json", cwd),
      },
      version,
    )
  )
    stop("候補の差分が正規bump差分を超えています");
  const branch = `release/bump-v${version}`;
  const listed = git(["ls-remote", "origin", `refs/heads/${branch}`], cwd);
  if (listed.status !== 0)
    stop(`bump branchのremote headを観測できません: ${listed.stderr.trim()}`);
  const observed = listed.stdout.trim().split(/\s+/u)[0] ?? "";
  if (observed === "") {
    pushWithLease(branch, "", cwd);
    return;
  }
  gitOutput(
    ["fetch", "origin", `refs/heads/${branch}`],
    cwd,
    "既存bump branchをfetchできません",
  );
  const candidateTree = gitOutput(
    ["rev-parse", "--verify", `${candidate}^{tree}`],
    cwd,
    "候補のtreeを取得できません",
  );
  if (reusable(observed, base, candidateTree, version, cwd)) {
    gitOutput(
      ["switch", "--detach", observed],
      cwd,
      "既存bump branchをdetachできません",
    );
    return;
  }
  pushWithLease(branch, observed, cwd);
}

if (isExecutionEntry(import.meta.url)) {
  try {
    prepareReleaseBump(process.cwd(), process.env);
  } catch (error) {
    process.stderr.write(
      `${error instanceof PrepareBumpError ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
