import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import {
  parseReviewProgressInventory,
  type ReviewProgressInventory,
} from "./review-progress.js";

/**
 * 通常のreviewラウンド予算。round 1で全scopeを見て、2と3で未解決blockerを追う。
 */
export const REVIEW_ROUND_BUDGET = 6;
/**
 * 収束後にHEADが動いたときの取り直しへ、予算とは別枠で1 roundだけ許す上限。
 *
 * **外部reviewerが何回reviewするかを利用側は制御できない。** 3 roundで収束した後に
 * 指摘が届いてHEADが進むと、`round > REVIEW_ROUND_BUDGET`だけを見る実装では
 * 是正を記録する経路が1つも残らない（Issue #1140）。
 *
 * **増分は収束後の取り直しに限る。** 未解決blockerを抱えたまま予算を使い切った
 * `budget-exhausted`からは開かない。開くと、任意の1 pushで新品の予算をもらえる。
 */
export const REVIEW_RECOVERY_ROUND = REVIEW_ROUND_BUDGET + 2;

/**
 * 保存できるround記録の総数上限。**予算とは別の量である。**
 *
 * 既定branch追随だけのroundは予算へ数えないため、記録の総数は予算を超えうる。
 * それでも無限には増やさない。**記録は残すが、際限なく増える保存領域は作らない。**
 */
export const REVIEW_ROUND_RECORD_LIMIT = 64;

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Z][A-Z0-9._-]{1,127}$/u;
const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
const STATUSES = ["valid", "resolved", "duplicate", "false-positive"] as const;
const SOURCES = ["review", "consultation", "audit"] as const;
const RELATIONS = [
  "acceptance-violation",
  "invariant-violation",
  "fix-regression",
  "improvement",
  "out-of-scope",
] as const;

export type ReviewFindingSeverity = (typeof SEVERITIES)[number];
export type ReviewFindingStatus = (typeof STATUSES)[number];
export type ReviewFindingSource = (typeof SOURCES)[number];
export type ReviewFindingRelation = (typeof RELATIONS)[number];

export interface ReviewSessionAnchor {
  scopeIds: readonly string[];
  acceptanceCriteriaIds: readonly string[];
  invariantIds: readonly string[];
  diffBaseSha: string;
  initialHeadSha: string;
  initialDiffDigest: string;
  progressInventory?: ReviewProgressInventory;
}

export interface ReviewAdjacentScope {
  path: string;
  graphEvidence: string;
}

export interface ReviewRoundFocus {
  previousBlocking: readonly string[];
  fixedDiff: readonly string[];
  adjacentScope: readonly ReviewAdjacentScope[];
}

export interface ReviewRoundFinding {
  id: string;
  severity: ReviewFindingSeverity;
  status: ReviewFindingStatus;
  source: ReviewFindingSource;
  relation: ReviewFindingRelation;
  evidence: string;
  path: string;
  contractId: string | null;
  causedByFindingId: string | null;
}

export interface ReviewRoundInput {
  round: number;
  previousRoundDigest: string | null;
  anchor: ReviewSessionAnchor;
  candidateHeadSha: string;
  focus: ReviewRoundFocus;
  findings: readonly ReviewRoundFinding[];
  /**
   * **既定branch追随だけでHEADが動いたroundを表す**（Issue #1287）。
   *
   * 立てられるのは、新しいcandidate HEADが「前roundのcandidateを第1親、既定branch
   * tipのancestorを第2親とし、treeが両親の自動merge結果と一致するmerge commit」で
   * ある場合に限る。**判定はGit観測から導出し、呼び出し側の自己申告を信用しない**
   * （`src/adapters/review-session.ts`が観測する）。
   *
   * この条件が成り立つとき、merge commitのtreeは両親から完全に決まる。**除外された
   * roundを通して実装を1 byteも持ち込めないため、追随を装った予算回避が成立しない。**
   * 衝突解決は実装者が書いた内容なので、この条件を満たさず予算へ数える。
   */
  followOnly?: true;
}

export interface AdmittedReviewFinding extends ReviewRoundFinding {
  admission: "block-current" | "record-only";
  admissionReason: string;
}

export interface ReviewRoundRecord {
  round: number;
  previousRoundDigest: string | null;
  candidateHeadSha: string;
  focus: ReviewRoundFocus;
  findings: readonly AdmittedReviewFinding[];
  blocking: readonly string[];
  recordOnly: readonly string[];
  /** 既定branch追随だけのroundは予算へ数えない。**記録は残す。** */
  followOnly?: true;
  roundDigest: string;
}

export interface ReviewSessionState {
  schemaVersion: "agent-skill-chain/review-session/v1";
  sessionId: string;
  anchor: ReviewSessionAnchor;
  rounds: readonly ReviewRoundRecord[];
  latestRoundDigest: string;
  latestCandidateHeadSha: string;
  status: "active" | "converged" | "budget-exhausted";
}

/** 非収束の原因と、ownerが受容する対象を混同させない診断を返す。 */
export function unconvergedReviewSessionDiagnostic(
  status: ReviewSessionState["status"],
): string {
  if (status === "budget-exhausted")
    return "review sessionが収束していません: status=budget-exhausted。有限review予算内で未解決blockerが残っています。ownerが受容する対象は既知の未解決findingです";
  return "review sessionが収束していません: status=active。reviewが未完了か、実際に検分したHEADとcandidateHeadShaの対応が誤っている可能性があります。ownerのrisk受容へ進まず、review-session.jsonのroundごとのcandidateHeadShaを実際のレビュー順と突き合わせてください";
}

/** `optionalFields`は必須にはせず、未知fieldとしても拒否しない。 */
function exactObject(
  value: unknown,
  label: string,
  fields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}はobjectが必要です`);
  const unknown = Object.keys(value).filter(
    (field) => !fields.includes(field) && !optionalFields.includes(field),
  );
  const missing = fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (unknown.length > 0)
    throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
  if (missing.length > 0)
    throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
  return value;
}

function stableStrings(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim() === "" ||
        item.normalize("NFC") !== item,
    )
  )
    throw new Error(`${label}は正規化済みの空でない文字列配列が必要です`);
  const values = value as string[];
  if (
    new Set(values).size !== values.length ||
    stableJson(values) !== stableJson([...values].sort())
  )
    throw new Error(`${label}は重複なしの昇順でなければなりません`);
  return Object.freeze([...values]);
}

function requiredStableId(value: unknown, label: string): string {
  if (typeof value !== "string" || !STABLE_ID.test(value))
    throw new Error(`${label}は安定IDが必要です`);
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.normalize("NFC") !== value ||
    Buffer.byteLength(value, "utf8") > 4096
  )
    throw new Error(`${label}は正規化済みの空でない文字列が必要です`);
  return value;
}

function safePath(value: unknown, label: string): string {
  const path = requiredText(value, label);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(`${label}はrepository相対pathが必要です`);
  return path;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`${label}が不正です`);
  return value as Values[number];
}

function parseAnchor(value: unknown): ReviewSessionAnchor {
  if (!isRecord(value)) throw new Error("review anchorはobjectが必要です");
  const fields = [
    "scopeIds",
    "acceptanceCriteriaIds",
    "invariantIds",
    "diffBaseSha",
    "initialHeadSha",
    "initialDiffDigest",
    "progressInventory",
  ];
  const required = fields.filter((field) => field !== "progressInventory");
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  const missing = required.filter((field) => !(field in value));
  if (unknown.length > 0)
    throw new Error(
      `review anchorの未知fieldを拒否しました: ${unknown.join(", ")}`,
    );
  if (missing.length > 0)
    throw new Error(
      `review anchorの必須fieldがありません: ${missing.join(", ")}`,
    );
  const anchor = value;
  const scopeIds = stableStrings(anchor.scopeIds, "review anchor.scopeIds");
  const acceptanceCriteriaIds = stableStrings(
    anchor.acceptanceCriteriaIds,
    "review anchor.acceptanceCriteriaIds",
  );
  const invariantIds = stableStrings(
    anchor.invariantIds,
    "review anchor.invariantIds",
  );
  if (scopeIds.length === 0 || acceptanceCriteriaIds.length === 0)
    throw new Error("review anchorにはscopeとAcceptance Criteriaが必要です");
  if (!OID.test(String(anchor.diffBaseSha ?? "")))
    throw new Error("review anchor.diffBaseShaが不正です");
  if (!OID.test(String(anchor.initialHeadSha ?? "")))
    throw new Error("review anchor.initialHeadShaが不正です");
  if (!SHA256.test(String(anchor.initialDiffDigest ?? "")))
    throw new Error("review anchor.initialDiffDigestが不正です");
  return Object.freeze({
    scopeIds,
    acceptanceCriteriaIds,
    invariantIds,
    diffBaseSha: String(anchor.diffBaseSha),
    initialHeadSha: String(anchor.initialHeadSha),
    initialDiffDigest: String(anchor.initialDiffDigest),
    ...(anchor.progressInventory === undefined
      ? {}
      : {
          progressInventory: parseReviewProgressInventory(
            anchor.progressInventory,
          ),
        }),
  });
}

function parseFocus(value: unknown): ReviewRoundFocus {
  const focus = exactObject(value, "review round.focus", [
    "previousBlocking",
    "fixedDiff",
    "adjacentScope",
  ]);
  if (!Array.isArray(focus.adjacentScope))
    throw new Error("review round.focus.adjacentScopeは配列が必要です");
  const adjacentScope = focus.adjacentScope.map((candidate, index) => {
    const adjacent = exactObject(
      candidate,
      `review round.focus.adjacentScope[${index}]`,
      ["path", "graphEvidence"],
    );
    return Object.freeze({
      path: safePath(
        adjacent.path,
        `review round.focus.adjacentScope[${index}].path`,
      ),
      graphEvidence: (() => {
        const evidence = requiredText(
          adjacent.graphEvidence,
          `review round.focus.adjacentScope[${index}].graphEvidence`,
        );
        if (!SHA256.test(evidence))
          throw new Error(
            `review round.focus.adjacentScope[${index}].graphEvidenceはGraph Evidence digestが必要です`,
          );
        return evidence;
      })(),
    });
  });
  const adjacentPaths = adjacentScope.map(({ path }) => path);
  if (new Set(adjacentPaths).size !== adjacentPaths.length)
    throw new Error("review round.focus.adjacentScopeのpathが重複しています");
  return Object.freeze({
    previousBlocking: stableStrings(
      focus.previousBlocking,
      "review round.focus.previousBlocking",
    ),
    fixedDiff: stableStrings(focus.fixedDiff, "review round.focus.fixedDiff"),
    adjacentScope: Object.freeze(adjacentScope),
  });
}

function parseFinding(value: unknown, index: number): ReviewRoundFinding {
  const label = `review round.findings[${index}]`;
  const finding = exactObject(value, label, [
    "id",
    "severity",
    "status",
    "source",
    "relation",
    "evidence",
    "path",
    "contractId",
    "causedByFindingId",
  ]);
  const nullableId = (candidate: unknown, field: string): string | null => {
    if (candidate === null) return null;
    return requiredStableId(candidate, `${label}.${field}`);
  };
  return Object.freeze({
    id: requiredStableId(finding.id, `${label}.id`),
    severity: oneOf(finding.severity, SEVERITIES, `${label}.severity`),
    status: oneOf(finding.status, STATUSES, `${label}.status`),
    source: oneOf(finding.source, SOURCES, `${label}.source`),
    relation: oneOf(finding.relation, RELATIONS, `${label}.relation`),
    evidence: requiredText(finding.evidence, `${label}.evidence`),
    path: safePath(finding.path, `${label}.path`),
    contractId: nullableId(finding.contractId, "contractId"),
    causedByFindingId: nullableId(
      finding.causedByFindingId,
      "causedByFindingId",
    ),
  });
}

export function parseReviewRoundInput(value: unknown): ReviewRoundInput {
  const round = exactObject(
    value,
    "review round",
    [
      "round",
      "previousRoundDigest",
      "anchor",
      "candidateHeadSha",
      "focus",
      "findings",
    ],
    ["followOnly"],
  );
  if (round.followOnly !== undefined && round.followOnly !== true)
    throw new Error("review round.followOnlyはtrueだけを受理します");
  if (!Number.isInteger(round.round) || Number(round.round) < 1)
    throw new Error("review round.roundは1以上の整数が必要です");
  if (
    round.previousRoundDigest !== null &&
    !SHA256.test(String(round.previousRoundDigest ?? ""))
  )
    throw new Error("review round.previousRoundDigestが不正です");
  if (!OID.test(String(round.candidateHeadSha ?? "")))
    throw new Error("review round.candidateHeadShaが不正です");
  if (!Array.isArray(round.findings) || round.findings.length > 256)
    throw new Error("review round.findingsは256件以下の配列が必要です");
  const findings = round.findings.map(parseFinding);
  if (new Set(findings.map(({ id }) => id)).size !== findings.length)
    throw new Error("review round.findingsのIDが重複しています");
  return Object.freeze({
    round: Number(round.round),
    previousRoundDigest:
      round.previousRoundDigest === null
        ? null
        : String(round.previousRoundDigest),
    anchor: parseAnchor(round.anchor),
    candidateHeadSha: String(round.candidateHeadSha),
    focus: parseFocus(round.focus),
    findings: Object.freeze(findings),
    ...(round.followOnly === true ? { followOnly: true as const } : {}),
  });
}

export function reviewSessionId(anchor: ReviewSessionAnchor): string {
  return crypto.createHash("sha256").update(stableJson(anchor)).digest("hex");
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return stableJson(left) === stableJson(right);
}

function findingAdmission(input: {
  finding: ReviewRoundFinding;
  round: number;
  anchor: ReviewSessionAnchor;
  focus: ReviewRoundFocus;
  priorBlocking: ReadonlySet<string>;
}): Pick<AdmittedReviewFinding, "admission" | "admissionReason"> {
  const { finding, round, anchor, focus, priorBlocking } = input;
  if (finding.status !== "valid")
    return {
      admission: "record-only",
      admissionReason: "resolvedまたは非有効findingは履歴だけに保持する",
    };
  if (finding.severity !== "Critical" && finding.severity !== "High")
    return {
      admission: "record-only",
      admissionReason: "Medium/Lowはcurrent scopeを拡大せず記録だけにする",
    };
  if (finding.relation === "improvement" || finding.relation === "out-of-scope")
    return {
      admission: "record-only",
      admissionReason: "改善提案または範囲外findingはfollow-upとして記録する",
    };

  const existingBlocker = priorBlocking.has(finding.id);
  if (round >= 2 && existingBlocker)
    return {
      admission: "block-current",
      admissionReason: "前roundの未解決blockerを同じsessionで追跡する",
    };

  const inFixedDiff = focus.fixedDiff.includes(finding.path);
  if (round >= 2 && !inFixedDiff)
    return {
      admission: "record-only",
      admissionReason: focus.adjacentScope.some(
        ({ path }) => path === finding.path,
      )
        ? "Graph Evidenceの実照合が未導入なので隣接範囲はcurrent blockerへ昇格しない"
        : "実Gitの修正差分外なのでcurrent scopeへ追加しない",
    };

  if (finding.relation === "acceptance-violation") {
    if (
      finding.contractId !== null &&
      anchor.acceptanceCriteriaIds.includes(finding.contractId)
    )
      return {
        admission: "block-current",
        admissionReason: "固定済みAcceptance Criteriaへの違反を再現した",
      };
    return {
      admission: "record-only",
      admissionReason: "固定済みAcceptance Criteriaへ結び付かない",
    };
  }
  if (finding.relation === "invariant-violation") {
    if (
      finding.contractId !== null &&
      anchor.invariantIds.includes(finding.contractId)
    )
      return {
        admission: "block-current",
        admissionReason: "固定済みdomain invariantへの違反を再現した",
      };
    return {
      admission: "record-only",
      admissionReason: "固定済みdomain invariantへ結び付かない",
    };
  }
  if (
    finding.relation === "fix-regression" &&
    finding.causedByFindingId !== null &&
    priorBlocking.has(finding.causedByFindingId) &&
    inFixedDiff
  )
    return {
      admission: "block-current",
      admissionReason: "前round blockerの修正差分がCritical/High回帰を導入した",
    };
  return {
    admission: "record-only",
    admissionReason: "修正起因を前round blockerと固定修正差分へ立証できない",
  };
}

/**
 * 予算へ数えるroundの件数。**`followOnly`は数えない。**
 *
 * 予算の目的は「同型のblockingで発散するreviewを打ち切る」ことであり、外部要因に
 * よる追随を数えることではない（Issue #1287）。
 */
export function countedRounds(state: ReviewSessionState | null): number {
  if (state === null) return 0;
  return state.rounds.filter((record) => !record.followOnly).length;
}

export function advanceReviewSession(
  previous: ReviewSessionState | null,
  round: ReviewRoundInput,
): ReviewSessionState {
  const sessionId = reviewSessionId(round.anchor);
  const expectedRound = previous === null ? 1 : previous.rounds.length + 1;
  if (round.round !== expectedRound)
    throw new Error(
      `review round resetまたは飛び越しを拒否しました: expected=${expectedRound} actual=${round.round}`,
    );
  if (round.round > REVIEW_ROUND_RECORD_LIMIT)
    throw new Error(
      `同一review sessionへ${REVIEW_ROUND_RECORD_LIMIT}件を超えるroundを記録できません`,
    );
  /**
   * **予算は「数えるround」に対して効かせる**（Issue #1287）。
   *
   * 既定branch追随だけのroundは実装者が1 byteも書いていないため、発散の指標に
   * ならない。実装者は他PRのmerge時刻を制御できず、在庫期間の長いPRほど予算が
   * 外部要因で削られる。**記録は残し、数えるroundだけを予算へ当てる。**
   */
  const countedRound = countedRounds(previous) + (round.followOnly ? 0 : 1);
  if (!round.followOnly && countedRound > REVIEW_RECOVERY_ROUND)
    throw new Error(
      `同一review sessionは${REVIEW_RECOVERY_ROUND} roundを超えて自動拡大できません`,
    );
  if (round.followOnly && round.findings.length > 0)
    throw new Error(
      "既定branch追随だけのroundへfindingを記録できません。指摘があるroundは予算へ数えます",
    );
  if (previous === null) {
    if (round.followOnly)
      throw new Error("round 1を既定branch追随として記録できません");
    if (round.previousRoundDigest !== null)
      throw new Error("round 1にpreviousRoundDigestを指定できません");
    if (
      round.candidateHeadSha !== round.anchor.initialHeadSha ||
      round.focus.previousBlocking.length > 0 ||
      round.focus.fixedDiff.length > 0 ||
      round.focus.adjacentScope.length > 0
    )
      throw new Error("round 1は固定initial HEADの全scope reviewで開始します");
  } else {
    /**
     * **取り直しの1 roundが収束後だけに開くことは、この1行が担っている。**
     *
     * `REVIEW_ROUND_BUDGET`到達後の非収束状態は`budget-exhausted`しか取り得ない
     * （status導出を参照）。したがって`round === REVIEW_RECOVERY_ROUND`かつ
     * `status !== "converged"`を別に判定しても到達しない。**到達しない条件を置くと、
     * それを外す変異が生存する死んだ分岐になる。** status導出の`>=`が
     * この含意を保証しており、`SCN-UNIT-REVIEWCONV-007`が固定する。
     */
    if (previous.status === "budget-exhausted")
      throw new Error("budget終了済みreview sessionは更新できません");
    if (previous.sessionId !== sessionId)
      throw new Error(
        "review sessionのscope・AC・invariant・diff anchor変更を拒否しました",
      );
    if (round.previousRoundDigest !== previous.latestRoundDigest)
      throw new Error(
        "review roundのprevious digestが保存済みlatest roundと一致しません",
      );
    if (
      previous.status === "converged" &&
      (round.candidateHeadSha === previous.latestCandidateHeadSha ||
        round.focus.fixedDiff.length === 0)
    )
      throw new Error(
        "収束後の追加reviewは前roundと異なるcandidate HEADと空でない実Git fixedDiffが必要です",
      );
    const prior = previous.rounds.at(-1)?.blocking ?? [];
    if (!sameStrings(round.focus.previousBlocking, [...prior].sort()))
      throw new Error("前round blockerをfocusから脱落または追加できません");
  }

  const priorBlocking = new Set(
    previous?.rounds.at(-1)?.blocking ?? ([] as readonly string[]),
  );
  const admittedFindings = round.findings.map((finding) =>
    Object.freeze({
      ...finding,
      ...findingAdmission({
        finding,
        round: round.round,
        anchor: round.anchor,
        focus: round.focus,
        priorBlocking,
      }),
    }),
  );
  if (round.round >= 2 && !round.followOnly) {
    const reportedPrior = new Set(
      admittedFindings
        .filter(({ id }) => priorBlocking.has(id))
        .map(({ id }) => id),
    );
    if ([...priorBlocking].some((id) => !reportedPrior.has(id)))
      throw new Error("前round blockerの再評価結果をfindingから脱落できません");
  }
  /**
   * follow-only roundはreviewを行わないため、直前の未解決blockerを解消したことにも
   * できない。findingを要求すると「追随だけなのでfinding禁止」という契約と矛盾
   * するため、保存済みblockerをそのまま次recordへ運ぶ。
   */
  const blocking = round.followOnly
    ? [...priorBlocking].sort()
    : admittedFindings
        .filter(({ admission }) => admission === "block-current")
        .map(({ id }) => id)
        .sort();
  const recordOnly = admittedFindings
    .filter(({ admission }) => admission === "record-only")
    .map(({ id }) => id)
    .sort();
  const roundWithoutDigest = {
    round: round.round,
    previousRoundDigest: round.previousRoundDigest,
    candidateHeadSha: round.candidateHeadSha,
    focus: round.focus,
    findings: admittedFindings,
    blocking,
    recordOnly,
    ...(round.followOnly ? { followOnly: true as const } : {}),
  };
  const roundDigest = crypto
    .createHash("sha256")
    .update(stableJson(roundWithoutDigest))
    .digest("hex");
  const record = Object.freeze({ ...roundWithoutDigest, roundDigest });
  const rounds = Object.freeze([...(previous?.rounds ?? []), record]);
  return Object.freeze({
    schemaVersion: "agent-skill-chain/review-session/v1",
    sessionId,
    anchor: round.anchor,
    rounds,
    latestRoundDigest: roundDigest,
    latestCandidateHeadSha: round.candidateHeadSha,
    /**
     * **取り直しのroundで未解決が残ればそこで終端にする。** `round === 3`だけを
     * 見ると`REVIEW_RECOVERY_ROUND`が`active`になり、上限を超えた次roundを
     * 要求できる状態が残る。
     */
    status:
      blocking.length === 0
        ? "converged"
        : countedRound >= REVIEW_ROUND_BUDGET
          ? "budget-exhausted"
          : "active",
  });
}

/**
 * 保存済みstateは各roundを先頭から再評価して検証する。保存側のadmissionやdigestを
 * authorityにせず、同じdomain policyから再導出するため改竄でblockerを脱落できない。
 */
export function parseReviewSessionState(value: unknown): ReviewSessionState {
  const state = exactObject(value, "review session", [
    "schemaVersion",
    "sessionId",
    "anchor",
    "rounds",
    "latestRoundDigest",
    "latestCandidateHeadSha",
    "status",
  ]);
  if (state.schemaVersion !== "agent-skill-chain/review-session/v1")
    throw new Error("review session.schemaVersionが不正です");
  if (
    !Array.isArray(state.rounds) ||
    state.rounds.length < 1 ||
    state.rounds.length > REVIEW_ROUND_RECORD_LIMIT
  )
    throw new Error(
      `review session.roundsは1〜${REVIEW_ROUND_RECORD_LIMIT}件が必要です`,
    );
  let rebuilt: ReviewSessionState | null = null;
  for (const [index, candidate] of state.rounds.entries()) {
    const record = exactObject(
      candidate,
      `review session.rounds[${index}]`,
      [
        "round",
        "previousRoundDigest",
        "candidateHeadSha",
        "focus",
        "findings",
        "blocking",
        "recordOnly",
        "roundDigest",
      ],
      ["followOnly"],
    );
    if (record.followOnly !== undefined && record.followOnly !== true)
      throw new Error(
        `review session.rounds[${index}].followOnlyはtrueだけを受理します`,
      );
    if (!Array.isArray(record.findings))
      throw new Error(
        `review session.rounds[${index}].findingsは配列が必要です`,
      );
    const findings = record.findings.map((finding, findingIndex) => {
      const admitted = exactObject(
        finding,
        `review session.rounds[${index}].findings[${findingIndex}]`,
        [
          "id",
          "severity",
          "status",
          "source",
          "relation",
          "evidence",
          "path",
          "contractId",
          "causedByFindingId",
          "admission",
          "admissionReason",
        ],
      );
      return Object.fromEntries(
        Object.entries(admitted).filter(
          ([field]) => field !== "admission" && field !== "admissionReason",
        ),
      );
    });
    const round = parseReviewRoundInput({
      round: record.round,
      previousRoundDigest: record.previousRoundDigest,
      anchor: state.anchor,
      candidateHeadSha: record.candidateHeadSha,
      focus: record.focus,
      findings,
      ...(record.followOnly === true ? { followOnly: true } : {}),
    });
    rebuilt = advanceReviewSession(rebuilt, round);
    const rebuiltRecord = rebuilt.rounds.at(-1);
    if (!rebuiltRecord || stableJson(rebuiltRecord) !== stableJson(candidate))
      throw new Error(
        `review session round ${index + 1}のadmissionまたはdigestが不正です`,
      );
  }
  if (rebuilt === null || stableJson(rebuilt) !== stableJson(value))
    throw new Error(
      "review sessionのanchor、latestまたはstatusが再導出値と一致しません",
    );
  return rebuilt;
}
