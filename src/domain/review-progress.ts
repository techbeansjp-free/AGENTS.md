import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";

export const PROGRESS_START = "<!-- asc:parallel-progress:start -->";
export const PROGRESS_END = "<!-- asc:parallel-progress:end -->";
const SHA256 = /^[a-f0-9]{64}$/u;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const TASK_ID = /^[A-Z][A-Z0-9._-]{1,63}$/u;
const STATES = ["planned", "started", "completed", "blocked"] as const;

export type ReviewProgressState = (typeof STATES)[number];

export interface ReviewProgressTargetInventory {
  targetPath: string;
  baselineDigest: string;
  prefixDigest: string;
  suffixDigest: string;
  fileMode: 420;
  allowedTaskIds: readonly string[];
}

export interface ReviewProgressInventory extends ReviewProgressTargetInventory {
  schemaVersion?: "agent-skill-chain/review-progress-inventory/v2";
  targets?: readonly ReviewProgressTargetInventory[];
}

export interface ReviewProgressEntry {
  schemaVersion: "agent-skill-chain/review-progress-entry/v1";
  sequence: number;
  entryId: string;
  sessionId: string;
  implementationHeadSha: string;
  taskId: string;
  state: ReviewProgressState;
  recordedAt: string;
  previousDigest: string | null;
  entryDigest: string;
}

export interface ReviewProgressSeal {
  schemaVersion: "agent-skill-chain/review-progress-seal/v1";
  sessionId: string;
  implementationHeadSha: string;
  previousDigest: string | null;
  sealedAt: string;
  sealDigest: string;
}

export type ReviewProgressRecord = ReviewProgressEntry | ReviewProgressSeal;

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * markerの1組を切り出す。**例外でなく判別可能な値を返す。**
 *
 * 呼び出し側でcatchすると、将来この関数へ足した別の失敗まで無言で
 * `marker-not-single-pair`へ束ねられ、分類の閉じた列挙という安全性の根拠が崩れる。
 */
function trySplitTarget(source: string):
  | {
      readonly ok: true;
      readonly prefix: string;
      readonly body: string;
      readonly suffix: string;
    }
  | { readonly ok: false } {
  const start = source.indexOf(PROGRESS_START);
  const end = source.indexOf(PROGRESS_END);
  if (
    start < 0 ||
    end < 0 ||
    source.indexOf(PROGRESS_START, start + 1) >= 0 ||
    source.indexOf(PROGRESS_END, end + 1) >= 0 ||
    end <= start
  )
    return { ok: false };
  const bodyStart = start + PROGRESS_START.length;
  return {
    ok: true,
    prefix: source.slice(0, bodyStart),
    body: source.slice(bodyStart, end),
    suffix: source.slice(end),
  };
}

function splitTarget(source: string): {
  prefix: string;
  body: string;
  suffix: string;
} {
  const split = trySplitTarget(source);
  if (!split.ok) throw new Error("parallel progress markerは正確に1組必要です");
  return { prefix: split.prefix, body: split.body, suffix: split.suffix };
}

/**
 * inventoryを構築できない分類。**閉じた列挙にする。**
 *
 * TERM-ASC-125「progress inventory不成立」の定義と1対1に対応する。ここへ
 * 「読めなかった」のような分類外の失敗を足さない。分類へ入れた失敗だけが
 * review本線を止めずに済む扱いになるため、列挙を広げることは
 * **そのままfail-openの範囲を広げること**を意味する。
 */
export const REVIEW_PROGRESS_UNBUILDABLE_REASONS = [
  "mode-mismatch",
  "not-regular-file",
  "marker-not-single-pair",
  "no-task-id",
] as const;

export type ReviewProgressUnbuildableReason =
  (typeof REVIEW_PROGRESS_UNBUILDABLE_REASONS)[number];

/** 構築判定へ渡す対象fileの観測値。filesystemはadapterだけが触る。 */
export interface ReviewProgressTargetObservation {
  fileMode: number;
  isSymbolicLink: boolean;
  isRegularFile: boolean;
}

export type ReviewProgressInventoryOutcome =
  | { readonly state: "built"; readonly inventory: ReviewProgressInventory }
  | {
      readonly state: "unbuildable";
      /**
       * **不成立になった対象を値で持つ。** targetは1件とは限らないため、
       * 呼び出し側が「どのtargetの話か」を別経路で補うと取り違える。
       */
      readonly targetPath: string;
      readonly reason: ReviewProgressUnbuildableReason;
      readonly observedMode: number;
      readonly isSymbolicLink: boolean;
      readonly isRegularFile: boolean;
    };

/**
 * 構築の成否を**例外ではなく判別可能な値**で返す。
 *
 * **例外をcatchして非停止化しない。** catchで実装すると、分類外のI/O失敗や
 * path identity異常まで同じ枝で握り潰され、REQ-WF-021が要求する
 * 「progressの失敗を拒否理由にしない」を満たすかわりにfail-openを作る。
 * 分類済みの失敗だけを値で返し、それ以外は従来どおり例外として伝播させる。
 */
export function tryBuildReviewProgressInventory(
  targetPath: string,
  source: string,
  target: ReviewProgressTargetObservation,
): ReviewProgressInventoryOutcome {
  /**
   * **宣言の誤りは例外、file状態の問題は分類。** targetPathは呼び出し側が
   * 宣言する値であり、安全でないpathはfile状態の不成立ではなく契約違反である。
   * ここで分類へ落とすと、不正なpath宣言が「案内つきでroundが開く」形になり
   * 利用者が是正すべき対象を取り違える。
   */
  assertProgressTargetPath(targetPath);
  const unbuildable = (
    reason: ReviewProgressUnbuildableReason,
  ): ReviewProgressInventoryOutcome =>
    Object.freeze({
      state: "unbuildable" as const,
      targetPath,
      reason,
      observedMode: target.fileMode,
      isSymbolicLink: target.isSymbolicLink,
      isRegularFile: target.isRegularFile,
    });
  /**
   * **symlink判定をmode比較より前に置く。** symlinkの`lstat`のmodeはLinuxで
   * `0o777`であり、後ろに置くと必ず`mode-mismatch`として分類され、案内が
   * `chmod`を勧めてlink先を書き換えさせる。
   */
  if (target.isSymbolicLink || !target.isRegularFile)
    return unbuildable("not-regular-file");
  if (target.fileMode !== 0o644) return unbuildable("mode-mismatch");
  const split = trySplitTarget(source);
  if (!split.ok) return unbuildable("marker-not-single-pair");
  const { prefix, suffix } = split;
  const allowedTaskIds = [
    ...new Set(
      [...source.matchAll(/^\|\s*([A-Z][A-Z0-9._-]{1,63})\s*\|/gmu)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();
  if (allowedTaskIds.length === 0) return unbuildable("no-task-id");
  return Object.freeze({
    state: "built" as const,
    inventory: Object.freeze({
      targetPath,
      baselineDigest: sha256(source),
      prefixDigest: sha256(prefix),
      suffixDigest: sha256(suffix),
      fileMode: 0o644 as const,
      allowedTaskIds: Object.freeze(allowedTaskIds),
    }),
  });
}

/**
 * 分類ごとに必要なauthorityは違う。**modeの変更権限で全分類を代表させない。**
 * markerやtask IDの是正は内容の編集権限、通常fileへの置換はdirectory entryの
 * 変更権限を要するため、案内が行動可能にならない。
 */
const REQUIRED_AUTHORITY: Readonly<
  Record<ReviewProgressUnbuildableReason, string>
> = Object.freeze({
  "mode-mismatch": "対象fileのmode変更権限",
  "not-regular-file":
    "staging directoryのentry変更権限（対象を通常fileへ置き換える）",
  "marker-not-single-pair": "対象fileの内容編集権限",
  "no-task-id": "対象fileの内容編集権限",
});

const UNBUILDABLE_MESSAGES: Readonly<
  Record<ReviewProgressUnbuildableReason, string>
> = Object.freeze({
  "mode-mismatch": "parallel progress targetはmode 100644が必要です",
  "not-regular-file": "parallel progress targetはmode 100644が必要です",
  "marker-not-single-pair": "parallel progress markerは正確に1組必要です",
  "no-task-id": "parallel progress targetにtask IDが必要です",
});

/**
 * 構築できない入力をthrowへ写す薄い層。
 *
 * inventory成立後の再検証経路（`review progress`と`review round`のinventory照合）は
 * 引き続きこちらを使う。**そこでの不一致は拒否でなければならない**ため、
 * 非停止化の対象にしない。
 */
export function buildReviewProgressInventory(
  targetPath: string,
  source: string,
  fileMode: number,
): ReviewProgressInventory {
  const outcome = tryBuildReviewProgressInventory(targetPath, source, {
    fileMode,
    isSymbolicLink: false,
    isRegularFile: true,
  });
  if (outcome.state === "unbuildable")
    throw new Error(UNBUILDABLE_MESSAGES[outcome.reason]);
  return outcome.inventory;
}

export interface ReviewProgressUnbuildableGuidance {
  readonly code: "ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE";
  readonly reason: ReviewProgressUnbuildableReason;
  readonly target: string;
  readonly observed: string;
  readonly expected: "100644";
  readonly effect: string;
  readonly action: string;
  readonly repairArgv: readonly string[] | null;
  readonly requiredAuthority: string;
  readonly rollback: string;
}

/**
 * 不成立の分類と実測値から、利用者が採る行動を生成する。
 *
 * **判定を持たない純関数である。** pathもfilesystemも知らず、受け取るのは
 * staging相対のfile名だけとする。案内へ絶対path、環境変数、tokenを混ぜない
 * 方針はREQ-WF-024が確立したものを踏襲する。
 */
export function describeReviewProgressUnbuildable(input: {
  reason: ReviewProgressUnbuildableReason;
  observedMode: number;
  isSymbolicLink: boolean;
  isRegularFile: boolean;
  targetPath: string;
}): ReviewProgressUnbuildableGuidance {
  /**
   * **permission tripleは3桁で綴る。** `100`を前置するGit風のmode表記と
   * 桁数を合わせないと`1000664`のような存在しない値を案内へ出す。
   */
  const octal = (input.observedMode & 0o777).toString(8).padStart(3, "0");
  /**
   * **通常file以外へGit風の`100`接頭辞を付けない。** `100`は通常fileを意味する
   * ため、directoryやFIFOに対して`100755`のような**存在しない観測値**を案内へ
   * 出すことになる。REQ-WF-021が求めるのは実測modeの表示であって、体裁を
   * そろえた文字列ではない。
   */
  const observed = input.isSymbolicLink
    ? `symlink（lstat permission 0${octal}）`
    : input.isRegularFile
      ? `100${octal}`
      : `通常fileでない（lstat permission 0${octal}）`;
  const base = {
    code: "ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE" as const,
    reason: input.reason,
    target: input.targetPath,
    observed,
    expected: "100644" as const,
    effect:
      "このroundではparallel progressを利用できません。reviewは通常どおり継続し、round番号と予算は変わりません",
    requiredAuthority: REQUIRED_AUTHORITY[input.reason],
    rollback: "review sessionを変更していません。対象fileを元の状態へ戻せます",
  };
  if (input.reason === "not-regular-file")
    return Object.freeze({
      ...base,
      /**
       * **種別ごとに案内を分ける。** `not-regular-file`はsymlinkだけでなく
       * directoryやFIFOも含む。symlink固有の理由（chmodがlink先を書き換える）を
       * directoryへ出すと、利用者は存在しない危険を避けようとして誤った手を打つ。
       */
      action: input.isSymbolicLink
        ? `${input.targetPath}がsymlinkです。chmodではlink先を書き換えてしまうため、staging内の通常fileへ置き換えてください`
        : `${input.targetPath}が通常fileではありません。chmodでは種別を変えられないため、staging内の通常fileへ置き換えてください`,
      repairArgv: null,
    });
  if (input.reason === "marker-not-single-pair")
    return Object.freeze({
      ...base,
      action: `${input.targetPath}のparallel progress markerを正確に1組にしてください`,
      repairArgv: null,
    });
  if (input.reason === "no-task-id")
    return Object.freeze({
      ...base,
      action: `${input.targetPath}の進捗表へ宣言済みtask IDの行を1件以上置いてください`,
      repairArgv: null,
    });
  return Object.freeze({
    ...base,
    action: `staging directoryで次を実行してください。再実行しても変わらない場合、そのfilesystemはmodeを保持しません`,
    repairArgv: Object.freeze(["chmod", "0644", input.targetPath]),
  });
}

function assertProgressTargetPath(targetPath: string): void {
  if (
    targetPath.length === 0 ||
    targetPath.length > 512 ||
    pathLikeSegments(targetPath).some(
      (segment) => segment === "." || segment === ".." || segment === "",
    ) ||
    targetPath.startsWith("/") ||
    targetPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(targetPath) ||
    targetPath.normalize("NFC") !== targetPath
  )
    throw new Error(
      "parallel progress targetは安全なrepository相対pathが必要です",
    );
}

function pathLikeSegments(targetPath: string): readonly string[] {
  return targetPath.split("/");
}

export function buildReviewProgressInventories(
  targets: readonly {
    targetPath: string;
    source: string;
    fileMode: number;
  }[],
): ReviewProgressInventory {
  if (targets.length === 0 || targets.length > 16)
    throw new Error("parallel progress targetは1件以上16件以下が必要です");
  const built = targets.map((target) =>
    buildReviewProgressInventory(
      target.targetPath,
      target.source,
      target.fileMode,
    ),
  );
  const paths = built.map(({ targetPath }) => targetPath);
  if (
    new Set(paths).size !== paths.length ||
    stableJson(paths) !== stableJson([...paths].sort())
  )
    throw new Error("parallel progress targetは重複なし辞書順が必要です");
  const [primary] = built;
  if (built.length === 1) return primary!;
  return Object.freeze({
    ...primary!,
    schemaVersion: "agent-skill-chain/review-progress-inventory/v2",
    targets: Object.freeze(built),
  });
}

/**
 * 複数targetのinventoryを**例外ではなく判別可能な値**で構築する。
 *
 * **all-or-nothingにする。** inventoryはprefix/suffix digestとtask IDの集合を
 * 一体で固定する契約であり、成立したtargetだけを取り込むと「宣言したのに
 * 検証されないtarget」が残る。宣言済みtargetのいずれかが不成立なら
 * inventory全体を付けず、その対象の案内を返してroundは開く（REQ-WF-021）。
 *
 * **件数・重複・順序の違反は例外のまま。** これらは呼び出し側の宣言の誤りで
 * あり、file状態の不成立ではない。`assertProgressTargetPath`と同じ扱いにする。
 */
export function tryBuildReviewProgressInventories(
  targets: readonly {
    targetPath: string;
    source: string;
    target: ReviewProgressTargetObservation;
  }[],
): ReviewProgressInventoryOutcome {
  if (targets.length === 0 || targets.length > 16)
    throw new Error("parallel progress targetは1件以上16件以下が必要です");
  const paths = targets.map(({ targetPath }) => targetPath);
  if (
    new Set(paths).size !== paths.length ||
    stableJson(paths) !== stableJson([...paths].sort())
  )
    throw new Error("parallel progress targetは重複なし辞書順が必要です");
  const built: ReviewProgressTargetInventory[] = [];
  for (const item of targets) {
    const outcome = tryBuildReviewProgressInventory(
      item.targetPath,
      item.source,
      item.target,
    );
    if (outcome.state !== "built") return outcome;
    built.push(outcome.inventory);
  }
  const [primary] = built;
  return Object.freeze({
    state: "built" as const,
    inventory:
      built.length === 1
        ? primary!
        : Object.freeze({
            ...primary!,
            schemaVersion:
              "agent-skill-chain/review-progress-inventory/v2" as const,
            targets: Object.freeze(built),
          }),
  });
}

export function reviewProgressTargets(
  inventory: ReviewProgressInventory,
): readonly ReviewProgressTargetInventory[] {
  return inventory.targets ?? [inventory];
}

export function parseReviewProgressInventory(
  value: unknown,
): ReviewProgressInventory {
  if (!isRecord(value)) throw new Error("progress inventoryはobjectが必要です");
  const fields = [
    "targetPath",
    "baselineDigest",
    "prefixDigest",
    "suffixDigest",
    "fileMode",
    "allowedTaskIds",
    "schemaVersion",
    "targets",
  ];
  const required = fields.filter(
    (field) => field !== "schemaVersion" && field !== "targets",
  );
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  const missing = required.filter((field) => !(field in value));
  if (unknown.length || missing.length)
    throw new Error("progress inventoryのfieldが不正です");
  if (
    typeof value.targetPath !== "string" ||
    !SHA256.test(String(value.baselineDigest ?? "")) ||
    !SHA256.test(String(value.prefixDigest ?? "")) ||
    !SHA256.test(String(value.suffixDigest ?? "")) ||
    value.fileMode !== 0o644 ||
    !Array.isArray(value.allowedTaskIds) ||
    value.allowedTaskIds.length === 0 ||
    value.allowedTaskIds.some(
      (task) => typeof task !== "string" || !TASK_ID.test(task),
    ) ||
    stableJson(value.allowedTaskIds) !==
      stableJson([...new Set(value.allowedTaskIds as string[])].sort())
  )
    throw new Error("progress inventoryの値が不正です");
  assertProgressTargetPath(value.targetPath);
  const primary = Object.freeze({
    targetPath: value.targetPath,
    baselineDigest: String(value.baselineDigest),
    prefixDigest: String(value.prefixDigest),
    suffixDigest: String(value.suffixDigest),
    fileMode: 0o644,
    allowedTaskIds: Object.freeze([...(value.allowedTaskIds as string[])]),
  });
  if (value.targets === undefined && value.schemaVersion === undefined)
    return primary;
  if (
    value.schemaVersion !== "agent-skill-chain/review-progress-inventory/v2" ||
    !Array.isArray(value.targets)
  )
    throw new Error("progress inventory v2の値が不正です");
  const targets = value.targets.map((target) =>
    parseReviewProgressInventory(target),
  );
  if (
    targets.length < 2 ||
    targets.length > 16 ||
    stableJson(targets[0]) !== stableJson(primary) ||
    new Set(targets.map(({ targetPath }) => targetPath)).size !==
      targets.length ||
    stableJson(targets.map(({ targetPath }) => targetPath)) !==
      stableJson(targets.map(({ targetPath }) => targetPath).sort())
  )
    throw new Error("progress inventory v2のtargetが不正です");
  return Object.freeze({
    ...primary,
    schemaVersion: "agent-skill-chain/review-progress-inventory/v2",
    targets: Object.freeze(targets),
  });
}

function exactInstant(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}が不正です`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`${label}はISO 8601 UTC日時が必要です`);
  return value;
}

function digestRecord(value: Record<string, unknown>): string {
  return sha256(stableJson(value));
}

export function makeReviewProgressEntry(input: {
  previous: readonly ReviewProgressRecord[];
  sessionId: string;
  implementationHeadSha: string;
  taskId: string;
  state: ReviewProgressState;
  recordedAt: string;
}): ReviewProgressEntry {
  if (input.previous.length >= 256)
    throw new Error("progress journalは256 entry以下が必要です");
  const previousDigest = latestReviewProgressDigest(input.previous);
  if (!SHA256.test(input.sessionId) || !OID.test(input.implementationHeadSha))
    throw new Error("progress entryのreview bindingが不正です");
  if (!TASK_ID.test(input.taskId)) throw new Error("progress taskIdが不正です");
  if (!STATES.includes(input.state))
    throw new Error("progress stateが不正です");
  exactInstant(input.recordedAt, "progress recordedAt");
  if (input.previous.some((record) => "sealDigest" in record))
    throw new Error("sealed progress journalへ追記できません");
  const sequence = input.previous.length + 1;
  const identity = {
    sessionId: input.sessionId,
    implementationHeadSha: input.implementationHeadSha,
    taskId: input.taskId,
    state: input.state,
    recordedAt: input.recordedAt,
    sequence,
  };
  const entryId = digestRecord(identity);
  const withoutDigest = {
    schemaVersion: "agent-skill-chain/review-progress-entry/v1" as const,
    entryId,
    ...identity,
    previousDigest,
  };
  return Object.freeze({
    ...withoutDigest,
    entryDigest: digestRecord(withoutDigest),
  });
}

export function makeReviewProgressSeal(input: {
  previous: readonly ReviewProgressRecord[];
  sessionId: string;
  implementationHeadSha: string;
  sealedAt: string;
}): ReviewProgressSeal {
  if (input.previous.length > 256)
    throw new Error("progress journalの上限を超えました");
  if (input.previous.some((record) => "sealDigest" in record))
    throw new Error("progress journalは既にsealedです");
  if (!SHA256.test(input.sessionId) || !OID.test(input.implementationHeadSha))
    throw new Error("progress sealのreview bindingが不正です");
  exactInstant(input.sealedAt, "progress sealedAt");
  const withoutDigest = {
    schemaVersion: "agent-skill-chain/review-progress-seal/v1" as const,
    sessionId: input.sessionId,
    implementationHeadSha: input.implementationHeadSha,
    previousDigest: latestReviewProgressDigest(input.previous),
    sealedAt: input.sealedAt,
  };
  return Object.freeze({
    ...withoutDigest,
    sealDigest: digestRecord(withoutDigest),
  });
}

export function latestReviewProgressDigest(
  records: readonly ReviewProgressRecord[],
): string | null {
  const latest = records.at(-1);
  return latest
    ? "entryDigest" in latest
      ? latest.entryDigest
      : latest.sealDigest
    : null;
}

export function parseReviewProgressRecords(
  source: string,
): readonly ReviewProgressRecord[] {
  if (Buffer.byteLength(source, "utf8") > 256 * 1024)
    throw new Error("progress journalは256 KiB以下が必要です");
  const lines = source === "" ? [] : source.trimEnd().split("\n");
  if (lines.length > 257) throw new Error("progress journalの上限を超えました");
  const records: ReviewProgressRecord[] = [];
  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`progress journal ${index + 1}行目がJSONではありません`);
    }
    if (!isRecord(value)) throw new Error("progress recordはobjectが必要です");
    const isSeal =
      value.schemaVersion === "agent-skill-chain/review-progress-seal/v1";
    const expectedFields = isSeal
      ? [
          "schemaVersion",
          "sessionId",
          "implementationHeadSha",
          "previousDigest",
          "sealedAt",
          "sealDigest",
        ]
      : [
          "schemaVersion",
          "sequence",
          "entryId",
          "sessionId",
          "implementationHeadSha",
          "taskId",
          "state",
          "recordedAt",
          "previousDigest",
          "entryDigest",
        ];
    if (
      Object.keys(value).some((field) => !expectedFields.includes(field)) ||
      expectedFields.some((field) => !(field in value))
    )
      throw new Error("progress recordのfieldが不正です");
    if (value.previousDigest !== latestReviewProgressDigest(records))
      throw new Error("progress journalのdigest chainが不正です");
    const digestField = isSeal ? "sealDigest" : "entryDigest";
    const claimed = String(value[digestField] ?? "");
    const withoutDigest = Object.fromEntries(
      Object.entries(value).filter(([field]) => field !== digestField),
    );
    if (!SHA256.test(claimed) || digestRecord(withoutDigest) !== claimed)
      throw new Error("progress record digestが不正です");
    if (isSeal) {
      if (
        !SHA256.test(String(value.sessionId ?? "")) ||
        !OID.test(String(value.implementationHeadSha ?? ""))
      )
        throw new Error("progress sealのreview bindingが不正です");
      exactInstant(value.sealedAt, "progress sealedAt");
      if (index !== lines.length - 1)
        throw new Error("seal後のrecordを拒否しました");
      records.push(value as unknown as ReviewProgressSeal);
    } else {
      if (value.schemaVersion !== "agent-skill-chain/review-progress-entry/v1")
        throw new Error("progress entry schemaVersionが不正です");
      if (
        value.sequence !== index + 1 ||
        !TASK_ID.test(String(value.taskId ?? "")) ||
        !SHA256.test(String(value.entryId ?? "")) ||
        !SHA256.test(String(value.sessionId ?? "")) ||
        !OID.test(String(value.implementationHeadSha ?? ""))
      )
        throw new Error("progress entry identityが不正です");
      if (!STATES.includes(value.state as ReviewProgressState))
        throw new Error("progress entry stateが不正です");
      exactInstant(value.recordedAt, "progress recordedAt");
      const expectedEntryId = digestRecord({
        sessionId: value.sessionId,
        implementationHeadSha: value.implementationHeadSha,
        taskId: value.taskId,
        state: value.state,
        recordedAt: value.recordedAt,
        sequence: value.sequence,
      });
      if (value.entryId !== expectedEntryId)
        throw new Error("progress entryIdがidentityと一致しません");
      records.push(value as unknown as ReviewProgressEntry);
    }
  }
  return Object.freeze(records);
}

export function renderReviewProgress(
  records: readonly ReviewProgressRecord[],
  taskIds?: readonly string[],
): string {
  const latest = new Map<string, ReviewProgressState>();
  for (const taskId of taskIds ?? []) latest.set(taskId, "planned");
  for (const record of records)
    if ("taskId" in record) latest.set(record.taskId, record.state);
  const rows = [...latest]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([task, state]) => `| ${task} | ${state} |`);
  return `\n\n| タスク | 並行進捗 |\n|---|---|\n${rows.join("\n")}\n\n`;
}

export function verifyReviewProgressTarget(input: {
  inventory: ReviewProgressInventory;
  source: string;
  records: readonly ReviewProgressRecord[];
}): void {
  const { prefix, body, suffix } = splitTarget(input.source);
  if (
    sha256(prefix) !== input.inventory.prefixDigest ||
    sha256(suffix) !== input.inventory.suffixDigest
  )
    throw new Error("parallel progress marker外のbyteがbaselineと一致しません");
  if (
    sha256(input.source) !== input.inventory.baselineDigest &&
    body !== renderReviewProgress(input.records, input.inventory.allowedTaskIds)
  )
    throw new Error(
      "parallel progress sectionがjournalの純粋projectionと一致しません",
    );
}

export function projectReviewProgressTarget(input: {
  inventory: ReviewProgressInventory;
  source: string;
  records: readonly ReviewProgressRecord[];
}): string {
  verifyReviewProgressTarget(input);
  const { prefix, suffix } = splitTarget(input.source);
  return `${prefix}${renderReviewProgress(input.records, input.inventory.allowedTaskIds)}${suffix}`;
}

export function parallelCriticalPath(
  reviewDuration: number,
  progressDuration: number,
): number {
  if (reviewDuration < 0 || progressDuration < 0)
    throw new Error("durationは0以上が必要です");
  return Math.max(reviewDuration, progressDuration);
}
