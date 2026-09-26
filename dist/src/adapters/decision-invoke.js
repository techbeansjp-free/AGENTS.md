/**
 * `agent-skill-chain decision invoke`の実行本体（Issue #1485、T-01/T-02）。
 *
 * 解決順序はdeterministic resolverを先に試し、無ければ設定済みprovider
 * （既定=lightweight-tier）へ委譲する（設計正本「最終確定仕様」§2）。
 * Jevは本Issueではdispatchできない（#1486以降）。lightweight-tierは
 * 「別serviceを呼ばず、この呼び出し自身（進行役）が提案するproposedValueを
 * 受け取り、authorityModeに従って有効値へ反映するかを判定する」という
 * 自己申告providerとして実装する。**Providerの自己申告だけでは
 * `findingAdmission`のfail-open経路を開けない**（advisory/one-way-escalation/
 * constrained-choiceが常にその不変条件を守る）。
 */
import { git } from "../lib/process.js";
import { GIT_ENV } from "./review-diff.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
import { resolveGitWorkspace } from "./review-workspace.js";
import { resolveJevProviderConfig } from "./local-config-workspace.js";
import { appendDecisionJournalRecord, findDecisionJournalRecord, } from "./decision-journal-store.js";
import { computeDecisionInputDigest, computeDecisionRecordId, computeFindingClassificationInputDigest, } from "../domain/decision-journal.js";
import { DECISION_TYPES, DCAND_010_SAFE_VALUE, findDecisionType, } from "../domain/decision-types.js";
import { resolveAuthorityDecision } from "../domain/decision-authority.js";
import { PROVIDER_AUTONOMOUS_CEILINGS } from "../domain/role.js";
import { resolveDcand001, resolveDcand002, resolveDcand003, resolveDcand004, resolveDcand005, resolveDcand008, } from "../domain/decision-resolvers.js";
import { isRecord } from "../types.js";
/** lightweight-tier（自己申告provider）の現在バージョン。 */
export const LIGHTWEIGHT_TIER_PROVIDER_VERSION = "lightweight-tier/v1";
/**
 * DCAND-009（reviewer選定）のPolicy Allowed部分（Issue #1485、round 2、DISC-004）。
 *
 * 設計正本「最終確定仕様」§1は候補集合を「Policy Allowed ∩ Configured/Dispatchable
 * ∩ Independence Eligible（すべてcompiled codeが算出）」と定める。**round 1の実装は
 * `--input.payload.candidateSet`を無検証で信頼しており、呼び出し側が任意の値を
 * 候補集合として宣言できたため、compiled codeが計算した安全な集合という前提が
 * 成立していなかった（独立reviewの指摘）。**
 *
 * この定数はPolicy Allowedだけを表す。`PROVIDER_AUTONOMOUS_CEILINGS`
 * （`src/domain/role.ts`）のうち`ollama`は補助的なdelegated review（Step 3/7/10の
 * 進行役委譲）専用であり、DCAND-009が選ぶ対象（Step 10の独立reviewer本体、
 * `01_開発ワークフロー.md`の「Codex Sol／Opus」）ではないため除く。
 *
 * **Configured/Dispatchable・Independence Eligibleを算出するcompiled codeは
 * 本Issueの時点で存在しない。** これらの絞り込みは実装せず、Policy Allowedとの
 * 積集合だけを強制する（disclosed residual gap。`docs/reviews/1485_レビュー.md`
 * round 2とPR本文へ明記する）。
 */
export const DCAND009_POLICY_ALLOWED_PROVIDERS = Object.keys(PROVIDER_AUTONOMOUS_CEILINGS).filter((provider) => provider !== "ollama");
function requiredString(value, label) {
    if (typeof value !== "string" || value === "")
        throw new Error(`decision invoke入力の${label}は空でない文字列が必要です`);
    return value;
}
const HEAD_SHA_PATTERN = /^[a-f0-9]{40}$/u;
function runDeterministicResolver(decisionTypeId, payload) {
    switch (decisionTypeId) {
        case "DCAND-001": {
            const result = resolveDcand001(payload);
            return {
                proposedValue: JSON.stringify(result),
                resolverOutput: result,
                adjudicationReason: `detectQuickDisqualifiers: ${result.length}件の失格分類`,
                deferToProvider: false,
            };
        }
        case "DCAND-002": {
            const result = resolveDcand002(payload);
            return {
                proposedValue: result.state,
                resolverOutput: result,
                adjudicationReason: `inspectCiDelivery.state=${result.state}`,
                deferToProvider: false,
            };
        }
        case "DCAND-003": {
            const result = resolveDcand003(payload);
            return {
                proposedValue: String(result),
                resolverOutput: result,
                adjudicationReason: `requiresSpecUpdate=${result}`,
                deferToProvider: false,
            };
        }
        case "DCAND-004": {
            const result = resolveDcand004(payload);
            return {
                proposedValue: result,
                resolverOutput: result,
                adjudicationReason: "auditRowDraftによる事前充填",
                deferToProvider: false,
            };
        }
        case "DCAND-005": {
            const result = resolveDcand005(payload);
            return {
                proposedValue: String(result),
                resolverOutput: result,
                adjudicationReason: `hasConcreteDecisionText=${result}`,
                deferToProvider: false,
            };
        }
        case "DCAND-008": {
            const result = resolveDcand008(payload);
            return {
                proposedValue: result.value,
                resolverOutput: result,
                adjudicationReason: result.value === "unknown"
                    ? "resolveDcand008は確定できず（checkの不在・過去HEAD通知・review待ちのみ）providerへ委譲する"
                    : `resolveDcand008が確定した: ${result.value}`,
                deferToProvider: result.value === "unknown",
            };
        }
        default:
            throw new Error(`未対応のdeterministic resolverです: ${decisionTypeId}`);
    }
}
export function invokeDecision(input) {
    const type = findDecisionType(input.decisionTypeId);
    if (type === undefined)
        throw new Error(`未知のdecision typeです: ${input.decisionTypeId}（利用可能: ${DECISION_TYPES.map((entry) => entry.id).join(", ")}）`);
    const staging = assertWorkflowStaging(input.staging);
    const activeRoot = stagingRepositoryRoot(staging);
    if (input.root !== activeRoot)
        throw new Error("decision invokeの--rootは--stagingが属するrepository rootと一致する必要があります");
    const workspace = resolveGitWorkspace(activeRoot);
    const jevResolution = resolveJevProviderConfig(activeRoot);
    const jevSummary = jevSummaryFor(jevResolution);
    if (!isRecord(input.input))
        throw new Error("decision invokeの--input fileはobjectが必要です");
    const raw = input.input;
    const candidateHeadSha = requiredString(raw.candidateHeadSha, "candidateHeadSha");
    if (!HEAD_SHA_PATTERN.test(candidateHeadSha))
        throw new Error("decision invokeのcandidateHeadShaは40桁16進数が必要です");
    const actualHeadSha = git(["rev-parse", "--verify", "HEAD^{commit}"], activeRoot, { env: GIT_ENV }).stdout.trim();
    if (actualHeadSha !== candidateHeadSha)
        throw new Error("decision invokeのcandidateHeadShaが実際のHEADと一致しません（自己申告SHAは受理しない）");
    const subjectRef = requiredString(raw.subjectRef, "subjectRef");
    let executor = type.executor;
    let authorityMode = type.authorityMode;
    let proposedValue;
    let resolverOutput;
    let baseReason;
    let providerModel = null;
    let providerVersion = null;
    // DCAND-006（finding分類記入）だけの特別扱い：inputDigestはStep 10 review
    // roundが自分のfindingから独立に再計算できるよう、raw全体ではなく
    // {subjectRef, path, evidence}だけへ絞る（`computeFindingClassificationInputDigest`、
    // `review-session.ts`の`verifyReviewRoundDecisionRefs`と共有する式。
    // Issue #1485、L-03）。
    let inputDigest;
    if (type.executor.kind === "deterministic") {
        const outcome = runDeterministicResolver(type.id, raw.payload);
        resolverOutput = outcome.resolverOutput;
        baseReason = outcome.adjudicationReason;
        if (!outcome.deferToProvider) {
            proposedValue = outcome.proposedValue;
            authorityMode = "authoritative";
        }
        else {
            // DCAND-008のunknown: providerへ委譲する。呼び出し側の提案が必要。
            executor = { kind: "provider", target: "lightweight-tier" };
            proposedValue = requiredString(raw.proposedValue, "proposedValue");
            providerModel = "lightweight-tier/self-serve";
            providerVersion = LIGHTWEIGHT_TIER_PROVIDER_VERSION;
        }
    }
    else {
        proposedValue = requiredString(raw.proposedValue, "proposedValue");
        resolverOutput = undefined;
        baseReason = `${type.id}: providerへ委譲した提案`;
        providerModel = "lightweight-tier/self-serve";
        providerVersion = LIGHTWEIGHT_TIER_PROVIDER_VERSION;
    }
    if (type.id === "DCAND-006") {
        if (!isRecord(raw.payload))
            throw new Error("DCAND-006の--input.payloadはobjectが必要です");
        inputDigest = computeFindingClassificationInputDigest({
            subjectRef,
            path: requiredString(raw.payload.path, "payload.path"),
            evidence: requiredString(raw.payload.evidence, "payload.evidence"),
        });
    }
    const confirmedByRaw = raw.confirmedBy;
    const confirmedBy = typeof confirmedByRaw === "string" && confirmedByRaw !== ""
        ? confirmedByRaw
        : undefined;
    let candidateSet;
    if (authorityMode === "constrained-choice") {
        if (!isRecord(raw.payload) || !Array.isArray(raw.payload.candidateSet))
            throw new Error("constrained-choiceのdecision typeには--input.payload.candidateSet（配列）が必要です");
        const declaredCandidateSet = raw.payload.candidateSet.map((entry, index) => requiredString(entry, `payload.candidateSet[${index}]`));
        if (type.id === "DCAND-009") {
            // Policy Allowedとの積集合だけを実効候補集合にする。呼び出し側の宣言を
            // そのまま信頼しない（round 1のgapの是正。上のDCAND009_POLICY_ALLOWED_PROVIDERS
            // のコメント参照）。
            proposedValue = proposedValue.normalize("NFC").toLowerCase();
            const normalizedDeclared = new Set(declaredCandidateSet.map((entry) => entry.normalize("NFC").toLowerCase()));
            candidateSet = DCAND009_POLICY_ALLOWED_PROVIDERS.filter((provider) => normalizedDeclared.has(provider));
            if (candidateSet.length === 0)
                throw new Error(`DCAND-009の候補集合がPolicy Allowed（${DCAND009_POLICY_ALLOWED_PROVIDERS.join("、")}）と重ならないため実行できません。--input.payload.candidateSetはPolicy Allowedの部分集合として宣言してください`);
        }
        else {
            candidateSet = declaredCandidateSet;
        }
    }
    const decision = resolveAuthorityDecision({
        authorityMode,
        proposedValue,
        confirmedBy,
        oneWaySafeValue: type.id === "DCAND-010" ? DCAND_010_SAFE_VALUE : undefined,
        candidateSet,
    });
    const now = (input.now ?? (() => new Date()))();
    const decidedAt = now.toISOString();
    const startedAtMs = now.getTime();
    if (inputDigest === undefined)
        inputDigest = computeDecisionInputDigest(raw);
    const decisionRecordId = computeDecisionRecordId({
        decisionTypeId: type.id,
        candidateHeadSha,
        inputDigest,
        decidedAt,
    });
    const latencyMs = Math.max(0, Date.now() - startedAtMs);
    const adjudicationReason = `${baseReason} / ${decision.reason}`;
    let applied = false;
    let appliedDecisionRecordId = null;
    if (input.apply && !decision.rejected) {
        const record = {
            decisionRecordId,
            decisionTypeId: type.id,
            inputDigest,
            subjectRef,
            candidateHeadSha,
            executor,
            providerModel,
            providerVersion,
            proposedValue,
            effectiveValue: decision.effectiveValue,
            authorityMode,
            adjudicationReason,
            latencyMs,
            cost: 0,
            decidedAt,
        };
        const existing = findDecisionJournalRecord(workspace.primaryRoot, staging, decisionRecordId);
        if (existing === undefined)
            appendDecisionJournalRecord(workspace.primaryRoot, staging, record);
        applied = true;
        appliedDecisionRecordId = decisionRecordId;
    }
    return {
        decisionTypeId: type.id,
        executor,
        authorityMode,
        candidateHeadSha,
        subjectRef,
        ...(candidateSet === undefined ? {} : { candidateSet }),
        proposedValue,
        effectiveValue: decision.effectiveValue,
        requiresConfirmation: decision.requiresConfirmation,
        rejected: decision.rejected,
        adjudicationReason,
        ...(resolverOutput === undefined ? {} : { resolverOutput }),
        workspace: {
            activeRoot: workspace.activeRoot,
            primaryRoot: workspace.primaryRoot,
        },
        jevProviderConfig: jevSummary,
        providerNote: executor.kind === "provider"
            ? "lightweight-tier（自己申告provider）で処理した。Jevへの実dispatchは#1486以降まで未実装（本呼び出しでは行わない）"
            : null,
        applied,
        decisionRecordId: appliedDecisionRecordId,
    };
}
/** 診断出力用。API key値そのものは含めない（`JevProviderConfig`自体が既に含まない）。 */
function jevSummaryFor(resolution) {
    if (resolution.state === "enabled")
        return {
            state: "enabled",
            source: resolution.source,
            endpoint: resolution.config.endpoint,
            model: resolution.config.model,
            apiKeyEnvVar: resolution.config.apiKeyEnvVar,
        };
    return resolution;
}
//# sourceMappingURL=decision-invoke.js.map