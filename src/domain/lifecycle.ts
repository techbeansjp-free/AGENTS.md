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
const NAMESPACE_ASSETS = [
  "docs",
  "skills",
  "templates",
  "schemas",
  "policy",
  "hooks",
];
const MANAGED_RECORD = ".agent-skill-chain/managed-assets.json";
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
  return resolveContained(target, portable, { allowMissingLeaf: true });
}

function readManagedAssetRecord(target: string): {
  recordPath: string;
  record: ManagedAssetRecord;
  assets: ManagedAsset[];
} {
  /**
   * **entryの種別を`resolveContained`より前に見る**（Issue #1305、F-04）。
   *
   * `resolveContained`はlink先を解決するため、dangling symlinkのrecordでは
   * 「パスが存在しません」で止まり、**recordがsymlinkであることも対象pathも
   * 出ない。** 要件は「解消すべき原因と対象を名指しする」を求めている。
   */
  const recordEntry = path.join(target, MANAGED_RECORD);
  if (pathEntryExists(recordEntry) && !isRegularFile(recordEntry))
    throw new Error(
      `managed asset recordは通常fileでなければなりません: ${MANAGED_RECORD}`,
    );
  const recordPath = resolveContained(target, MANAGED_RECORD);
  if (!isRegularFile(recordPath))
    throw new Error(
      `managed asset recordは通常fileでなければなりません: ${MANAGED_RECORD}`,
    );
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
 * - 同じ状態で`--recover-record`が製品判定により拒否されるなら、その原因
 * - そうでないなら、明示指定が必要であるという事実
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
  return "復旧するには --recover-record が必要です。手順は配布される利用案内を参照してください";
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
      /**
       * **競合pathだけを述べる**（Issue #1305）。復旧手段の案内をここへ連結すると、
       * いま拒否した`install`を再び名指しする閉路になる。
       */
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
  assertRecordPublishTarget(path.join(target, MANAGED_RECORD));
  writeFileAtomic(
    path.join(target, MANAGED_RECORD),
    `${JSON.stringify(record, null, 2)}\n`,
  );
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
   * 「record不在」と読むと、後続の`writeFileAtomic`がrename でsymlinkの
   * directory entryを通常fileへ置換し、**REQ-LC-001が保持を求めるsymlinkを
   * 破壊する。** 是正前の`upgrade`はrecord不在でthrowして何も書かなかったため、
   * この破壊は本変更が到達可能にしたものである。
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
   * そのうえ公開は古い観測に従って`wx`で行われ`EEXIST`で失敗するため、
   * **「commandは失敗したのに利用者fileだけ上書き済み」**という状態が残る。
   * 観測は1回だけ行い、その結果を引数で受ける。
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
 * **観測から公開までの間にentryが差し替わりうる。** `writeFileAtomic`は
 * `rename`で公開するため、その時点でrecord pathがsymlinkやdirectoryであれば
 * **entryを置換する。** REQ-LC-001は「hash・containment・TOCTOUを各write前に
 * 検証する」を要求しており、この再検証はその履行である。
 *
 * **残存する競合は閉じていない。** 検査と`rename`の間には依然として窓がある。
 * 窓を完全に閉じるにはno-replaceな公開方式が要り、それは`init`にも同じ形で
 * 存在する既存の性質であるため、別Issueで扱う。
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
 * recordを公開する（Issue #1305、R2-H02）。
 *
 * **record不在からの復旧はno-replaceで公開する。** `writeFileAtomic`は`rename`で
 * 公開するため、検査から`rename`までの間に現れたentryを置換する。是正前の`upgrade`は
 * record不在で公開処理へ到達しなかったため、**この窓は本変更が到達可能にしたもので
 * ある。** `wx`（`O_CREAT | O_EXCL`）で作成すると、entryが存在する場合は`EEXIST`で
 * 失敗し、**symlinkのentryを置換しない。**
 *
 * recordが既に存在する場合の再固定は置換が意図された動作であるため、従来どおり
 * `writeFileAtomic`を使う。**その一般化はIssue #1306が所有する。**
 */
function publishManagedAssetRecord(
  recordPath: string,
  record: ManagedAssetRecord,
  recordPresent: boolean,
): void {
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  if (!recordPresent) {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    try {
      fs.writeFileSync(recordPath, contents, { flag: "wx" });
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
  writeFileAtomic(recordPath, contents);
}

export function upgrade(
  target: string,
  options: { apply: boolean; recoverRecord?: boolean },
) {
  const recordPath = path.join(target, MANAGED_RECORD);
  const recordPresent = pathEntryExists(recordPath);
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
  const old = readManagedAssetRecordAt(target, recordPresent);
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
    if (classification === "place")
      fs.copyFileSync(item.src, item.dest, fs.constants.COPYFILE_EXCL);
    else if (classification === "overwrite")
      fs.copyFileSync(item.src, item.dest);
    else adopted.push(item.key);
    next.files[item.key] = digest(item.dest);
  }
  publishManagedAssetRecord(recordPath, next, recordPresent);
  return { applied: true, adopted, retained };
}

export function uninstall(
  target: string,
  options: { apply: boolean },
): UninstallResult {
  const recordPath = path.join(target, MANAGED_RECORD);
  if (!pathEntryExists(recordPath))
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
  return {
    healthy: installed && diagnostics.length === 0,
    installed,
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
