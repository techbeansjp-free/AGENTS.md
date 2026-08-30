import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  assertImmutablePullRequestBinding,
  bindPullRequest,
  canonicalDigest,
  claimMergeDispatch,
  claimPullRequestCreationDispatch,
  closingContractDigest,
  deliveryStateDigest,
  observeMerge,
  parseDeliveryState,
  prepareMergeIntent,
  preparePullRequestCreation,
  pullRequestContentDigest,
  pullRequestTerminalEvidenceId,
  recordStep11,
  renderDeliveryState,
  requireDeliveryReconciliation,
  type DeliveryCreateIntentInput,
  type DeliveryState,
  type MergeObservation,
} from "../../src/domain/delivery-state.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const REPOSITORY = "techbeansjp-free/agents.md";
const ISSUE = 1061;
const PR = 1234;
const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const H_IMPL_SHA = "f".repeat(40);
const MERGE_SHA = "c".repeat(40);
const JOURNAL_DIGEST = "d".repeat(64);
const REVIEW_ARTIFACT_DIGEST = "1".repeat(64);
const T0 = "2026-08-30T00:00:00.000Z";
const T1 = "2026-08-30T00:00:01.000Z";
const T2 = "2026-08-30T00:00:02.000Z";
const T3 = "2026-08-30T00:00:03.000Z";
const T4 = "2026-08-30T00:00:04.000Z";

function createIntent(): DeliveryCreateIntentInput {
  const issueUrl = `https://github.com/${REPOSITORY}/issues/${ISSUE}`;
  return {
    repository: REPOSITORY,
    issue: ISSUE,
    issueUrl,
    headRef: "codex/1061-delivery-state",
    headSha: HEAD_SHA,
    baseRef: "main",
    baseSha: BASE_SHA,
    pullRequestDigest: pullRequestContentDigest({
      title: "課題1061を修正する",
      body: `Closes #${ISSUE}`,
    }),
    bodyClosingDigest: closingContractDigest({
      canonicalIssue: ISSUE,
      canonicalIssueUrl: issueUrl,
      closingIssueNumbers: [ISSUE],
    }),
    preparedAt: T0,
  };
}

function createPrepared(): DeliveryState {
  return preparePullRequestCreation(createIntent());
}

function prBound(): DeliveryState {
  return bindPullRequest(createPrepared(), {
    number: PR,
    url: `https://github.com/${REPOSITORY}/pull/${PR}`,
    boundAt: T1,
  });
}

function mergePrepared(): DeliveryState {
  const reviewEvidence = {
    domain: "agent-skill-chain/merge-review-evidence/v1",
    repository: REPOSITORY,
    prNumber: PR,
    finalHeadSha: HEAD_SHA,
    implementationCommitSha: H_IMPL_SHA,
    reviewArtifactPath: "docs/reviews/90_review.md",
    reviewArtifactDigest: REVIEW_ARTIFACT_DIGEST,
    ciRunId: "42",
    reviewId: "7",
  };
  return prepareMergeIntent(prBound(), {
    method: "squash",
    authorizedHeadSha: HEAD_SHA,
    authorizedBaseRef: "main",
    authorizedBaseSha: BASE_SHA,
    trustedPolicyCommitSha: BASE_SHA,
    implementationCommitSha: H_IMPL_SHA,
    reviewArtifactPath: reviewEvidence.reviewArtifactPath,
    reviewArtifactDigest: reviewEvidence.reviewArtifactDigest,
    ciRunId: reviewEvidence.ciRunId,
    reviewId: reviewEvidence.reviewId,
    reviewEvidenceId: canonicalDigest(reviewEvidence),
    intentId: "e".repeat(32),
    preparedAt: T2,
  });
}

function observation(
  providerState: MergeObservation["providerState"] = "merged",
): Omit<MergeObservation, "observationId"> {
  const create = createIntent();
  return {
    repository: REPOSITORY,
    prNumber: PR,
    prUrl: `https://github.com/${REPOSITORY}/pull/${PR}`,
    headSha: HEAD_SHA,
    issue: ISSUE,
    issueUrl: create.issueUrl,
    bodyClosingDigest: create.bodyClosingDigest,
    providerState,
    providerRequest:
      providerState === "merge-requested"
        ? {
            kind: "auto-merge",
            requestedAt: T3,
            method: "squash",
            headSha: HEAD_SHA,
            baseSha: BASE_SHA,
          }
        : null,
    observedAt: T3,
    providerMergedAt: providerState === "merged" ? T3 : null,
    mergeCommitSha: providerState === "merged" ? MERGE_SHA : null,
  };
}

function mergeObserved(
  providerState: MergeObservation["providerState"] = "merged",
): DeliveryState {
  return observeMerge(mergePrepared(), observation(providerState));
}

const CHECKS: Readonly<Record<string, () => void>> = {
  "SCN-UNIT-DELSTATE-001": () => {
    const prepared = createPrepared();
    const bound = prBound();
    const merge = mergePrepared();
    const observed = mergeObserved();
    const recorded = recordStep11(observed, {
      outcome: "merged",
      recordedAt: T4,
      journalDigest: JOURNAL_DIGEST,
    });

    assert.deepEqual(
      [
        prepared.state,
        bound.state,
        merge.state,
        observed.state,
        recorded.state,
      ],
      [
        "create-prepared",
        "pr-bound",
        "merge-prepared",
        "merge-observed",
        "step11-recorded",
      ],
    );
    assert.deepEqual(
      [
        prepared.revision,
        bound.revision,
        merge.revision,
        observed.revision,
        recorded.revision,
      ],
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      parseDeliveryState(renderDeliveryState(recorded)),
      recorded,
    );
    assert.equal(deliveryStateDigest(recorded), deliveryStateDigest(recorded));

    const uppercaseObservation = observation();
    uppercaseObservation.repository = "TechBeansJP-Free/AGENTS.md";
    uppercaseObservation.prUrl = `https://github.com/TechBeansJP-Free/AGENTS.md/pull/${PR}`;
    uppercaseObservation.issueUrl = `https://github.com/TechBeansJP-Free/AGENTS.md/issues/${ISSUE}`;
    assert.deepEqual(
      observeMerge(mergePrepared(), uppercaseObservation).merge?.observation,
      observed.merge?.observation,
    );
  },
  "SCN-UNIT-DELSTATE-002": () => {
    const source = renderDeliveryState(createPrepared());
    assert.throws(
      () => parseDeliveryState(source.replace("{", '{"unexpected":true,')),
      /未知field/u,
    );
    assert.throws(
      () =>
        parseDeliveryState(
          source.replace('"create":{', '"create":{"unexpected":true,'),
        ),
      /未知field/u,
    );
  },
  "SCN-UNIT-DELSTATE-003": () => {
    const bound = prBound();
    const exact = {
      repository: REPOSITORY,
      issue: ISSUE,
      issueUrl: createIntent().issueUrl,
      prNumber: PR,
      prUrl: `https://github.com/${REPOSITORY}/pull/${PR}`,
      headSha: HEAD_SHA,
    };
    assert.doesNotThrow(() => assertImmutablePullRequestBinding(bound, exact));
    assert.throws(
      () =>
        assertImmutablePullRequestBinding(bound, {
          ...exact,
          headSha: "f".repeat(40),
        }),
      /変更できません/u,
    );
    assert.throws(
      () =>
        assertImmutablePullRequestBinding(bound, {
          ...exact,
          issue: ISSUE + 1,
        }),
      /変更できません/u,
    );
  },
  "SCN-UNIT-DELSTATE-004": () => {
    assert.throws(
      () =>
        prepareMergeIntent(createPrepared(), {
          method: "squash",
          authorizedHeadSha: HEAD_SHA,
          authorizedBaseRef: "main",
          authorizedBaseSha: BASE_SHA,
          trustedPolicyCommitSha: BASE_SHA,
          implementationCommitSha: H_IMPL_SHA,
          reviewArtifactPath: "docs/reviews/90_review.md",
          reviewArtifactDigest: REVIEW_ARTIFACT_DIGEST,
          ciRunId: "42",
          reviewId: "7",
          reviewEvidenceId: canonicalDigest({
            domain: "agent-skill-chain/merge-review-evidence/v1",
            repository: REPOSITORY,
            prNumber: PR,
            finalHeadSha: HEAD_SHA,
            implementationCommitSha: H_IMPL_SHA,
            reviewArtifactPath: "docs/reviews/90_review.md",
            reviewArtifactDigest: REVIEW_ARTIFACT_DIGEST,
            ciRunId: "42",
            reviewId: "7",
          }),
          intentId: "e".repeat(32),
          preparedAt: T2,
        }),
      /遷移できません/u,
    );
    assert.throws(
      () =>
        recordStep11(mergePrepared(), {
          outcome: "merged",
          recordedAt: T4,
          journalDigest: JOURNAL_DIGEST,
        }),
      /遷移できません/u,
    );
  },
  "SCN-UNIT-DELSTATE-005": () => {
    const original = observation();
    for (const changed of [
      { ...original, prNumber: PR + 1 },
      { ...original, issue: ISSUE + 1 },
      { ...original, headSha: "f".repeat(40) },
      { ...original, bodyClosingDigest: "0".repeat(64) },
    ]) {
      assert.throws(
        () => observeMerge(mergePrepared(), changed),
        /固定済みPR bindingと一致しません/u,
      );
    }
  },
  "SCN-UNIT-DELSTATE-006": () => {
    const source = renderDeliveryState(mergeObserved());
    const tampered = source.replace(
      /"observationId":"[a-f0-9]{64}"/u,
      `"observationId":"${canonicalDigest("tampered")}"`,
    );
    assert.notEqual(tampered, source);
    assert.throws(
      () => parseDeliveryState(tampered),
      /観測内容と一致しません/u,
    );
  },
  "SCN-UNIT-DELSTATE-007": () => {
    const createUncertain = requireDeliveryReconciliation(createPrepared(), {
      phase: "create",
      reason: "providerのcreate応答を永続化する前に停止した",
      enteredAt: T1,
    });
    assert.equal(createUncertain.state, "reconciliation-required");
    assert.equal(
      bindPullRequest(createUncertain, {
        number: PR,
        url: `https://github.com/${REPOSITORY}/pull/${PR}`,
        boundAt: T1,
      }).state,
      "pr-bound",
    );

    const mergeUncertain = requireDeliveryReconciliation(mergePrepared(), {
      phase: "merge",
      reason: "merge副作用後のread-backが完了していない",
      enteredAt: T3,
    });
    assert.equal(mergeUncertain.state, "reconciliation-required");
    assert.equal(
      observeMerge(mergeUncertain, observation()).state,
      "merge-observed",
    );
  },
  "SCN-UNIT-DELSTATE-008": () => {
    assert.throws(
      () =>
        recordStep11(mergeObserved("merge-requested"), {
          outcome: "merged",
          recordedAt: T4,
          journalDigest: JOURNAL_DIGEST,
        }),
      /merged状態が必要/u,
    );
  },
  "SCN-UNIT-DELSTATE-009": () => {
    const create = createIntent();
    for (const invalid of [
      { ...create, repository: "owner/../repository" },
      { ...create, headSha: "A".repeat(40) },
      { ...create, preparedAt: "2026-08-30T09:00:00+09:00" },
      {
        ...create,
        issueUrl: `https://github.com/${REPOSITORY}/issues/${ISSUE + 1}`,
      },
    ]) {
      assert.throws(() => preparePullRequestCreation(invalid));
    }
    assert.throws(
      () =>
        bindPullRequest(createPrepared(), {
          number: PR,
          url: `https://github.com/${REPOSITORY}/pull/${PR + 1}`,
          boundAt: T1,
        }),
      /固定identity/u,
    );
    assert.throws(() =>
      closingContractDigest({
        canonicalIssue: ISSUE,
        canonicalIssueUrl: `https://github.com/${REPOSITORY}/issues/${ISSUE + 1}`,
        closingIssueNumbers: [ISSUE],
      }),
    );
  },
  "SCN-UNIT-DELSTATE-010": () => {
    const bound = prBound();
    const recorded = recordStep11(bound, {
      outcome: "pull-request",
      recordedAt: T2,
      journalDigest: JOURNAL_DIGEST,
    });

    assert.equal(recorded.state, "step11-recorded");
    assert.equal(recorded.revision, bound.revision + 1);
    assert.equal(recorded.merge, null);
    assert.equal(recorded.step11?.outcome, "pull-request");
    assert.equal(
      recorded.step11?.evidenceId,
      pullRequestTerminalEvidenceId(recorded.create, recorded.pr!),
    );
    assert.deepEqual(
      parseDeliveryState(renderDeliveryState(recorded)),
      recorded,
    );
  },
  "SCN-UNIT-DELSTATE-011": () => {
    assert.throws(
      () =>
        recordStep11(prBound(), {
          outcome: "merged",
          recordedAt: T4,
          journalDigest: JOURNAL_DIGEST,
        }),
      /pr-boundからstep11-recordedへ遷移できません/u,
    );
    assert.throws(
      () =>
        recordStep11(mergeObserved(), {
          outcome: "pull-request",
          recordedAt: T4,
          journalDigest: JOURNAL_DIGEST,
        }),
      /merge-observedからstep11-recordedへ遷移できません/u,
    );

    const merged = recordStep11(mergeObserved(), {
      outcome: "merged",
      recordedAt: T4,
      journalDigest: JOURNAL_DIGEST,
    });
    const mismatched: DeliveryState = {
      ...merged,
      step11: {
        ...merged.step11!,
        outcome: "pull-request",
        evidenceId: pullRequestTerminalEvidenceId(merged.create, merged.pr!),
      },
    };
    assert.throws(
      () => parseDeliveryState(JSON.stringify(mismatched)),
      /PR停止終端ではmergeがnull/u,
    );
  },
  "SCN-UNIT-DELSTATE-012": () => {
    const source = renderDeliveryState(
      recordStep11(prBound(), {
        outcome: "pull-request",
        recordedAt: T2,
        journalDigest: JOURNAL_DIGEST,
      }),
    );
    const tampered = source.replace(
      /"evidenceId":"[a-f0-9]{64}"/u,
      `"evidenceId":"${canonicalDigest("tampered-pr-terminal")}"`,
    );
    assert.notEqual(tampered, source);
    assert.throws(
      () => parseDeliveryState(tampered),
      /step11\.evidenceIdが終端Evidenceと一致しません/u,
    );
  },
  "SCN-UNIT-DELSTATE-013": () => {
    const claimed = claimPullRequestCreationDispatch(createPrepared(), T1);
    assert.equal(claimed.create.dispatchClaimedAt, T1);
    assert.equal(claimed.revision, 2);
    assert.throws(
      () => claimPullRequestCreationDispatch(claimed, T2),
      /既に消費/u,
    );
    assert.throws(
      () =>
        claimPullRequestCreationDispatch(
          createPrepared(),
          "2025-01-01T00:00:00.000Z",
        ),
      /先行event/u,
    );
    assert.deepEqual(parseDeliveryState(renderDeliveryState(claimed)), claimed);
  },
  "SCN-UNIT-DELSTATE-014": () => {
    const claimed = claimMergeDispatch(mergePrepared(), T3);
    assert.equal(claimed.merge?.dispatchClaimedAt, T3);
    assert.equal(claimed.revision, 4);
    assert.throws(() => claimMergeDispatch(claimed, T4), /既に消費/u);
    assert.throws(() => claimMergeDispatch(mergePrepared(), T1), /先行event/u);
    assert.deepEqual(parseDeliveryState(renderDeliveryState(claimed)), claimed);
  },
};

Given("delivery state単体検査の準備がある", function () {
  this.validationOutcome = undefined;
});

When("{string}のdelivery state単体検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  assert.ok(check, `未知のdelivery state単体検査です: ${scenario}`);
  check();
  this.validationOutcome = { valid: true };
});

Then("delivery state単体検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
