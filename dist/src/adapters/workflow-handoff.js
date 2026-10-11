import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { git } from "../lib/process.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { readStoredStagingRecord } from "../domain/staging.js";
import { PLAN_SEAL_ARTIFACTS, PLAN_AMENDMENT_FILE, } from "../domain/plan-seal.js";
import { MODE_DECISION_FILE, STEP_JOURNAL_FILE, WORKFLOW_STEPS, WORKFLOW_EXACT_ARTIFACTS, } from "../domain/workflow.js";
import { readStoredReviewSession, REVIEW_SESSION_FILE, } from "./review-session-store.js";
import { GIT_ENV, evidenceOnlySuffix } from "./review-diff.js";
import { effectiveReviewBlocking, pendingReviewFindingIds, isReviewSessionConverged, } from "../domain/review-convergence.js";
const ROLES = {
    1: "request",
    2: "requirements",
    3: "readiness-reviewer",
    5: "design",
    6: "planning",
    7: "readiness-reviewer",
    9: "implementation",
};
const STEP_SKILLS = [
    "stage",
    "request",
    "requirements",
    "requirements-review",
    "issue-sync",
    "design",
    "plan",
    "design-review",
    "design-sync",
    "implement",
    "review",
    "pr",
];
/** Pointers only: no artifact bodies or new authority. Paths are relative to their owner. */
function handoffReads(staging, step, mode, role, reviewRound) {
    if (step === undefined || STEP_SKILLS[step] === undefined)
        return undefined;
    const skillStep = role === "correction" ? 9 : step;
    const plans = mode === undefined ? [] : PLAN_SEAL_ARTIFACTS[mode];
    const inputs = step === 1
        ? [MODE_DECISION_FILE, "00_要求定義.md"]
        : step < 9
            ? plans.slice(0, step <= 2 ? 1 : step <= 5 ? 2 : step === 6 ? 3 : 4)
            : role === "correction" || (step === 10 && (reviewRound ?? 1) > 1)
                ? [REVIEW_SESSION_FILE]
                : [...plans, PLAN_AMENDMENT_FILE];
    const amendmentPresent = fs
        .lstatSync(path.join(staging, PLAN_AMENDMENT_FILE), {
        throwIfNoEntry: false,
    })
        ?.isFile() ?? false;
    return {
        skill: `.agent-skill-chain/skills/step-${String(skillStep).padStart(2, "0")}-${STEP_SKILLS[skillStep]}/SKILL.md`,
        staging: inputs.filter((file) => file !== PLAN_AMENDMENT_FILE || amendmentPresent),
        optionalStaging: inputs.includes(PLAN_AMENDMENT_FILE)
            ? [{ path: PLAN_AMENDMENT_FILE, present: amendmentPresent }]
            : [],
    };
}
/** A machine-readable task boundary, never evidence that its conditions hold. */
export function workflowExecutionContract(step, role, read, mode) {
    const semantic = {
        1: "要求の範囲・完了条件を判断する",
        2: "要求を受け入れ条件とドメイン規則へ具体化する",
        3: "独立した反例探索で要求・要件の開始可能性を判断する",
        5: "依存・失敗・安全性を設計する",
        6: "実装順序とrisk比例検証を選ぶ",
        7: "独立した反例探索で実装開始可能性を判断する",
        9: "封印済み計画に従い実装と検証を行う",
        10: role === "correction"
            ? "記録済みfindingの成立根拠を確認して是正する"
            : "実装・仕様・検証の意味を独立reviewする",
    };
    const cli = step === 4 ||
        step === 8 ||
        step === 11 ||
        (step === 10 && role === "coordinator");
    const executor = cli
        ? "cli"
        : step !== undefined && semantic[step] !== undefined
            ? "fresh-worker"
            : "none";
    const operations = [];
    if (step === 4 || step === 8) {
        operations.push({
            operation: "preview-sync",
            argv: ["workflow", "advance", "--dry-run"],
            requiredFlags: ["staging", "repo", "issue"],
            mode: "read",
        });
        operations.push({
            operation: "sync-checkpoint",
            argv: ["workflow", "advance", "--apply", "--prepare-next"],
            requiredFlags: [
                "staging",
                "repo",
                "issue",
                "authorize",
                "expected-body-sha256",
            ],
            inputBindings: {
                "expected-body-sha256": "preview-sync.sync.bodySha256",
                authorize: "existing human/policy authorization; never generated",
            },
            mode: "gated-apply",
        });
    }
    else if (step === 11) {
        operations.push({
            operation: "preview-reviewed-summary",
            argv: ["pr", "create", "--dry-run"],
            requiredFlags: ["staging", "issue", "repo", "from-summary"],
            mode: "read",
        });
        operations.push({
            operation: "deliver-reviewed-summary",
            argv: ["pr", "create", "--apply"],
            requiredFlags: ["staging", "issue", "repo", "from-summary", "authorize"],
            inputBindings: {
                authorize: "existing human/policy authorization; never generated",
            },
            mode: "gated-apply",
        });
    }
    else if (executor === "fresh-worker") {
        operations.push({
            operation: role === "reviewer" || role === "readiness-reviewer"
                ? "review-referenced-artifacts"
                : "complete-scoped-artifacts",
            argv: [],
            requiredFlags: [],
            mode: role === "reviewer" || role === "readiness-reviewer"
                ? "read"
                : "artifact-write",
        });
        if (step === 9 || step === 10)
            operations.push({
                operation: "observe-verification",
                when: "required-command-unknown",
                argv: ["verify", "plan"],
                requiredFlags: ["staging"],
                mode: "read",
            });
        if (step === 9 || step === 10)
            operations.push({
                operation: "run-required-verification",
                argv: ["verify", "run", "--reuse"],
                requiredFlags: ["staging", "scope"],
                requiredTrailingArgv: "known formally required trusted command after --; if unknown use verify plan.required[].command",
                mode: "gated-apply",
            });
        if (step !== undefined && [2, 3, 6, 7].includes(step))
            operations.push({
                operation: "validate-artifact",
                argv: [
                    "issue",
                    "validate",
                    `--stage=${step <= 3 ? "requirements" : "design"}`,
                ],
                requiredFlags: ["path"],
                mode: "read",
            });
    }
    const requiredInputs = read === undefined
        ? []
        : [
            { owner: "package", path: read.skill, required: true },
            ...read.staging.map((file) => ({
                owner: "staging",
                path: file,
                required: true,
            })),
            ...read.optionalStaging
                .filter((file) => !file.present)
                .map((file) => ({
                owner: "staging",
                path: file.path,
                required: false,
            })),
        ];
    if (step !== undefined && step >= 9)
        requiredInputs.push({ owner: "git", path: "HEAD", required: true });
    if (step === 11)
        requiredInputs.push({ owner: "git", path: "H_impl:--from-summary", required: true }, {
            owner: "git",
            path: "HEAD:docs/reviews/<issue>_review.json",
            required: true,
        });
    const proofKinds = {
        1: mode === "quick" || mode === "poc"
            ? ["Intent", "Contract", "Design", "Verification"]
            : ["Intent", "Contract"],
        2: ["Contract"],
        3: ["Intent", "Contract", "Review"],
        4: ["Contract"],
        5: ["Design"],
        6: ["Design", "Verification"],
        7: ["Design", "Verification", "Review"],
        8: ["Design"],
        9: ["Implementation", "Verification"],
        10: ["Verification", "Review"],
        11: ["Delivery"],
    };
    const questions = {
        Intent: "要求の目的・対象外・完了条件が正式要求に一致するか",
        Contract: "受け入れ条件と不変条件が明示され、上流の目的を保持するか",
        Design: "既存設計の適用可能性を根拠で示し、依存・失敗・安全性と不変条件を保つか",
        Implementation: "差分が承認済み計画・AC・不変条件を具体化し、未知の依存を残していないか",
        Verification: "選択したテストがAC・不変条件・riskに対して十分か",
        Review: "独立した反例探索で仕様適合・安全性・正しさを確認したか",
        Delivery: "既存policy権限・exact HEAD・正式Evidence・終端条件を満たすか",
    };
    const proofObligations = (step === undefined ? [] : (proofKinds[step] ?? [])).map((kind) => ({
        kind,
        judgedBy: cli
            ? "cli"
            : role === "reviewer" || role === "readiness-reviewer"
                ? "independent-reviewer"
                : "worker",
        sourceRefs: ["requiredInputs"],
        question: cli
            ? "正式入力と保存済みEvidenceを既存gateで照合する。意味判断を生成しない"
            : kind === "Design" && step !== undefined && [5, 6, 7].includes(step)
                ? `${questions[kind]}。仕様影響がupdatedなら提出時のtrace.requirementsの要件IDはGit上のdocs/specs/02_要件/に存在する必要がある。既存の要件IDで足りるなら参照し、足りない場合だけ設計・計画の許可pathと仕様更新taskにdocs/specs/02_要件/を含める。開始前に独立確認する。no-spec-impactはdocs/specs/の変更と両立しない。分類の意味的妥当性はAIが判断する`
                : questions[kind],
    }));
    if (step === 11)
        proofObligations.push({
            kind: "Delivery",
            judgedBy: "human-policy",
            sourceRefs: ["project:trusted delivery policy"],
            question: "既存の人間・policy authorityが外部変更を許可するか",
        });
    const completion = [];
    if (step !== undefined && [1, 2, 3, 5, 6, 7, 9].includes(step)) {
        completion.push({
            argv: ["workflow", "advance", "--apply", "--prepare-next"],
            requiredFlags: ["staging", "artifact", "evidence"],
            inputBindings: {
                artifact: WORKFLOW_EXACT_ARTIFACTS[step]
                    ? "action.recordArtifactsのみ。requiredInputs/read.stagingは参照であり正式artifactに含めない"
                    : "worker handback formal artifact paths",
                evidence: "worker handback observed evidence references; not approval",
            },
            when: "worker-complete-and-terminal",
        });
        if (step === 9)
            completion.push({
                argv: ["workflow", "advance", "--plan"],
                requiredFlags: ["staging", "continue-from"],
                inputBindings: {
                    "continue-from": "executionPlan.headSha at work-unit entry",
                },
                when: "worker-checkpoint-and-terminal",
            });
    }
    else if (step === 10 && role === "correction") {
        completion.push({
            argv: ["workflow", "record", "--step=9"],
            requiredFlags: ["staging", "artifact", "evidence"],
            inputBindings: {
                artifact: "correction handback committed artifact paths",
                evidence: "correction handback observed verification and finding references",
            },
            when: "correction-complete-and-terminal",
        });
    }
    else if (step === 10 && role === "reviewer") {
        completion.push({
            argv: ["review", "round", "--apply"],
            requiredFlags: ["staging", "file"],
            inputBindings: {
                file: "independent reviewer handback completed review round --init assignment",
            },
            when: "independent-reviewer-complete-and-terminal",
        });
    }
    else if (step === 10 && role === "coordinator") {
        completion.push({
            argv: ["review", "export"],
            requiredFlags: ["staging", "issue", "reviewer", "implementer"],
            inputBindings: {
                reviewer: "completed independent reviewer label; not authority",
                implementer: "implementation worker label; not authority",
            },
            when: "converged-session-at-H_impl-and-required-verification",
        });
        completion.push({
            argv: ["git", "add", "--"],
            requiredFlags: [],
            requiredTrailingArgv: "review export.path",
            inputBindings: { path: "review export.path" },
            when: "review-export-succeeded",
        });
        completion.push({
            argv: ["git", "commit", "--only"],
            requiredFlags: ["message"],
            requiredTrailingArgv: "-- review export.path",
            inputBindings: {
                path: "review export.path (only this file)",
                message: "review evidence commit message",
            },
            when: "exported-artifact-staged",
        });
        completion.push({
            argv: ["workflow", "record", "--step=10"],
            requiredFlags: [
                "staging",
                "artifact",
                "evidence",
                "review-session-digest",
            ],
            inputBindings: {
                artifact: "review export.path",
                evidence: "formal export and verification record references",
                "review-session-digest": "review export.latestRoundDigest",
            },
            when: "artifact-only-final-commit-observed",
        });
    }
    if (step === 10 && completion.length > 0)
        completion.push({
            argv: ["workflow", "advance", "--plan"],
            requiredFlags: ["staging"],
            inputBindings: {},
            when: "completion-operation-succeeded",
        });
    return {
        executor,
        purpose: step === undefined
            ? "完了状態を確認する"
            : (WORKFLOW_STEPS.find((entry) => entry.step === step)
                ?.responsibility ?? "不明な状態で停止する"),
        semanticReason: executor === "fresh-worker"
            ? semantic[step]
            : cli
                ? "意味判断済みの正式入力を既存CLI gateで処理する"
                : "実行可能な工程が特定されていない",
        allowedOperations: operations,
        ...(step !== undefined && WORKFLOW_EXACT_ARTIFACTS[step]
            ? { recordArtifacts: WORKFLOW_EXACT_ARTIFACTS[step] }
            : {}),
        requiredInputs,
        preconditions: executor === "none"
            ? []
            : [
                {
                    id: "boundary-current",
                    observedBy: "workflow advance --plan",
                    expected: "作業開始前のHEAD・journal/review digest・workUnitIdが受領契約と一致",
                },
            ],
        completionConditions: executor === "none"
            ? []
            : [
                {
                    id: "formal-gate",
                    observedBy: step === 11
                        ? "pr create / delivery status"
                        : step === 10
                            ? "review session / workflow record --step=10"
                            : "workflow advance --apply",
                    expected: "終了時の結果HEADと正式artifact/evidenceを既存gateが再観測し、Step9等のbindingを導出してcoordinatorが対象1工程を記録。開始HEADの維持やadvisory・自己申告を代用しない",
                },
                {
                    id: "terminal",
                    observedBy: "coordinator",
                    expected: "返却後終了。次semantic work unitへ同じcontextで継続しない",
                },
            ],
        proofObligations,
        ...(completion.length === 0
            ? {}
            : {
                coordinatorCompletion: {
                    owner: "coordinator",
                    gateReobservationRequired: true,
                    operations: completion,
                },
            }),
        machineChecks: step === 9 || step === 10
            ? [
                {
                    observedBy: "cli",
                    commands: ["verify run", "review export"],
                    facts: ["HEAD", "scope", "trusted-command", "result"],
                    selfDeclarationAccepted: false,
                },
            ]
            : [],
        unconfirmed: executor === "none"
            ? []
            : proofObligations.map((item) => `${item.kind}:${item.judgedBy}:formal-evidence-required`),
        scopeExpansionTriggers: executor === "fresh-worker"
            ? [
                "unknown-dependency",
                "invariant-conflict",
                "verification-failure",
                "unresolved-review-finding",
            ]
            : [],
        maxTransitions: 1,
    };
}
/** CLI-only pre-review work. It records verification, never a review or Step 10. */
export function workflowVerificationContract(input) {
    const base = workflowExecutionContract(10, "coordinator", undefined);
    const contract = { ...base };
    delete contract.coordinatorCompletion;
    return {
        ...contract,
        purpose: "独立review前の正式検証を完了する",
        semanticReason: "既存verify gateが現在HEADの必要検証を導出したためCLIで実行する",
        allowedOperations: [
            {
                operation: "observe-verification",
                argv: ["verify", "plan"],
                requiredFlags: ["staging"],
                mode: "read",
            },
            ...input.required.map((item) => ({
                operation: "run-required-verification",
                argv: ["verify", "run", "--reuse"],
                requiredFlags: ["staging", "scope"],
                requiredTrailingArgv: JSON.stringify(item.command),
                inputBindings: {
                    scope: item.scope,
                    command: "同じHEADのverify plan.requiredで再照合したargv。shell文字列へ変換しない",
                },
                mode: "gated-apply",
            })),
            {
                operation: "reobserve-work",
                argv: ["workflow", "advance", "--plan"],
                requiredFlags: ["staging"],
                mode: "read",
            },
        ],
        requiredInputs: [
            { owner: "git", path: "HEAD", required: true },
            {
                owner: "staging",
                path: "journal/verification-runs.jsonl",
                required: false,
            },
        ],
        preconditions: [
            ...base.preconditions,
            {
                id: "verification-plan-current",
                observedBy: "verify plan",
                expected: `HEAD=${input.headSha}、impact=${input.impactDigest}とtrusted policyの必要commandが一致`,
            },
        ],
        completionConditions: [
            {
                id: "verification-observed",
                observedBy: "verify plan",
                expected: "現在HEAD・impact・trusted policyに有効な正式成功記録を再観測する",
            },
            {
                id: "replan-before-review",
                observedBy: "workflow advance --plan",
                expected: "Step 10を記録せず、次の独立review作業を再選択する",
            },
        ],
        proofObligations: [
            {
                kind: "Verification",
                judgedBy: "cli",
                sourceRefs: ["verify plan.required", "journal/verification-runs.jsonl"],
                question: "現在HEADの必要検証がtrusted policyどおり正式に成功したか",
            },
        ],
        machineChecks: [
            {
                observedBy: "cli",
                commands: ["verify plan", "verify run --reuse"],
                facts: ["HEAD", "impact", "trusted-command", "result"],
                selfDeclarationAccepted: false,
            },
        ],
        unconfirmed: ["Verification:cli:formal-evidence-required"],
        scopeExpansionTriggers: [],
    };
}
/** Optional execution advice; never an approval or a substitute for workflow gates. */
export function observeWorkflowHandoff(staging, step, resume, continuationFromHead) {
    if ((process.env.ASC_EXECUTION_CONTEXT_MODE ?? "short-lived") !== "short-lived")
        return undefined;
    if (resume.errors.length > 0 || resume.headSha === null)
        return { state: "blocked", errors: resume.errors };
    try {
        const worktree = stagingRepositoryRoot(staging);
        const session = readStoredReviewSession(staging);
        let role = step === undefined ? "coordinator" : (ROLES[step] ?? "coordinator");
        let reviewRound = null;
        let findingIds = [];
        if (step === 10) {
            const sameHead = session?.latestCandidateHeadSha === resume.headSha;
            role =
                session !== null &&
                    isReviewSessionConverged(session) &&
                    (sameHead ||
                        evidenceOnlySuffix(worktree, session.latestCandidateHeadSha, resume.headSha) !== undefined)
                    ? "coordinator"
                    : sameHead &&
                        session?.status === "active" &&
                        pendingReviewFindingIds(session).length === 0
                        ? "correction"
                        : "reviewer";
            reviewRound =
                (session?.rounds.length ?? 0) + (role === "reviewer" ? 1 : 0);
            findingIds = session ? effectiveReviewBlocking(session) : [];
        }
        const hash = (relative) => {
            const file = path.join(staging, relative);
            if (!fs.existsSync(file))
                return null;
            const stat = fs.lstatSync(file);
            if (!stat.isFile() ||
                stat.isSymbolicLink() ||
                stat.nlink !== 1 ||
                stat.size > 2 * 1024 * 1024)
                throw new Error("handoff stateは2MiB以下の通常fileが必要です");
            return crypto
                .createHash("sha256")
                .update(fs.readFileSync(file))
                .digest("hex");
        };
        const boundary = {
            stepsSha256: hash(STEP_JOURNAL_FILE),
            reviewSha256: hash(REVIEW_SESSION_FILE),
        };
        const workUnitId = crypto
            .createHash("sha256")
            .update(JSON.stringify({
            staging,
            headSha: resume.headSha,
            step: step ?? null,
            role,
            reviewRound,
            boundary,
            continuationFromHead: continuationFromHead ?? null,
        }))
            .digest("hex");
        const record = readStoredStagingRecord(staging);
        const read = handoffReads(staging, step, record?.mode, role, reviewRound);
        return {
            kind: "asc-handoff/v1",
            authority: "advisory",
            issue: record?.tracker ?? null,
            read,
            branch: git(["symbolic-ref", "--short", "HEAD"], worktree, {
                env: GIT_ENV,
            }).stdout.trim(),
            worktree,
            staging,
            headSha: resume.headSha,
            step: step ?? null,
            role,
            reviewSessionId: session?.sessionId ?? null,
            reviewRound,
            findingIds,
            boundary,
            continuationFromHead: continuationFromHead ?? null,
            workUnit: {
                workUnitId,
                freshContextRequired: true,
                terminalAfterHandback: true,
                reuseForbidden: true,
                contract: workflowExecutionContract(step, role, read, record?.mode),
            },
            resume: { command: "workflow advance", staging },
        };
    }
    catch (error) {
        return {
            state: "blocked",
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}
/** Existing correction/reviewer choice, with an independent role and contract. */
export function workflowReviewerAlternative(handoff) {
    if (!handoff ||
        !("kind" in handoff) ||
        !handoff.workUnit ||
        handoff.role !== "correction")
        return undefined;
    const read = {
        skill: ".agent-skill-chain/skills/step-10-review/SKILL.md",
        staging: [REVIEW_SESSION_FILE],
        optionalStaging: [],
    };
    return {
        ...handoff,
        role: "reviewer",
        read,
        reviewRound: (handoff.reviewRound ?? 0) + 1,
        workUnit: {
            ...handoff.workUnit,
            workUnitId: crypto
                .createHash("sha256")
                .update(JSON.stringify({
                from: handoff.workUnit.workUnitId,
                role: "reviewer",
                reviewRound: (handoff.reviewRound ?? 0) + 1,
            }))
                .digest("hex"),
            contract: workflowExecutionContract(10, "reviewer", read),
        },
    };
}
/** One-shot pointer; the worker re-observes the full contract at the same boundary. */
export function workflowAgentDispatch(handoff) {
    if (!handoff ||
        !("kind" in handoff) ||
        !handoff.workUnit ||
        handoff.role === "coordinator")
        return undefined;
    return {
        subagent_type: "general-purpose",
        description: `ASC Step ${handoff.step} ${handoff.role} ${handoff.workUnit.workUnitId.slice(0, 12)}`,
        prompt: JSON.stringify({
            handoff: {
                kind: handoff.kind,
                worktree: handoff.worktree,
                staging: handoff.staging,
                headSha: handoff.headSha,
                step: handoff.step,
                role: handoff.role,
                boundary: handoff.boundary,
                continuationFromHead: handoff.continuationFromHead,
                workUnit: {
                    workUnitId: handoff.workUnit.workUnitId,
                    freshContextRequired: handoff.workUnit.freshContextRequired,
                    terminalAfterHandback: handoff.workUnit.terminalAfterHandback,
                    reuseForbidden: handoff.workUnit.reuseForbidden,
                },
            },
            prompt: "指定workUnitId専用のfresh one-shot workerです。worktreeでworkflow advance --plan --staging=<staging>を観測する。continuationFromHeadがあれば同値の--continue-fromも付ける。plan.handoffまたはplan.alternatives[].handoffから同じrole・workUnitIdの候補がちょうど1件の場合だけ選び、HEAD・boundaryも照合。0件・複数件・不一致なら再dispatchを要求。同じ状態の--planを出力分割だけのため再実行せず、一度の観測から担当候補とactionを読む。照合後、primaryならplan.action、alternativeなら対応するalternatives[i].actionを正式契約として読み、handoff.read.skill・read.stagingと未充足責務の必要節を確認する。契約読込後もHEADを再確認し、担当だけを完了する。Skillの契約と独立検証を維持。action.recordArtifactsがある場合、正式返却artifactはその集合だけとしrequiredInputs/read.stagingを混ぜない。workUnitId/status/HEAD/検証記録ID/blocker/nextのcompact JSONを返す。詳細はGit/staging/finding、Step/round記録はcoordinator。返却後terminal、追加作業にはASC_REDISPATCH_REQUIRED。",
        }),
    };
}
//# sourceMappingURL=workflow-handoff.js.map