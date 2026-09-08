/**
 * CI runの配送状態を、観測値だけから判定する。
 *
 * **判定は純関数である。** 永続状態を持たず、pollingせず、人間を自動で呼ばず、
 * mergeの門を新設しない。既存の拒否点は`conclusion === "success"`を要求しており、
 * run未生成・実行中・失敗のすべてが同じ「該当0件」へ潰れる。**そこで失われるのは
 * 安全性ではなく、待つべきか人を呼ぶべきかの判断基準である**（Issue #969）。
 */

/** 配送状態。Issue #969 が定める3値。 */
export type CiDeliveryState = "delivered" | "pending" | "undelivered";

export interface CiDeliveryRun {
  /** run識別子。 */
  runId: string;
  /** 対象head SHA。 */
  headSha: string;
  /** 起動イベント。 */
  event: string;
  /** 関連PR番号。 */
  pullRequestNumbers: readonly number[];
}

export interface CiDeliveryInput {
  /** 観測したrun一覧。成否で絞り込まない。 */
  runs: readonly CiDeliveryRun[];
  /** 判定対象のhead SHA。 */
  headSha: string;
  /** 判定対象のPR番号。 */
  pullRequest: number;
  /** head SHAがPRのheadになった時刻。ISO 8601。 */
  eventAt: string;
  /** 観測時刻。ISO 8601。 */
  observedAt: string;
  /** 猶予時間（分）。 */
  graceMinutes: number;
}

export interface CiDeliveryInspection {
  state: CiDeliveryState;
  /** 判定に使った該当run件数。 */
  runCount: number;
  /**
   * head SHAとeventが一致するrun件数。**対象PRへの関連付けを問わない。**
   * `runCount`が0でもこれが正なら「run未生成」ではなく「未関連付け」である。
   */
  headShaRunCount: number;
  /** イベントからの経過分。小数を切り捨てない。 */
  elapsedMinutes: number;
  graceMinutes: number;
  headSha: string;
  pullRequest: number;
  eventAt: string;
  observedAt: string;
  /** 次に採る行動。**人間を呼ぶ条件をここで一意にする。** */
  nextAction: string;
}

/**
 * **猶予時間の既定値。**
 *
 * Issue #969 の実測では GitHub Actions の run 生成が約22分遅れた。
 * **その実測を`pending`へ分類できる値にする。** 正本文書へは宣言しない。
 * 宣言しても判定はこの定数を読むため、二重の正本を作らないためである。
 */
export const CI_DELIVERY_GRACE_MINUTES = 30;

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}が不正です: ${value}`);
  return parsed;
}

/**
 * 観測値から配送状態を導出する。
 *
 * **`delivered`は成否を問わない。** runが生成されていれば配送は成立しており、
 * 成否の判定は既存の拒否点が持つ。ここで両者を混ぜると、失敗したrunを
 * 「まだ来ていない」と誤って報告する。
 */
export function inspectCiDelivery(
  input: CiDeliveryInput,
): CiDeliveryInspection {
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0)
    throw new Error(`猶予時間が不正です: ${String(input.graceMinutes)}`);
  const eventAt = parseInstant(input.eventAt, "イベント時刻");
  const observedAt = parseInstant(input.observedAt, "観測時刻");
  if (observedAt < eventAt) throw new Error("観測時刻がイベント時刻より前です");
  const matched = input.runs.filter(
    (run) =>
      run.headSha === input.headSha &&
      run.event === "pull_request" &&
      run.pullRequestNumbers.length === 1 &&
      run.pullRequestNumbers[0] === input.pullRequest,
  );
  /**
   * **「run未生成」と「run有りだが未関連付け」を区別する**（Issue #1280、AC-07）。
   * `pull_requests`はPRが閉じた瞬間に空になるため、両者は同じ「該当0件」へ潰れていた。
   * **判定は1つも変えず、報告だけを分ける。**
   */
  const headShaRunCount = input.runs.filter(
    (run) => run.headSha === input.headSha && run.event === "pull_request",
  ).length;
  const elapsedMinutes = (observedAt - eventAt) / 60000;
  const state: CiDeliveryState =
    matched.length > 0
      ? "delivered"
      : elapsedMinutes <= input.graceMinutes
        ? "pending"
        : "undelivered";
  return {
    state,
    runCount: matched.length,
    headShaRunCount,
    elapsedMinutes,
    graceMinutes: input.graceMinutes,
    headSha: input.headSha,
    pullRequest: input.pullRequest,
    eventAt: input.eventAt,
    observedAt: input.observedAt,
    nextAction: nextActionFor(state, input.graceMinutes, headShaRunCount),
  };
}

/**
 * 次に採る行動を1文で返す。
 *
 * **観測値を並べるだけでは足りない。** Issue #969 の誤診は、値の不足ではなく
 * 「待つのか人を呼ぶのか」の基準が無かったことによる。**`undelivered`を人間へ
 * 上げる唯一の条件として文言で固定する。**
 */
function nextActionFor(
  state: CiDeliveryState,
  graceMinutes: number,
  headShaRunCount: number,
): string {
  if (state === "delivered")
    return "CI runは生成済みです。結論を確認してください。人間を呼ばないでください";
  /**
   * **「未生成」と「run有りだが未関連付け」を同じ文言へ潰さない**（Issue #1280、AC-07）。
   * 後者はPRが閉じた、fork由来、`types: [closed]`由来のいずれかであり、**採る行動が違う。**
   * **状態は変えない。** ここで分岐を増やしても`state`は上流で確定済みである。
   */
  const cause =
    headShaRunCount > 0
      ? `CI runは${headShaRunCount}件生成済みですが対象PRへ関連付いていません`
      : "CI runが未生成です";
  if (state === "pending")
    return `${cause}。猶予${graceMinutes}分の内側です。再観測してください。人間を呼ばないでください`;
  return `${cause}。猶予${graceMinutes}分を超えました。人間へ上げてください`;
}

/**
 * merge後の固定run照合。**merge前の選別とは別の型・別の関数である。**
 *
 * **なぜ分けるのか。** `pull_requests`は「現在openで同一headを持つsame-repo PR」の
 * 一覧であり、**PRが閉じた瞬間に空になる**（Issue #1280で実測）。merge成功後の
 * read-backでこの空を許す必要があるが、**merge前の選別で空を許すと取り違えたrunで
 * mergeが通る**。共通のflagで切り替えると緩和がmerge前へ漏れるため、型を分けて
 * merge前の経路から到達できないようにする。
 *
 * 規範は「副作用の成否が曖昧な場合は同じ要求を再送せず、固定identityを使った
 * provider read-backだけで照合する」と定める。**再検索ではなく固定IDの直読みが規範側である。**
 */
export interface FixedMergeRunIdentity {
  /** merge前に固定したrun ID。 */
  runId: string;
  /** 対象repositoryの`owner/name`。 */
  repository: string;
  /** 認可したhead SHA。 */
  headSha: string;
  /** PRのhead ref名。 */
  headBranch: string;
  /** 対象PR番号。 */
  pullRequest: number;
}

export interface FixedMergeRunObservation {
  runId: string;
  repository: string;
  /** runを生成したhead側repository。**forkを排除するために見る。** */
  headRepository: string;
  event: string;
  headSha: string;
  headBranch: string;
  status: string;
  conclusion: string;
  /** 関連PR番号。**merge後は空になりうる。** */
  pullRequestNumbers: readonly number[];
}

export interface FixedMergeRunReconciliation {
  reconciled: boolean;
  /** 一致しなかった項目名。**「一致しません」だけにしない。** */
  mismatches: readonly string[];
}

/**
 * 固定identityと固定run観測を突合する。
 *
 * **不明を免除へ倒さない。** 空文字、未知のstatus、未知のconclusionはすべて不一致にする。
 * **`pullRequestNumbers`は空または対象PRだけを許す。** 他PRを含めば、merge後に別PRが
 * 同一headをopenで持つ状況で取り違える。
 */
export function reconcileFixedMergeRun(
  fixed: FixedMergeRunIdentity,
  observed: FixedMergeRunObservation,
): FixedMergeRunReconciliation {
  const mismatches: string[] = [];
  const require = (field: string, expected: string, actual: string): void => {
    if (expected === "" || actual !== expected) mismatches.push(field);
  };
  /**
   * **repository名は大文字小文字を無視して突合する**（外部reviewerの指摘）。
   *
   * GitHubのrepository名は大文字小文字を区別せず、providerは正規化した表記を返す。
   * **完全一致にすると、`--repo`の表記が違うだけでmerge後の照合が停止し、
   * `outcome=merged`のStep 11へ到達できない。** それは本Issueが直した欠陥そのものである。
   * **merge前の選別も既に`toLowerCase()`で比較しており、こちらだけ厳しくする理由がない。**
   *
   * **緩めるのは表記だけである。** owner/nameが異なるforkは畳んでも一致しない。
   * 空文字は`require`の歯止めがそのまま効く。
   */
  const requireRepository = (
    field: string,
    expected: string,
    actual: string,
  ): void => {
    require(field, expected.toLowerCase(), actual.toLowerCase());
  };
  require("runId", fixed.runId, observed.runId);
  requireRepository("repository", fixed.repository, observed.repository);
  /** **head側repositoryも対象と一致させる。** forkの同一commitを受理しない。 */
  requireRepository(
    "headRepository",
    fixed.repository,
    observed.headRepository,
  );
  require("event", "pull_request", observed.event);
  require("headSha", fixed.headSha, observed.headSha);
  require("headBranch", fixed.headBranch, observed.headBranch);
  require("status", "completed", observed.status);
  require("conclusion", "success", observed.conclusion);
  if (
    !Array.isArray(observed.pullRequestNumbers) ||
    observed.pullRequestNumbers.some((number) => number !== fixed.pullRequest)
  )
    mismatches.push("pullRequestNumbers");
  return { reconciled: mismatches.length === 0, mismatches };
}
