import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  advanceReviewSession,
  parseReviewRoundInput,
  unconvergedReviewSessionDiagnostic,
  type ReviewRoundInput,
  type ReviewSessionState,
} from "../domain/review-convergence.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
  withStagingMutationLock,
} from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import {
  buildReviewProgressInventories,
  describeReviewProgressUnbuildable,
  tryBuildReviewProgressInventories,
  type ReviewProgressInventory,
  type ReviewProgressInventoryOutcome,
  PROGRESS_END,
  PROGRESS_START,
  reviewProgressTargets,
} from "../domain/review-progress.js";
import {
  assertWorkflowStaging,
  describeStagingDigestDrift,
  readWorkflowJournal,
} from "./workflow-journal.js";
import { evidenceOnlySuffix, observeReviewDiff } from "./review-diff.js";
import {
  isDefaultBranchFollowMerge,
  REVIEW_SESSION_FILE,
  readStoredReviewSession,
} from "./review-session-store.js";
import { resolveGitWorkspace } from "./review-workspace.js";
import { findDecisionJournalRecord } from "./decision-journal-store.js";
import { LIGHTWEIGHT_TIER_PROVIDER_VERSION } from "./decision-invoke.js";
import {
  computeFindingClassificationInputDigest,
  verifyDecisionRefBinding,
} from "../domain/decision-journal.js";
import type {
  ReviewAdjacentScope,
  ReviewRoundFinding,
} from "../domain/review-convergence.js";
import type { ImpactSet } from "../domain/impact-set.js";
import { deriveReviewRoundImpact } from "./impact-set.js";

export { observeReviewDiff, REVIEW_SESSION_FILE, readStoredReviewSession };
import { deriveEffectiveHead } from "../domain/evidence-reanchor.js";
import { readEvidenceReanchorChain } from "./evidence-reanchor.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { recordLayerSuffix } from "./review-record-layer.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
};

/**
 * **合成経路の検査点。** `assertStoredStagingDigest`はmodule内部の判定だが、
 * ここが`describeStagingDigestDrift`へ委譲しているかを外から観測できないと、この経路の
 * 委譲を落とす変異が生存する。判定を変えず同じ関数を公開するだけにする。
 */
export function assertStoredStagingDigestForTest(staging: string): void {
  assertStoredStagingDigest(staging);
}

function assertStoredStagingDigest(staging: string): void {
  const stored = readStoredStagingRecord(staging);
  const artifacts = listStagingArtifacts(staging);
  if (
    stableJson(stored.artifacts) !== stableJson(artifacts) ||
    stored.digest !== calculateStagingDigest(staging, artifacts)
  )
    throw new Error(
      `review session更新前のstaging成果物一覧またはdigestが一致しません${describeStagingDigestDrift(staging)}`,
    );
}

/**
 * 影響集合の案内。**表示専用であり`round`へ入れない。**
 * fullのときは全体reviewが適用されることを理由付きで示す。
 */
function impactNotes(impact: ImpactSet): string[] {
  const notes: string[] = [];
  if (impact.mode === "targeted")
    notes.push(
      `影響集合（digest ${impact.digest.slice(0, 12)}）から隣接範囲${impact.adjacent.length}件をfocus.adjacentScopeへ設定した。隣接範囲の前round blocker起因のHigh回帰と固定契約違反はcurrent blockerになる`,
    );
  else
    notes.push(
      `影響集合を証明できないため全体reviewを適用する（focus.adjacentScopeUnbounded=true。全pathを隣接範囲として扱い、前round blocker起因のHigh回帰と固定契約違反は修正差分外でもcurrent blockerになる）: ${impact.reasons.slice(0, 3).join("; ")}${impact.reasons.length > 3 ? ` ほか${impact.reasons.length - 3}件` : ""}`,
    );
  if (impact.securitySensitive)
    notes.push(
      `security上の注意を要するpathが変更または隣接範囲にある。縮小せず確認する: ${impact.securityPaths.join(", ")}`,
    );
  return notes;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function latestImplementationEntry(staging: string) {
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `review round前のworkflow journalが不正です: ${journal.errors.join("; ")}`,
    );
  return [...journal.entries]
    .reverse()
    .find((entry) => entry.step === 9 && !entry.postTerminalIntake);
}

function resolveCommit(root: string, label: string, sha: string): string {
  const observed = git(["rev-parse", "--verify", `${sha}^{commit}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (observed.status !== 0)
    throw new Error(
      `review round --initの${label}をexact commitへ解決できません: ${sha}`,
    );
  return observed.stdout.trim();
}

function commitSubject(root: string, sha: string): string {
  return git(["show", "-s", "--format=%s", sha], root, {
    env: GIT_ENV,
  }).stdout.trim();
}

/**
 * **次roundの入力雛形を保存済みsessionと実Gitから組み立てる**（Issue #1323、A-2）。
 *
 * findings以外を確定した`ReviewRoundInput`を返す。sessionが無ければround 1で、
 * `baseSha`・`scopeIds`・`acceptanceCriteriaIds`を要求し`initialDiffDigest`を実測する。
 * sessionがあれば次roundで、anchorをsessionから写し、`previousBlocking`を前roundの
 * blocking、`fixedDiff`を再固定chainの実効HEADから`headSha`までの実Git差分にする。
 * **stagingもsessionも書かない。** 判定は`previewReviewRound`が従来どおり行う。
 */
export function buildReviewRoundDraft(input: {
  staging: string;
  headSha: string;
  baseSha?: string;
  scopeIds?: readonly string[];
  acceptanceCriteriaIds?: readonly string[];
  invariantIds?: readonly string[];
  progressTargetPaths?: readonly string[];
}): {
  round: ReviewRoundInput;
  notes: readonly string[];
  bundleDigest: string;
  bundleBytes: number;
} {
  const staging = assertWorkflowStaging(input.staging);
  const root = stagingRepositoryRoot(staging);
  const headSha = resolveCommit(root, "--head", input.headSha);
  const previous = readStoredReviewSession(staging);
  const notes: string[] = [];
  /**
   * progress不成立の案内。**`round`へは入れない。**
   * `notes`は`parseReviewRoundInput`にも`review-convergence.ts`にも現れない
   * 表示専用の枠であり、ここへ載せる限りanchorとround digestを変えない。
   */
  const progressNotes: string[] = [];
  const currentHeadSha = git(["rev-parse", "--verify", "HEAD^{commit}"], root, {
    env: GIT_ENV,
  }).stdout.trim();
  /**
   * **previewが拒否する雛形を書かない**（round 1 REV-02）。`review round`は
   * current HEADだけを受理し、収束後は空でない実fixedDiffを要求するため、
   * その条件を満たさない入力はnotesでなくerrorにする。
   */
  if (currentHeadSha !== headSha)
    throw new Error(
      `review round --initの--head ${headSha.slice(0, 8)} はrepositoryのcurrent HEAD ${currentHeadSha.slice(0, 8)} と一致しません。review roundはcurrent HEADだけを受理します`,
    );
  let round: unknown;
  if (previous === null) {
    const implementation = latestImplementationEntry(staging);
    if (!implementation?.implementationHeadSha)
      throw new Error(
        "初回reviewにはimplementationHeadSha bindingを持つStep 9が必要です。current HEADでworkflow record --step=9を実行してください",
      );
    if (implementation.implementationHeadSha !== headSha)
      throw new Error(
        `review round --initの--headはStep 9 implementation HEAD ${implementation.implementationHeadSha} と一致する必要があります`,
      );
    if (typeof input.baseSha !== "string")
      throw new Error(
        "review round --initはsessionが無いとき--base=<sha>が必要です",
      );
    if (!input.scopeIds?.length || !input.acceptanceCriteriaIds?.length)
      throw new Error(
        "review round --initはsessionが無いとき--scope=<ID,...>と--ac=<ID,...>が必要です",
      );
    const baseSha = resolveCommit(root, "--base", input.baseSha);
    const observed = observeReviewDiff(root, baseSha, headSha);
    /**
     * **宣言済みtargetを1件ずつ分類してから一体で構築する。**
     *
     * 複数target（最大16）とREQ-WF-021の非停止化は両立させる必要がある。
     * 例外で構築するとtargetが1件でも不成立なときroundが止まり、REQ-WF-021が
     * 明文で禁じる「review gateがprogressの失敗を拒否理由にする」状態へ戻る。
     * file状態の不成立は値で受け取って案内へ回し、roundはそのまま開く。
     */
    const explicitTargets = Boolean(input.progressTargetPaths?.length);
    const requestedTargets = explicitTargets
      ? [...new Set(input.progressTargetPaths)].sort()
      : ["03_実装計画.md"];
    let unbuildable:
      | Extract<ReviewProgressInventoryOutcome, { state: "unbuildable" }>
      | undefined;
    const observedTargets: {
      targetPath: string;
      source: string;
      target: {
        fileMode: number;
        isSymbolicLink: boolean;
        isRegularFile: boolean;
      };
    }[] = [];
    for (const targetPath of requestedTargets) {
      const file = path.join(staging, targetPath);
      /**
       * **不在だけを不在として扱う。** `fs.existsSync`はEACCES等でも`false`を
       * 返すため、読めない対象を「無い」と誤認して案内も出さずroundを開く
       * fail-open経路になる（実測: 親directoryが`0o000`のとき`existsSync`は
       * `false`、`lstatSync`はEACCES）。ENOENT以外は従来どおり伝播させる。
       */
      let stat: fs.Stats | undefined;
      try {
        stat = fs.lstatSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!stat) {
        if (explicitTargets)
          throw new Error(
            `parallel progress targetが存在しません: ${targetPath}`,
          );
        continue;
      }
      /**
       * **種別を判定してから読む。** `readFileSync`を先に置くと、directoryや
       * FIFOが分類より前にthrowして「通常fileでない」の分類へ到達しない。
       */
      if (!stat.isFile()) {
        unbuildable = Object.freeze({
          state: "unbuildable" as const,
          targetPath,
          reason: "not-regular-file" as const,
          observedMode: stat.mode & 0o777,
          isSymbolicLink: stat.isSymbolicLink(),
          isRegularFile: false,
        });
        break;
      }
      const source = fs.readFileSync(file, "utf8");
      /**
       * **片側markerでも判定へ回す。** 両方揃った場合だけ判定すると、
       * 壊れたmarkerが`marker-not-single-pair`の案内を経由せず、
       * markerを使っていないstagingと区別できないまま無言で落ちる。
       */
      if (!source.includes(PROGRESS_START) && !source.includes(PROGRESS_END)) {
        if (explicitTargets)
          throw new Error(
            `parallel progress markerがありません: ${targetPath}`,
          );
        continue;
      }
      observedTargets.push({
        targetPath,
        source,
        target: {
          fileMode: stat.mode & 0o777,
          isSymbolicLink: stat.isSymbolicLink(),
          isRegularFile: true,
        },
      });
    }
    let progressInventory: ReviewProgressInventory | undefined;
    if (!unbuildable && observedTargets.length) {
      const outcome = tryBuildReviewProgressInventories(observedTargets);
      if (outcome.state === "built") progressInventory = outcome.inventory;
      else unbuildable = outcome;
    }
    if (unbuildable) {
      const guidance = describeReviewProgressUnbuildable({
        reason: unbuildable.reason,
        observedMode: unbuildable.observedMode,
        isSymbolicLink: unbuildable.isSymbolicLink,
        isRegularFile: unbuildable.isRegularFile,
        targetPath: unbuildable.targetPath,
      });
      progressNotes.push(
        `[${guidance.code}] ${guidance.target}のparallel progress inventoryを構築できません（${guidance.reason}）。実測=${guidance.observed} 期待=${guidance.expected}。${guidance.effect}。${guidance.action}${guidance.repairArgv ? `: ${guidance.repairArgv.join(" ")}` : ""}。必要authority=${guidance.requiredAuthority}。rollback=${guidance.rollback}`,
      );
    }
    round = {
      round: 1,
      previousRoundDigest: null,
      anchor: {
        /** anchorのID列は重複なし昇順が契約であり、雛形側で正規化する */
        scopeIds: sortedUnique(input.scopeIds),
        acceptanceCriteriaIds: sortedUnique(input.acceptanceCriteriaIds),
        invariantIds: sortedUnique(input.invariantIds ?? []),
        diffBaseSha: baseSha,
        initialHeadSha: headSha,
        initialDiffDigest: observed.digest,
        ...(progressInventory ? { progressInventory } : {}),
      },
      candidateHeadSha: headSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    };
    notes.push(
      "round 1は固定initial HEADの全scope reviewである。findingsへreviewの指摘を書く",
    );
  } else {
    /** budget枯渇はHEAD差分の有無より先に固有の停止理由を返す。 */
    if (previous.status === "budget-exhausted")
      throw new Error(
        "review round --init: sessionはbudget-exhaustedです。取り直しroundは開けません。follow-up Issueの新しいstagingで工程を通してください",
      );
    if (
      input.baseSha !== undefined ||
      input.scopeIds ||
      input.acceptanceCriteriaIds ||
      input.invariantIds
    )
      notes.push(
        "sessionがあるため--base・--scope・--ac・--invariantは無視し、anchorをsessionから写した",
      );
    const previousHeadSha = deriveEffectiveHead({
      records: readEvidenceReanchorChain(staging),
      anchoredHeadSha: previous.latestCandidateHeadSha,
    }).effectiveHeadSha;
    const fixed = observeReviewDiff(
      root,
      previousHeadSha,
      headSha,
    ).changedPaths;
    const last = previous.rounds.at(-1);
    const previousBlocking = [...(last?.blocking ?? [])];
    /**
     * **前round blockerの再評価行を雛形へ写す。** 判定はreviewerが`status`を
     * `resolved`へ変えるか`valid`のまま残すだけでよく、ID・contractId・relation・
     * pathを毎round書き直させない（利用projectの実測では再掲finding 1,142件が
     * 新規finding 935件を上回っていた）。`admission`等の判定結果は写さない。
     */
    /**
     * **前roundのdecisionRefは新roundへ引き継がない（PR #1497独立review
     * round 4指摘）。** `decisionRef`は記録時のround（`candidateHeadSha`）へ
     * 束縛されている。ここは新HEAD向けの雛形を書くだけで、`fixedDiff`が
     * 非空のため`candidateHeadSha`は前roundと異なる。引き継いだ`decisionRef`は
     * `verifyReviewRoundDecisionRefs`のcandidateHeadSha検証で必ず拒否され、
     * 「decisionRefが引き継がれている」という事実を教えない不親切なerrorに
     * なる（fail-closed自体は保たれるためsafetyの問題ではない。UXの問題）。
     * 事前にnullへ戻し、新HEADで再invokeしてから記入するようnotesへ書く。
     */
    let carriedDecisionRefCleared = false;
    const carried = (last?.findings ?? [])
      .filter(({ id }) => previousBlocking.includes(id))
      .map((finding) => {
        if (finding.decisionRef !== null && finding.decisionRef !== undefined)
          carriedDecisionRefCleared = true;
        return {
          id: finding.id,
          severity: finding.severity,
          status: finding.status,
          source: finding.source,
          relation: finding.relation,
          evidence: finding.evidence,
          path: finding.path,
          contractId: finding.contractId,
          causedByFindingId: finding.causedByFindingId,
          decisionRef: null,
        };
      });
    if (carriedDecisionRefCleared)
      notes.push(
        "前round blockerが持っていたdecisionRefはnullへ戻した。前roundのcandidateHeadShaに束縛されており新HEADでは検証できないため。是正済みならevidenceに確認内容を書く。Decision Journalの記録を再利用したい場合は新HEADでdecisionを再invokeしてからdecisionRefへ記入する",
      );
    /**
     * **隣接範囲は影響集合から導出する**（REQ-WF-039）。差分が空のときは下で
     * 拒否するため導出しない。記録時は`previewReviewRound`が同じ関数で再導出し照合する。
     */
    let adjacentScope: readonly ReviewAdjacentScope[] = [];
    let adjacentScopeUnbounded = false;
    if (fixed.length > 0) {
      const derived = deriveReviewRoundImpact({
        root,
        previousHeadSha,
        headSha,
      });
      adjacentScope = derived.adjacentScope;
      adjacentScopeUnbounded = derived.adjacentScopeUnbounded;
      notes.push(...impactNotes(derived.impact));
    }
    round = {
      round: previous.rounds.length + 1,
      previousRoundDigest: previous.latestRoundDigest,
      anchor: previous.anchor,
      candidateHeadSha: headSha,
      focus: {
        previousBlocking,
        fixedDiff: fixed,
        adjacentScope,
        ...(adjacentScopeUnbounded
          ? { adjacentScopeUnbounded: true as const }
          : {}),
      },
      findings: carried,
      ...(previous.status === "converged" &&
      recordLayerSuffix(staging, root, previousHeadSha, headSha, previous)
        ? { recordLayerOnly: true }
        : {}),
    };
    if (previousBlocking.length > 0)
      notes.push(
        `前round blocker ${previousBlocking.join("、")} をfindingsへ写した。是正済みならstatusをresolvedへ変え、evidenceに確認内容を書く。未解決はvalidのまま残す。脱落は拒否される`,
      );
    if (fixed.length === 0)
      throw new Error(
        "review round --init: 前round headからの実Git差分が空です。前roundのcandidate HEADが現在のHEADと同じです。多くの場合、前roundの--headに「そのroundを検分したHEAD」ではなく「そのroundの指摘を是正した後のHEAD」を渡しています。その場合、HEADを進めても取り違えが重なるだけです。review-session.jsonのroundごとのcandidateHeadShaを実際のレビュー順と突き合わせてください",
      );
    if (previous.status === "converged")
      notes.push(
        "sessionはconvergedである。取り直しroundは収束後のHEAD移動に対して1回だけ許される",
      );
  }
  notes.push(
    `このroundは ${headSha.slice(0, 8)} (${commitSubject(root, headSha)}) を検分したものとして記録します。レビュー結果を反映したcommitを、このroundの記録より先に作らないでください`,
  );
  notes.push(...progressNotes);
  const parsed = parseReviewRoundInput(round);
  /** CLIが保存するreviewer input bundleの実byte列（末尾改行を含む）へ固定する。 */
  const canonical = `${stableJson(parsed)}\n`;
  const bundleBytes = Buffer.byteLength(canonical, "utf8");
  if (bundleBytes > 256 * 1024)
    throw new Error("reviewer input bundleは256 KiB以下が必要です");
  return {
    round: parsed,
    notes,
    bundleDigest: crypto.createHash("sha256").update(canonical).digest("hex"),
    bundleBytes,
  };
}

/**
 * **既定branch追随だけのmergeかをGitから判定する**（Issue #1287）。
 *
 * 次の3条件をすべて満たすときだけ真とする。**いずれもGitから決定論的に観測でき、
 * 呼び出し側の申告を入力にしない。**
 *
 * 1. `candidate`がmerge commitであり、**第1親が前roundのcandidate**である
 * 2. **第2親がremote既定branch tipのancestor**である。任意branchの取り込みで
 *    予算を回避させない
 * 3. `git merge-tree --write-tree <第1親> <第2親>`が返すtreeが、**merge commitの
 *    tree自身と一致する**
 *
 * 条件3が成り立つとき、merge commitのtreeは両親から完全に決まる。**除外された
 * roundを通して実装を1 byteも持ち込めない。** 衝突解決はこの条件を満たさないため
 * 予算へ数える側に落ちる。衝突解決は実装者が書いた内容であり独立reviewの対象である。
 *
 * **観測できない場合はfail-closedで偽を返す。** remoteを読めない、`merge-tree`が
 * 使えない（git 2.38未満）などは「追随だと確認できなかった」であり、予算へ数える。
 */
/**
 * **round記録の前にstaging digestを再固定する。**
 *
 * reviewが固定するのはcandidate HEADであってstaging文書ではない。ところがASC自身が
 * 実装中の発見を03（quick/pocは00）へ追記させるため、従来はDISCを1件書くたびに
 * 「Issue再同期 → Step 9再確定 → round」の順序を強いていた（利用projectの実測で
 * 是正1周20〜30分の主因）。round側では不一致を拒否せず、現在の成果物一覧とdigestを
 * staging記録へ再固定してから判定する。**Issue同期との一致は`pr create`が
 * journalの同期証拠で引き続き検証する**ので、同期漏れは終端で止まる。
 */
function refixStagingDigestForRound(staging: string): void {
  /**
   * **journalの整合を確かめてから再固定する**（REQ-WF-036）。staging記録は集合digestしか
   * 持たないため、再固定は記録済みjournal行の改変も現在の内容として固定してしまう。
   * hash chainの破損とchain付きjournalでの封印field欠落はstrict parserが拒否するので、
   * その検査を通らないjournalではroundを成立させない（fail-closed）。
   */
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `workflow journalが不正なためreview roundのstaging digest再固定を拒否しました: ${journal.errors.join("; ")}`,
    );
  const stored = readStoredStagingRecord(staging);
  const artifacts = listStagingArtifacts(staging);
  if (
    stableJson(stored.artifacts) !== stableJson(artifacts) ||
    stored.digest !== calculateStagingDigest(staging, artifacts)
  )
    refreshStoredStagingDigest(staging);
}

/**
 * Step 10 review round consumer側の`decisionRef`機械検証（Issue #1485、L-03）。
 * `decisionRef !== null`のfindingだけを対象にする。人・進行役が直接記入した
 * 分類（`decisionRef === null`）は検証しない（BR-01強化の対象は
 * Decision Skill経由の判断だけ）。**`decisionRef`が未設定（`undefined`）の
 * legacy findingも同様に対象外とする**（PR #1497独立review round 4指摘。
 * `decisionRef`導入前に記録されたfindingにfieldそのものが無い場合を
 * nullと区別せず、Decision Journal検証の対象外＝人・進行役の直接記入と
 * 同じ扱いにする。§`decisionRef`はoptional field、`review-convergence.ts`
 * 参照）。
 *
 * 拒否理由は設計正本「最終確定仕様」§2の5種（decisionRef欠落／type不一致／
 * candidateHeadSha不一致／inputDigest不一致／provider version期限切れ）に
 * 対応する。**`findingAdmission`を緩めない。** ここでの拒否は
 * `previewReviewRound`全体を例外で止め、round自体を成立させない
 * （fail-closed。record-onlyへ黒く落とさない）。
 */
function verifyReviewRoundDecisionRefs(
  root: string,
  staging: string,
  candidateHeadSha: string,
  findings: readonly ReviewRoundFinding[],
): void {
  const decisionRefFindings = findings.filter(
    (finding) =>
      finding.decisionRef !== null && finding.decisionRef !== undefined,
  );
  if (decisionRefFindings.length === 0) return;
  const primaryRoot = resolveGitWorkspace(root).primaryRoot;
  for (const finding of decisionRefFindings) {
    const decisionRecordId = finding.decisionRef as string;
    const record = findDecisionJournalRecord(
      primaryRoot,
      staging,
      decisionRecordId,
    );
    if (record === undefined)
      throw new Error(
        `review round finding ${finding.id}のdecisionRef ${decisionRecordId} がdecision journalで見つかりません（decisionRef欠落）`,
      );
    const expectedInputDigest = computeFindingClassificationInputDigest({
      subjectRef: finding.id,
      path: finding.path,
      evidence: finding.evidence,
    });
    const verification = verifyDecisionRefBinding(record, {
      decisionTypeId: "DCAND-006",
      candidateHeadSha,
      inputDigest: expectedInputDigest,
      currentProviderVersion:
        record.executor.kind === "provider"
          ? LIGHTWEIGHT_TIER_PROVIDER_VERSION
          : null,
    });
    if (!verification.ok)
      throw new Error(
        `review round finding ${finding.id}のdecisionRef ${decisionRecordId} を検証できません: ${verification.reason}`,
      );
    /**
     * **`effectiveValue`とfinding.severityの一致も検証する（PR #1497独立review
     * round 4指摘）。** `inputDigest`はseverityを含まないため、上のbinding検証
     * だけではCritical〜HighのeffectiveValueを持つ確定decisionRecordを
     * severity: "Low"のfindingへ紐づけられてしまう。DCAND-006の
     * effectiveValueはfinding.severityと同じ値域（severity文字列そのもの）
     * を持つ既存仕様であり、不一致はround 2が防ぐべき「Critical→Lowの
     * 無言de-escalation」を`decisionRef`経由で素通りさせる。fail-closedで
     * roundそのものを拒否する（record-onlyへ黒く落とさない）。
     */
    if (record.effectiveValue !== finding.severity)
      throw new Error(
        `review round finding ${finding.id}のseverity ${finding.severity} がdecisionRef ${decisionRecordId} のeffectiveValue ${record.effectiveValue} と一致しません`,
      );
  }
}

export function previewReviewRound(input: {
  staging: string;
  round: ReviewRoundInput;
}): ReviewSessionState {
  const staging = assertWorkflowStaging(input.staging);
  refixStagingDigestForRound(staging);
  const previous = readStoredReviewSession(staging);
  let round = input.round;
  const root = stagingRepositoryRoot(staging);
  const currentHeadSha = git(["rev-parse", "--verify", "HEAD^{commit}"], root, {
    env: GIT_ENV,
  }).stdout.trim();
  if (currentHeadSha !== input.round.candidateHeadSha)
    throw new Error(
      "review round candidate HEADがrepositoryのcurrent HEADと一致しません",
    );
  verifyReviewRoundDecisionRefs(
    root,
    staging,
    input.round.candidateHeadSha,
    input.round.findings,
  );
  if (previous === null) {
    const implementation = latestImplementationEntry(staging);
    if (!implementation?.implementationHeadSha)
      throw new Error(
        "初回reviewにはimplementationHeadSha bindingを持つStep 9が必要です。current HEADでworkflow record --step=9を実行してください",
      );
    if (implementation.implementationHeadSha !== input.round.candidateHeadSha)
      throw new Error(
        "review round candidate HEADがStep 9 implementation HEADと一致しません",
      );
    const observed = observeReviewDiff(
      root,
      input.round.anchor.diffBaseSha,
      input.round.anchor.initialHeadSha,
    );
    if (observed.digest !== input.round.anchor.initialDiffDigest)
      throw new Error(
        "review roundのinitial diff digestがGit観測値と一致しません",
      );
    const inventory = input.round.anchor.progressInventory;
    if (inventory) {
      const observedTargets = reviewProgressTargets(inventory).map((item) => {
        const target = path.join(staging, item.targetPath);
        const targetStat = fs.lstatSync(target);
        if (
          targetStat.isSymbolicLink() ||
          !targetStat.isFile() ||
          targetStat.nlink !== 1 ||
          (targetStat.mode & 0o777) !== item.fileMode ||
          fs.realpathSync(target) !== target
        )
          throw new Error("review roundのprogress target identityが不正です");
        return {
          targetPath: item.targetPath,
          source: fs.readFileSync(target, "utf8"),
          fileMode: targetStat.mode & 0o777,
        };
      });
      const observedInventory = buildReviewProgressInventories(observedTargets);
      if (stableJson(observedInventory) !== stableJson(inventory))
        throw new Error(
          "review roundのprogress inventoryが実targetと一致しません",
        );
    }
  } else {
    /**
     * **前round headは再固定chainから導出した実効HEADである。**
     *
     * 生の`latestCandidateHeadSha`を使うと、rebase後に`review reanchor`が成立しても
     * 次の前進修正で「diff baseがcandidate HEADのancestorではありません」と拒否され、
     * **正規経路が再び塞がる**（Issue #1172）。chainが空なら
     * `latestCandidateHeadSha`そのものになり、判定は変更前と同一である。
     */
    const previousHeadSha = deriveEffectiveHead({
      records: readEvidenceReanchorChain(staging),
      anchoredHeadSha: previous.latestCandidateHeadSha,
    }).effectiveHeadSha;
    const fixed = observeReviewDiff(
      root,
      previousHeadSha,
      input.round.candidateHeadSha,
    ).changedPaths;
    if (stableJson(fixed) !== stableJson(input.round.focus.fixedDiff))
      throw new Error(
        "review roundのfixedDiffが前roundからの実Git差分と一致しません",
      );
    /**
     * **隣接範囲を実Gitから再導出して照合する**（REQ-WF-039）。
     *
     * `findingAdmission`は隣接範囲を修正差分と同じくcurrent scopeへ含めるため、
     * 申告された`adjacentScope`をそのまま受理すると、reviewerや進行役が任意の
     * 64桁digestを添えて範囲を広げられる。雛形と同じ関数で導出した値との
     * 完全一致だけを受理する。
     */
    const expectedImpact =
      fixed.length === 0
        ? { adjacentScope: [], adjacentScopeUnbounded: false }
        : deriveReviewRoundImpact({
            root,
            previousHeadSha,
            headSha: input.round.candidateHeadSha,
          });
    if (
      stableJson(expectedImpact.adjacentScope) !==
      stableJson(input.round.focus.adjacentScope)
    )
      throw new Error(
        "review roundのadjacentScopeが実Gitから導出した影響集合の隣接範囲と一致しません。review round --initの雛形を書き換えずに使ってください",
      );
    /**
     * **無制限の印も実Gitから再導出する。** 影響集合がfullなのに印が無いと
     * 修正差分外の回帰がrecord-onlyへ落ち、targetedより狭いadmissionになる。
     * 印の欠落（印導入前の雛形を含む）は観測値へ補い、観測が支えない印は拒否する。
     * 記録するroundは常に観測値の印を持つ。
     */
    if (
      input.round.focus.adjacentScopeUnbounded === true &&
      !expectedImpact.adjacentScopeUnbounded
    )
      throw new Error(
        "review roundのadjacentScopeUnboundedが実Gitから導出した影響集合と一致しません。review round --initの雛形を書き換えずに使ってください",
      );
    if (
      expectedImpact.adjacentScopeUnbounded &&
      input.round.focus.adjacentScopeUnbounded !== true
    )
      round = {
        ...input.round,
        focus: { ...input.round.focus, adjacentScopeUnbounded: true },
      };
    /**
     * **`followOnly`は申告ではなくGit観測から導出する**（Issue #1287）。
     *
     * 呼び出し側が旗を立てるだけで予算を回避できてはならない。観測が条件を
     * 満たさない申告は、理由を名指しして拒否する。
     */
    if (
      input.round.followOnly &&
      !isDefaultBranchFollowMerge(
        root,
        previousHeadSha,
        input.round.candidateHeadSha,
      )
    )
      throw new Error(
        "既定branch追随として記録できるのは、前roundのcandidateを第1親、既定branch tipのancestorを第2親とし、treeが両親の自動merge結果と一致するmerge commitだけです",
      );
    if (
      input.round.recordLayerOnly &&
      !recordLayerSuffix(
        staging,
        root,
        previousHeadSha,
        input.round.candidateHeadSha,
        previous,
      )
    )
      throw new Error(
        "record layerとして記録できるのはformal artifactとsealed journalから一致を証明したprogress投影だけです",
      );
  }
  return advanceReviewSession(previous, round);
}

export function recordReviewRound(input: {
  staging: string;
  round: ReviewRoundInput;
}): ReviewSessionState {
  const staging = assertWorkflowStaging(input.staging);
  return withStagingMutationLock(staging, () => {
    const next = previewReviewRound({ staging, round: input.round });
    const file = path.join(staging, REVIEW_SESSION_FILE);
    writeFileAtomic(file, `${stableJson(next)}\n`, {
      temporaryDirectory: path.dirname(staging),
    });
    refreshStoredStagingDigest(staging);
    const reread = readStoredReviewSession(staging);
    if (reread === null || stableJson(reread) !== stableJson(next))
      throw new Error("review sessionの書き込み後read-backが一致しません");
    assertStoredStagingDigest(staging);
    return reread;
  });
}

/** formal artifactと検証済みprogress投影だけの単一commitを観測する。 */
export function assertConvergedReviewSession(input: {
  staging: string;
  expectedDigest: string;
  currentHeadSha: string;
}): ReviewSessionState {
  const staging = assertWorkflowStaging(input.staging);
  assertStoredStagingDigest(staging);
  const session = readStoredReviewSession(staging);
  if (session === null)
    throw new Error("Step 10には永続review sessionが必要です");
  if (session.status !== "converged")
    throw new Error(unconvergedReviewSessionDiagnostic(session.status));
  if (session.latestRoundDigest !== input.expectedDigest)
    throw new Error(
      "Step 10のreview session digestが保存済みlatest roundと一致しません",
    );
  /**
   * **照合対象は再固定chainから導出した実効HEADである。**
   * chainが空なら`latestCandidateHeadSha`そのものになり、判定は変更前と同一である。
   */
  const effectiveHeadSha = deriveEffectiveHead({
    records: readEvidenceReanchorChain(staging),
    anchoredHeadSha: session.latestCandidateHeadSha,
  }).effectiveHeadSha;
  if (
    effectiveHeadSha !== input.currentHeadSha &&
    evidenceOnlySuffix(
      stagingRepositoryRoot(staging),
      effectiveHeadSha,
      input.currentHeadSha,
    ) === undefined &&
    recordLayerSuffix(
      staging,
      stagingRepositoryRoot(staging),
      effectiveHeadSha,
      input.currentHeadSha,
      session,
    ) === undefined
  )
    throw new Error(
      "review sessionのcandidate HEADがcurrent HEADと一致しません",
    );
  return session;
}
