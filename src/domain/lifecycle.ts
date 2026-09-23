import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileNoReplace } from "../lib/atomic.js";
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
const NAMESPACE_ASSETS = [
  "docs",
  "skills",
  "templates",
  "schemas",
  "policy",
  "hooks",
];
const MANAGED_RECORD = ".agent-skill-chain/managed-assets.json";
const MANAGED_RECORDS = ".agent-skill-chain/managed-assets-records";
const MANAGED_MUTATION_LOCK = ".agent-skill-chain/managed-assets-mutation.lock";
const HOST_SKILL_SOURCE = ".agent-skill-chain/skills/asc-step/SKILL.md";
const HOST_SKILL_TARGETS = [
  ".claude/skills/asc-step/SKILL.md",
  ".agents/skills/asc-step/SKILL.md",
] as const;
/**
 * 強制点hookの正本と、hostごとの展開先（Issue #1105）。
 *
 * **skillとhookは責務が違う。** skillは呼び出されたときに読まれる登録口であり、
 * hookはhostのtool呼び出し前に**利用者の操作なしに毎回走る**。同じ配布機構を
 * 使うが、`HOST_SKILL_TARGETS`とは別の定数に分ける。
 *
 * **共通のloopへまとめない。** まとめると、展開先の一覧を消す変異がskillと
 * hookの両方を同時に消し、片方だけを壊す変異を検出できなくなる。
 *
 * **配るのは本体だけである。** hostの設定fileへ登録を書き込まない。登録は
 * 利用者・hostが所有する共有設定への書き込みであり、`install`の権限を
 * 「packageの資産を置く」から「以後のtool callごとに自動実行されるcodeを
 * 登録する」へ広げる。登録状態は`doctor`が報告するだけにとどめる。
 */
const HOST_HOOK_SOURCE = ".agent-skill-chain/hooks/asc-contract-citation.mjs";
const HOST_HOOK_TARGETS = [
  ".claude/hooks/asc-contract-citation.mjs",
  ".codex/hooks/asc-contract-citation.mjs",
] as const;
/**
 * hookの登録を観測するproject-localの設定file（Issue #1105）。
 *
 * **読むだけで書かない。** ここへ`install`が書き込むと、`install`の権限が
 * 「以後のtool callごとに自動実行されるcodeを登録する」まで広がる。
 */
const HOST_HOOK_SETTINGS = ".claude/settings.local.json";

/**
 * project-localの設定にhookのentryがあるかを返す純関数（Issue #1105）。
 *
 * **filesystemを読まない。** 設定の内容を引数で受ける。読み取りは呼び出し側が行う。
 *
 * **`healthy`を変えない。** 返すのは観測であって判定ではない。project-localの
 * 設定だけを見ており、global・managed・plugin経由の有効化状態は見えない。
 * **「hookが無効です」と断定しない。**
 */
export function inspectHookRegistration(input: {
  readonly settings: string | undefined;
  readonly expectedCommandFragment: string;
}): { registered: boolean; reason: string } {
  if (input.settings === undefined)
    return {
      registered: false,
      reason: `${HOST_HOOK_SETTINGS}がありません。project-localの登録は確認できません`,
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.settings);
  } catch {
    return {
      registered: false,
      reason: `${HOST_HOOK_SETTINGS}をJSONとして解釈できません。project-localの登録は確認できません`,
    };
  }
  /**
   * **entryの形ではなくcommandの字面を見る。** 別のcommandのentryが1件あるだけで
   * 登録済みと数えると、未登録を見逃す。
   */
  const found = JSON.stringify(parsed).includes(input.expectedCommandFragment);
  return found
    ? {
        registered: true,
        reason: `${HOST_HOOK_SETTINGS}に期待entryがあります`,
      }
    : {
        registered: false,
        reason: `${HOST_HOOK_SETTINGS}に期待entryがありません。global・managed・plugin経由の有効化状態は未確認です`,
      };
}
const SHA256 = /^[a-f0-9]{64}$/u;

interface ManagedAssetRecord {
  version: unknown;
  files: Record<string, string>;
}

interface ManagedRecordSnapshot {
  schemaVersion: 1;
  parent: string;
  record: ManagedAssetRecord;
  payloadDigest: string;
}

function sha256Bytes(contents: string): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

/** Test the actual filesystem's hardlink operation before changing assets. */
function assertSnapshotPublicationSupported(
  target: string,
  recordPresent: boolean,
): void {
  // Exercise the actual publication primitive, including its descriptor path
  // on Linux. The probe lives outside the snapshot chain.
  const directory = recordPresent
    ? snapshotDirectory(target)
    : path.join(target, ".agent-skill-chain");
  const destination = path.join(
    directory,
    `.record-link-probe-${process.pid}-${crypto.randomBytes(12).toString("hex")}.tmp`,
  );
  let published = false;
  try {
    writeFileNoReplace(destination, "probe");
    published = true;
  } finally {
    // A competing entry which made link fail is never ours to remove.
    if (published) fs.rmSync(destination);
  }
}

function snapshotDirectory(target: string): string {
  const directory = path.join(target, MANAGED_RECORDS);
  if (pathEntryExists(directory) && !fs.lstatSync(directory).isDirectory())
    throw new Error(
      `managed asset snapshot directoryが通常directoryではありません: ${MANAGED_RECORDS}`,
    );
  return directory;
}

function snapshotEntries(target: string): string[] {
  const directory = snapshotDirectory(target);
  if (!pathEntryExists(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter(
      (name) =>
        !/^\.(?:(?:legacy|snapshot)-[a-f0-9]{64}|record-link-probe(?:-target)?)\.json\.tmp-[0-9]+-[a-f0-9]{24}$/u.test(
          name,
        ) &&
        !/^\.record-link-probe-[0-9]+-[a-f0-9]{24}\.tmp$/u.test(name) &&
        !/^\.\.record-link-probe-[0-9]+-[a-f0-9]{24}\.tmp\.tmp-[0-9]+-[a-f0-9]{24}$/u.test(
          name,
        ),
    );
}

function hasManagedAssetRecord(target: string): boolean {
  if (pathEntryExists(path.join(target, MANAGED_RECORD))) return true;
  const directory = path.join(target, MANAGED_RECORDS);
  if (!pathEntryExists(directory)) return false;
  if (!fs.lstatSync(directory).isDirectory()) return true;
  return snapshotEntries(target).length > 0;
}

/** Serialize cooperative lifecycle apply operations before observing assets. */
function withManagedMutationLock<T>(
  target: string,
  action: (markDirty: () => void) => T,
  complete: (result: T) => boolean = () => true,
): T {
  const parent = path.join(target, ".agent-skill-chain");
  const parentWasPresent = pathEntryExists(parent);
  fs.mkdirSync(parent, { recursive: true });
  const lockDirectory = path.join(target, MANAGED_MUTATION_LOCK);
  try {
    fs.mkdirSync(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST")
      throw new Error(
        `${MANAGED_MUTATION_LOCK}が既にあります。進行中の操作または中断を確認し、recordと資産を照合するまで再実行しないでください`,
        { cause: error },
      );
    throw error;
  }
  let dirty = false;
  let finished = false;
  try {
    const result = action(() => {
      dirty = true;
    });
    finished = complete(result);
    return result;
  } finally {
    // An interrupted write leaves the lock as evidence until an operator
    // reconciles record and assets; never turn an old record into success.
    if (!dirty || finished) {
      try {
        fs.rmdirSync(lockDirectory);
      } finally {
        if (!parentWasPresent) {
          try {
            fs.rmdirSync(parent);
          } catch {
            // An operation created assets or a concurrent entry; preserve it.
          }
        }
      }
    }
  }
}

function validateManagedAssetRecord(
  target: string,
  parsed: unknown,
): {
  record: ManagedAssetRecord;
  assets: ManagedAsset[];
} {
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
  return { record: { version: parsed.version, files }, assets };
}

function readCurrentManagedRecord(target: string): {
  recordPath: string;
  parent: string;
  record: ManagedAssetRecord;
  assets: ManagedAsset[];
  snapshotPaths: string[];
} {
  const legacyEntry = path.join(target, MANAGED_RECORD);
  if (!pathEntryExists(legacyEntry))
    throw new Error(
      `managed asset recordの旧anchorがありません。${MANAGED_RECORDS}のsnapshotを保持して中止します`,
    );
  if (pathEntryExists(legacyEntry) && !isRegularFile(legacyEntry))
    throw new Error(
      `managed asset recordは通常fileでなければなりません: ${MANAGED_RECORD}`,
    );
  const recordPath = resolveContained(target, MANAGED_RECORD);
  if (!isRegularFile(recordPath))
    throw new Error(
      `managed asset recordは通常fileでなければなりません: ${MANAGED_RECORD}`,
    );
  const legacySource = fs.readFileSync(recordPath, "utf8");
  let current = validateManagedAssetRecord(
    target,
    parseJsonStrict(legacySource, "managed asset record"),
  );
  let parent = `legacy-${sha256Bytes(legacySource)}`;
  let currentPath = recordPath;
  const entries = snapshotEntries(target);
  const remaining = new Set(entries);
  const snapshotPaths: string[] = [];
  while (remaining.has(`${parent}.json`)) {
    const name = `${parent}.json`;
    const file = path.join(snapshotDirectory(target), name);
    if (!isRegularFile(file))
      throw new Error(
        `managed asset snapshotは通常fileでなければなりません: ${name}`,
      );
    const descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    let source: string;
    try {
      if (!fs.fstatSync(descriptor).isFile())
        throw new Error(`managed asset snapshotが不正です: ${name}`);
      source = fs.readFileSync(descriptor, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    const parsed = parseJsonStrict(source, `managed asset snapshot ${name}`);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      parsed.parent !== parent ||
      typeof parsed.payloadDigest !== "string" ||
      !SHA256.test(parsed.payloadDigest)
    )
      throw new Error(`managed asset snapshotが不正です: ${name}`);
    const candidate = validateManagedAssetRecord(target, parsed.record);
    const payload = JSON.stringify({
      schemaVersion: 1,
      parent,
      record: candidate.record,
    });
    if (sha256Bytes(payload) !== parsed.payloadDigest)
      throw new Error(`managed asset snapshotのdigestが一致しません: ${name}`);
    current = candidate;
    currentPath = file;
    snapshotPaths.push(file);
    parent = `snapshot-${parsed.payloadDigest}`;
    remaining.delete(name);
  }
  if (remaining.size > 0)
    throw new Error(
      `managed asset snapshotの連鎖に未接続のentryがあります: ${[...remaining].join(", ")}`,
    );
  return { recordPath: currentPath, parent, ...current, snapshotPaths };
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
    /**
     * **hookの展開先も同じ扱いにする**（Issue #1105）。ここへ足さないと、
     * 展開はされるがrecord検証で拒否され、`update`と`delete`が使えなくなる。
     * 上の`ROOT_ASSETS`のコメントが警告しているのと同じ罠である。
     */
    HOST_HOOK_TARGETS.includes(
      normalized as (typeof HOST_HOOK_TARGETS)[number],
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
  /** **対象を名指しして投げ直す**（Issue #1305、fable H-2）。`mappings`と同じ理由である。 */
  try {
    return resolveContained(target, portable, { allowMissingLeaf: true });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`${cause}: ${portable}`, { cause: error });
  }
}

function readManagedAssetRecord(target: string): {
  recordPath: string;
  record: ManagedAssetRecord;
  assets: ManagedAsset[];
} {
  return readCurrentManagedRecord(target);
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
  /**
   * **境界外拒否は対象を名指しする**（Issue #1305、fable H-2）。
   *
   * INV-02の正準文は「どのcommandもこれを満たさない場合はcommandを名指しせず、
   * **解消すべき原因と対象を名指しする**」である。`resolveContained`が投げる
   * `シンボリックリンクによる境界外移動を拒否しました`は**対象pathを含まない。**
   * そのため112資産のうちどれが境界外を指しているのか利用者に分からず、
   * `install`・`update`・`delete`の3 commandがどれも同じ文だけを返していた。
   * **閉路ではないが、製品の外へ出ないと解消できない行き止まりである。**
   *
   * `src/lib/security.ts`は信頼品質契約の保護対象なので投げ元は変えない。
   * **呼び出し側で対象を付けて投げ直す。** `readManagedAssetRecord`は同じ理由で
   * 既にrecord pathを名指ししており、ここはその同型の欠陥が残っていた1箇所である。
   */
  const destination = (relative: string): string => {
    try {
      return resolveContained(target, relative, { allowMissingLeaf: true });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`${cause}: ${relative.replaceAll("\\", "/")}`, {
        cause: error,
      });
    }
  };
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
  for (const relative of HOST_HOOK_TARGETS)
    result.push({
      src: path.join(packageRoot, HOST_HOOK_SOURCE),
      dest: destination(relative),
    });
  return result;
}

/**
 * 案内する復旧手段を、実際に成功する手段だけに限る（Issue #1305、R2-H03）。
 *
 * **成功しない手段を名指ししない。** 以前は`update`を無条件に名指ししていたが、
 * 境界外symlinkや壊れたrecordが残る状態では`update`自身が拒否する。名指しした
 * 手段が失敗する案内は、利用者を1周させるだけで進行しない。
 *
 * **判定にはpreviewを使う。** `upgrade`の`apply: false`は書き込みを行わずに
 * 分類まで到達するため、「同じ状態で`update`が成功するか」の副作用の無い
 * oracleになる。照会とコマンドを分離した既存設計をそのまま使い、新しい検査を
 * 足さない。
 *
 * previewが拒否した場合は、その原因をそのまま返す。**原因を解消すべき対象として
 * 名指しし、成功しない手段は名指ししない。**
 */
/**
 * record不在の最小診断を作る（Issue #1305）。
 *
 * **手順・内訳・分岐の助言をここで作らない。** 4ラウンド連続で、この案内文だけから
 * 新しいHighが出た。原因は構造にある。1本のcaller非依存な文字列を`init`・`upgrade`門・
 * `uninstall`の3 callerへ連結すると、**callerごとに真偽が変わる文**になる。
 * `install`の名指しは`init`では拒否の閉路、`delete`では誤誘導、`update`でだけ正しい。
 *
 * **手順の正本は配布される利用案内である。** `.agent-skill-chain/00_利用案内.md`が
 * 復旧手順・`--dry-run`・retainの意味・未導入directoryでの帰結を既に所有しており、
 * error文字列はそれを複製していた。運用ポリシーの「手段の追加より既存手段の縮小を
 * 先に評価する」に従い、複製を消す。
 *
 * したがってここが返すのは次の2つだけである。
 *
 * - 同じ状態で`--recover-record`が製品判定により拒否されるなら、その原因。**commandを
 *   名指ししない。** previewが拒否された手段は、INV-02が名指しを禁じる
 * - そうでないなら、明示指定が必要であるという事実。**このときだけ所属commandを
 *   名指しする**
 *
 * **所属commandの名指しはこの1経路に限る**（Issue #1305、fable H-01）。縮小の初版は
 * どちらの分岐でも`--recover-record`というflag名だけを返していた。`--recover-record`は
 * `update`のflagであって`delete`のflagではないが、**CLIは宣言外のflagを黙って捨てる**
 * （`delete --apply --totally-bogus-flag`が同じ拒否を返すことで実測した）。そのため
 * `delete`の拒否を読んだ利用者が`delete --recover-record --apply`を実行すると**byte
 * 一致の拒否が返り**、誤ったcommandを使ったという信号がどこにも出ない。**これは本Issueが
 * 断とうとしている閉路と同型であり、縮小が作った回帰である。**
 *
 * 名指しがINV-02に適合する理由は、直前の`upgrade(target, { apply: false,
 * recoverRecord: true })`が**まさにその手段のpreviewである**ことによる。previewが
 * 例外を投げなかった経路にだけ到達するので、「同じ状態で製品の判定により拒否されない
 * ことをpreviewで確認した手段」という正準条件を満たす。previewが投げた経路では
 * 名指しせず原因だけを述べる。**`init`の競合拒否はpreviewを走らせないので、
 * この関数へ連結しない。**
 *
 * **豊かな案内（内訳の開示、preview→applyの手順、分岐の助言）は #1310 が所有する。**
 */
function recoveryDiagnostic(target: string): string {
  try {
    upgrade(target, { apply: false, recoverRecord: true });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return `この状態では --recover-record を付けても次の理由で拒否されます: ${cause}。先にこの原因を解消してください`;
  }
  return "復旧するには update に --recover-record が必要です。手順は配布される利用案内を参照してください";
}

export function init(target: string, options: { apply: boolean }) {
  return options.apply
    ? withManagedMutationLock(target, (markDirty) =>
        initUnlocked(target, options, markDirty),
      )
    : initUnlocked(target, options);
}

function initUnlocked(
  target: string,
  options: { apply: boolean },
  markDirty: () => void = () => {},
) {
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
      /**
       * **競合pathだけを述べる**（Issue #1305）。復旧手段の案内をここへ連結すると、
       * いま拒否した`install`を再び名指しする閉路になる。
       */
      `初期導入先が競合しています。ファイルは書き込んでいません: ${conflicts.join(", ")}`,
    );
  if (!options.apply)
    return { applied: false, assets: assets.map(({ dest }) => dest) };
  const recordPresent = hasManagedAssetRecord(target);
  assertSnapshotPublicationSupported(target, recordPresent);
  const expectedParent = recordPresent
    ? readCurrentManagedRecord(target).parent
    : null;
  const record: { version: string; files: Record<string, string> } = {
    version: PACKAGE_VERSION,
    files: {},
  };
  for (const { src, dest } of assets) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!pathEntryExists(dest)) {
      markDirty();
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    }
    record.files[relativeKey(target, dest)] = digest(dest);
  }
  markDirty();
  publishManagedAssetRecord(target, record, recordPresent, expectedParent);
  return { applied: true, assets: Object.keys(record.files) };
}

/**
 * 1資産について配置・上書き・採用・保持のどれになるかを決める純関数（Issue #1305）。
 *
 * **filesystemを読まない。** 存在・通常file性・digestは呼び出し側が値として渡す。
 * `upgrade`のpreview経路とapply経路が同じ判定を使うことで、片方だけを緩める
 * 変異を作れなくする。
 *
 * **`expected`が`undefined`であることは「recordに記録が無い」を意味する。**
 * managed asset recordそのものが存在しない状態は、全資産の`expected`が
 * `undefined`である状態と同一であり、この関数へ新しい分岐を要しない。
 * **記録が無く正本と相違する資産は`retain`である。** ここを`overwrite`へ
 * 倒すと、利用者が変更した資産が無音で失われる。
 */
export type ManagedAssetClassification =
  "place" | "overwrite" | "adopt" | "retain";

export function classifyManagedAsset(input: {
  readonly exists: boolean;
  readonly regularFile: boolean;
  readonly expected: string | undefined;
  readonly destDigest: string;
  readonly sourceDigest: string;
}): ManagedAssetClassification {
  if (!input.exists) return "place";
  if (!input.regularFile) return "retain";
  if (input.expected !== undefined)
    return input.destDigest === input.expected ? "overwrite" : "retain";
  return input.destDigest === input.sourceDigest ? "adopt" : "retain";
}

/**
 * managed asset recordを読む。**不在なら空recordを返す**（Issue #1305）。
 *
 * 以前はここで`未導入です。先にinstallを実行してください`をthrowしていたが、
 * その`install`は展開先が正本と異なる場合に`初期導入先が競合しています`で
 * 拒否するため、**拒否理由が閉路を作り製品内の復旧経路が存在しなかった。**
 * 空recordを返すと全資産が「記録が無い」として評価され、正本と一致する資産は
 * 採用、相違する資産は保持になる。**上書きの到達性は1経路も増えない。**
 */
function readManagedAssetRecordAt(
  target: string,
  recordPresent: boolean,
): ManagedAssetRecord {
  /**
   * **`fs.existsSync`ではなく`pathEntryExists`で判定する。** `existsSync`は
   * link先を解決するため、**dangling symlinkに対して`false`を返す。** それを
   * 「record不在」と読むと復旧の明示門を誤って通過する。公開はno-replaceでも、
   * dangling symlinkを失われたrecordへ降格させてはならない。
   *
   * **entryがあるなら必ず`readManagedAssetRecord`へ通す。** 同関数が
   * 非通常fileを拒否し、JSON不正・digest不正・path重複も拒否する。
   * **不在だけを空recordへ倒し、壊れたrecordを空recordへ洗浄しない。**
   */
  /**
   * **存在を再観測しない**（Issue #1305、codex High 1）。
   *
   * 以前はここで`pathEntryExists`を独立に呼んでいた。呼び出し側の観測と
   * この観測の間に別processが有効なrecordを配置すると、**新しく現れたrecordの
   * digestが`expected`として上書き権限を与え**、利用者fileが正本へ上書きされる。
   * そのうえ公開は古い観測に従ってno-replaceで行われ`EEXIST`で失敗するため、
   * **「commandは失敗したのに利用者fileだけ上書き済み」**という状態が残る。
   * 観測は1回だけ行い、その結果を引数で受ける。
   *
   * **守るべき性質は観測回数ではない**（codex Medium 2）。「観測は1回」と無限定に述べると
   * 偽になる。record存在時はこの関数が最初の存在判定のあとで同じentryを読み、拒否経路は
   * 最小診断のために`recoverRecord`つきのpreviewを走らせてそこでも観測する。**どちらも
   * 上書き権限を与えないので、この不変条件が防いでいる事故は起こらない。**
   *
   * 正確には**「不在と観測してから資産を分類するまでの間に現れたrecordのdigestを
   * `expected`として使わない」**ことが性質であり、回数はその代理でしかない。
   */
  if (!recordPresent) return { version: PACKAGE_VERSION, files: {} };
  return readManagedAssetRecord(target).record;
}

/**
 * 分類の入力をfilesystemから観測する（Issue #1305）。
 *
 * **通常fileでないときにdigestを読まない。** 読むとdirectoryで例外になる。
 * 分類関数は`exists`と`regularFile`で早期に返すため、この場合のdigestは
 * 判定に使われない。
 */
function observeManagedAsset(
  item: { src: string; dest: string },
  expected: string | undefined,
): {
  exists: boolean;
  regularFile: boolean;
  expected: string | undefined;
  destDigest: string;
  sourceDigest: string;
} {
  const exists = pathEntryExists(item.dest);
  const regularFile = exists && isRegularFile(item.dest);
  return {
    exists,
    regularFile,
    expected,
    destDigest: regularFile ? digest(item.dest) : "",
    sourceDigest: regularFile ? digest(item.src) : "",
  };
}

/**
 * record公開の直前に、公開先のentryを再検証する（Issue #1305、R2-H02）。
 *
 * 既存の診断を維持する。検査と公開の間の競合はこの検査では閉じないため、
 * 実際の公開にはno-replaceのhardlinkを使う。非通常fileなら公開前に原因を名指しする。
 */
function assertRecordPublishTarget(recordPath: string): void {
  if (!pathEntryExists(recordPath)) return;
  if (!isRegularFile(recordPath))
    throw new Error(
      "managed asset recordの公開先が通常fileではありません。書き込みを中止しました。" +
        "当該pathのsymlinkまたはdirectoryを解消してください",
    );
}

/**
 * 初回recordは一時fileを完全にfsync・再読取した後no-replaceで公開する。
 * 既存recordは置換せず、旧recordのdigestに結び付けた不変snapshotを追記する。
 * 同じ親の並行公開は同じleafで競合し、先着以外を拒否する（Issue #1306）。
 */
function publishManagedAssetRecord(
  target: string,
  record: ManagedAssetRecord,
  recordPresent: boolean,
  expectedParent: string | null,
): void {
  const recordPath = path.join(target, MANAGED_RECORD);
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  if (!recordPresent) {
    try {
      writeFileNoReplace(recordPath, contents);
    } catch (error) {
      if (isRecord(error) && error.code === "EEXIST")
        throw new Error(
          "managed asset recordの公開先に別のentryが現れました。書き込みを中止しました。" +
            "当該pathを確認してから再実行してください",
          { cause: error },
        );
      throw error;
    }
    return;
  }
  assertRecordPublishTarget(recordPath);
  const current = readCurrentManagedRecord(target);
  if (current.parent !== expectedParent)
    throw new Error(
      "managed asset recordが並行更新されました。既存snapshotを保持して中止します",
    );
  const parent = current.parent;
  const payload = { schemaVersion: 1 as const, parent, record };
  const payloadDigest = sha256Bytes(JSON.stringify(payload));
  const snapshot: ManagedRecordSnapshot = { ...payload, payloadDigest };
  const destination = path.join(snapshotDirectory(target), `${parent}.json`);
  try {
    writeFileNoReplace(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST")
      throw new Error(
        "managed asset snapshotの公開先に別のentryが現れました。当該pathを確認してから再実行してください",
        { cause: error },
      );
    throw error;
  }
}

export function upgrade(
  target: string,
  options: { apply: boolean; recoverRecord?: boolean },
) {
  return options.apply
    ? withManagedMutationLock(target, (markDirty) =>
        upgradeUnlocked(target, options, markDirty),
      )
    : upgradeUnlocked(target, options);
}

function upgradeUnlocked(
  target: string,
  options: { apply: boolean; recoverRecord?: boolean },
  markDirty: () => void = () => {},
) {
  const recordPresent = hasManagedAssetRecord(target);
  /**
   * **record不在からの復旧は明示の意図を要求する**（Issue #1305、#1307）。
   *
   * recordを失った状態で「かつて導入した」ことを**filesystemだけでは判定できない。**
   * mapped pathにentryがあることは、そのentryをpackageが置いたことを意味しない。
   * 利用者が同名で作ったfile、別toolが置いたfile、正本と偶然byte一致するfile、
   * directoryのいずれとも区別できない。digestの一致も「同じ内容である」ことしか
   * 示さない。**導入した事実の耐久的な証拠はrecord自身であり、それを失った状態での
   * 再構成は循環する。**
   *
   * 推測を3度試みて独立reviewerが3度とも反例を構成した（`README.md`のみの
   * directoryで114 file、利用者所有の`AGENTS.md`で113 file、名前空間内の他tool
   * 所有fileで113 file）。**したがって推測をやめ、利用者に意図を宣言させる。**
   * 受理範囲は推測より狭い。
   */
  if (!recordPresent && options.recoverRecord !== true)
    throw new Error(
      `managed asset recordがありません。${recoveryDiagnostic(target)}`,
    );
  // Classify assets and bind the eventual append to one observed generation.
  // A second read could classify against the old digest but publish as a newer parent.
  const observed = recordPresent ? readCurrentManagedRecord(target) : null;
  const old = observed?.record ?? readManagedAssetRecordAt(target, false);
  const expectedParent = observed?.parent ?? null;
  const current = mappings(target);
  /**
   * **record不在は「導入済み」の代わりにならない**（Issue #1305）。
   *
   * recordの不在を全資産未記録として扱うと、**一度も導入していない
   * directoryも同じ状態に含まれる。** その場合`update --apply`は展開先を
   * すべて`place`と分類し、`install`と同じ書き込みを行う。`--root`や作業
   * directoryを誤った1回の実行が無言でfull installになる。是正前の`upgrade`は
   * record不在で拒否していたため、**これは本変更が到達可能にした書き込みである。**
   *
   * **推測は撤去した**（Issue #1307、owner決裁の案A）。展開先の有無を導入の証拠に
   * しない。条件は利用者の明示指定だけである。
   */
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
    const classification = classifyManagedAsset(
      observeManagedAsset(item, expected),
    );
    if (classification === "retain") {
      retained.push(key);
      continue;
    }
    planned.push({ ...item, key, expected });
    if (classification === "adopt") adoptable.push(key);
  }
  if (!options.apply)
    return {
      applied: false,
      planned: planned.map((item) => item.key),
      adopted: adoptable,
      retained,
    };
  assertSnapshotPublicationSupported(target, recordPresent);
  const next: { version: string; files: Record<string, string> } = {
    version: PACKAGE_VERSION,
    files: { ...old.files },
  };
  const adopted: string[] = [];
  for (const item of planned) {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    /**
     * **preview後の状態変化をここで取り直す。** TOCTOUの再検証であり、
     * previewの判定を再利用しない。
     */
    const classification = classifyManagedAsset(
      observeManagedAsset(item, item.expected),
    );
    if (classification === "retain") {
      retained.push(item.key);
      continue;
    }
    if (classification === "place") {
      markDirty();
      fs.copyFileSync(item.src, item.dest, fs.constants.COPYFILE_EXCL);
    } else if (classification === "overwrite") {
      markDirty();
      fs.copyFileSync(item.src, item.dest);
    } else adopted.push(item.key);
    next.files[item.key] = digest(item.dest);
  }
  markDirty();
  publishManagedAssetRecord(target, next, recordPresent, expectedParent);
  return { applied: true, adopted, retained };
}

export function uninstall(
  target: string,
  options: { apply: boolean },
): UninstallResult {
  return options.apply
    ? withManagedMutationLock(
        target,
        (markDirty) => uninstallUnlocked(target, options, markDirty),
        (result) => result.applied,
      )
    : uninstallUnlocked(target, options);
}

function uninstallUnlocked(
  target: string,
  options: { apply: boolean },
  markDirty: () => void = () => {},
): UninstallResult {
  const recordPath = path.join(target, MANAGED_RECORD);
  if (!hasManagedAssetRecord(target))
    throw new Error(
      `managed asset recordがありません。撤去対象を確定できません。${recoveryDiagnostic(target)}`,
    );
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
  let partialMutation = false;
  const noteRemoval = (): void => {
    partialMutation = true;
    markDirty();
  };
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
      noteRemoval();
      removed.push(asset.relative);
    } catch {
      pending.push(asset.relative);
    }
  }
  if (pending.length === 0) {
    const snapshotPaths = readCurrentManagedRecord(target).snapshotPaths;
    for (const file of snapshotPaths.reverse()) {
      try {
        fs.rmSync(file);
        noteRemoval();
      } catch {
        pending.push(relativeKey(target, file));
        break;
      }
    }
    if (pending.length === 0) {
      try {
        fs.rmSync(recordPath);
        noteRemoval();
      } catch {
        pending.push(MANAGED_RECORD);
      }
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
      : partialMutation
        ? `${MANAGED_MUTATION_LOCK}を保持しました。recordと資産を照合し、中断した操作がないことを確認してから復旧してください`
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
  const installed = hasManagedAssetRecord(target);
  const diagnostics: string[] = [];
  if (pathEntryExists(path.join(target, MANAGED_MUTATION_LOCK)))
    diagnostics.push(
      `${MANAGED_MUTATION_LOCK}: 進行中または中断した操作があります。recordと資産を照合してから復旧してください`,
    );
  let files: Record<string, string> = {};
  let managedAssets: ManagedAsset[] = [];
  /**
   * **recordを読めたかを`installed`と別に持つ**（Issue #1314、外部reviewの指摘）。
   *
   * recordの検証に失敗すると`files`は空のままである。`installed`だけを条件に
   * 未管理資産を数えると、**展開済みの全fileを「recordに無い」と報告する。**
   */
  let recordRead = false;
  let recordFailure: string | undefined;
  if (!installed)
    diagnostics.push(`${MANAGED_RECORD}: managed recordがありません`);
  else {
    try {
      const managed = readManagedAssetRecord(target);
      files = managed.record.files;
      managedAssets = managed.assets;
      recordRead = true;
    } catch (error) {
      recordFailure = error instanceof Error ? error.message : "検証できません";
      diagnostics.push(`${MANAGED_RECORD}: ${recordFailure}`);
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
  /**
   * **契約を満たしたまま止まっているstagingを名指しする**（Issue #954）。
   *
   * `healthy`の判定は変えない。**門を増やさず、報告だけを分ける。** 未完の
   * stagingには「契約を満たさない古い記録」と「単に途中で止まっている」が
   * 混ざっており、後者だけが手を入れる対象である。
   */
  const interruptedStagings = workflowStagings
    .filter(
      (staging): staging is Extract<typeof staging, { interrupted: boolean }> =>
        "interrupted" in staging && staging.interrupted,
    )
    .map((staging) => ({
      staging: staging.staging,
      mode: staging.mode,
      currentStep: staging.currentStep,
      nextStep: staging.nextStep,
    }));
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
  /**
   * **登録状態は報告するが`healthy`を変えない**（Issue #1105）。
   *
   * hook本体の欠落・改変はmanaged assetの診断として`healthy`へ入る。
   * **登録は利用者による有効化状態であり、packageのinstall健全性ではない。**
   * `healthy` keyをこの欄へ置かない。置くと門と誤読される。
   */
  /**
   * **境界外への解決失敗で`doctor`全体を止めない**（Issue #1105、外部reviewの指摘）。
   *
   * `.claude`がroot外を指すsymlinkだと`resolveContained`は例外を投げる。
   * **登録状態の観測は任意であり、失敗しても他の診断を返す価値がある。**
   * `resolveContained`自体は残すため、境界外のfileは読まない。
   */
  let hookSettingsFile: string | undefined;
  try {
    hookSettingsFile = resolveContained(target, HOST_HOOK_SETTINGS, {
      allowMissingLeaf: true,
    });
  } catch {
    hookSettingsFile = undefined;
  }
  /**
   * **設定fileが無い場合を例外にしない。** `isRegularFile`は`lstatSync`を使い
   * ENOENTを投げる。**未登録は正常な状態であり、診断の対象であって失敗ではない。**
   */
  const hookRegistration = inspectHookRegistration({
    settings:
      hookSettingsFile !== undefined &&
      fs.existsSync(hookSettingsFile) &&
      isRegularFile(hookSettingsFile)
        ? fs.readFileSync(hookSettingsFile, "utf8")
        : undefined,
    expectedCommandFragment: HOST_HOOK_TARGETS[0],
  });
  /**
   * **展開先に在るがrecordに無い管理対象を報告する。`healthy`は変えない**（Issue #1314）。
   *
   * `--recover-record`での復旧は、正本と相違する資産を`retained`として保持し
   * **recordへ登録しない**（INV-01。置いていないfileを管理していると主張しない）。
   * 正しい設計だが、**帰結として当該資産は以後`update`の対象から外れ、古い版で
   * 固定される。** 実利用者repositoryで復旧を実測したところ、version skewにより
   * 107件中22件がこの状態になり、それでも`doctor`は`healthy`を返していた。
   *
   * 復旧commandの出力には`retained`が出るのでその場では見えるが、**後から見る
   * 手段が無かった。** ここで報告する。**門は足さない。** `REQ-LC-011`の
   * 「報告するが`healthy`を変えない」前例に従う。
   */
  const unmanagedAssets = ((): {
    observed: boolean;
    paths: string[];
    unobservedReason?: string;
  } => {
    if (!installed)
      return {
        observed: false,
        paths: [],
        unobservedReason: `${MANAGED_RECORD}が無いため、未管理資産を判定できません`,
      };
    if (!recordRead)
      return {
        observed: false,
        paths: [],
        unobservedReason: `${MANAGED_RECORD}を検証できないため、未管理資産を判定できません`,
      };
    /**
     * **この報告の失敗で`doctor`全体を落とさない。ただし「なし」とも断定しない**
     * （Issue #1314、外部reviewの指摘）。
     *
     * `mappings`は展開先の解決で例外を投げうる（境界外symlink等）。それは
     * 他の診断が既に扱う事象であり、**報告欄の計算がそれを理由に`doctor`を
     * 停止させると、他の診断まで返せなくなる。** かといって空配列を返すと
     * 「0件だった」と読めてしまうので、**観測できなかったことを明示する。**
     */
    try {
      return {
        observed: true,
        paths: mappings(target)
          .map(({ dest }) => relativeKey(target, dest))
          .filter(
            (key) =>
              !Object.hasOwn(files, key) &&
              pathEntryExists(path.join(target, key)),
          )
          .sort(),
      };
    } catch (error) {
      return {
        observed: false,
        paths: [],
        unobservedReason: `展開先を解決できないため、未管理資産を判定できません: ${error instanceof Error ? error.message : "不明な失敗"}`,
      };
    }
  })();
  const snapshotFolder = path.join(target, MANAGED_RECORDS);
  const brokenSnapshotChain =
    installed &&
    !recordRead &&
    pathEntryExists(snapshotFolder) &&
    (!fs.lstatSync(snapshotFolder).isDirectory() ||
      snapshotEntries(target).length > 0);
  const unobservedAction = brokenSnapshotChain
    ? `${recordFailure}。${recordFailure?.includes("未接続のentry") ? "未接続entryの由来を確認し、正本外のentryを隔離してから再検証してください" : "anchorとsnapshotの正しい組をバックアップから復元してください"}`
    : installed && !recordRead
      ? recoveryDiagnostic(target)
      : "managed recordの状態を確認してください";
  return {
    healthy: installed && diagnostics.length === 0,
    installed,
    unmanagedAssets: {
      observed: unmanagedAssets.observed,
      paths: unmanagedAssets.paths,
      note: !unmanagedAssets.observed
        ? `判定不能: ${unmanagedAssets.unobservedReason}。${unobservedAction}`
        : unmanagedAssets.paths.length === 0
          ? "なし"
          : `展開先に存在するがmanaged recordに無い管理対象が${unmanagedAssets.paths.length}件ある。これらは update の対象にならず現在の版で固定される。正本へ戻すか、update --recover-record --apply で再評価する`,
    },
    hooks: {
      canonical: HOST_HOOK_SOURCE,
      expected: [...HOST_HOOK_TARGETS],
      registered: hookRegistration.registered,
      diagnostics: hookRegistration.registered ? [] : [hookRegistration.reason],
    },
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
      /** 契約を満たしたまま未完で止まっているstaging（Issue #954）。 */
      interrupted: interruptedStagings,
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
