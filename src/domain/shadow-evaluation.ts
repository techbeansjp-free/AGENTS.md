import crypto from "node:crypto";
import type { DecisionJournalRecord } from "./decision-journal.js";
import type { EvaluationLabel } from "./evaluation-label.js";
import type { JevShadowRecord } from "./jev-shadow.js";

export interface EvaluationDiagnostic {
  code: string;
  stagingId: string;
  source?: string;
  line?: number;
}
export interface EvaluationInput {
  staging: string;
  decisions: DecisionJournalRecord[];
  shadows: JevShadowRecord[];
  labels: EvaluationLabel[];
  unavailable: boolean;
  diagnostics: EvaluationDiagnostic[];
  invalidKeys?: readonly string[];
}
export const MIN_EVALUATION_SAMPLES = 20;
export function evaluationId(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function evaluationClasses(type: string): readonly string[] {
  switch (type) {
    case "DCAND-008":
      return ["confirmed-limited", "no-limit-evidence", "unknown"];
    case "DCAND-009":
      return ["claude", "codex"];
    case "DCAND-010":
      return ["minor", "not-minor"];
    default:
      return [];
  }
}
function observations(values: readonly number[], missing: number) {
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    missing,
    sum: values.length ? sum : null,
    mean: values.length ? sum / values.length : null,
  };
}
interface Pair {
  primary: string;
  jev: string;
  reference: string;
  confidence: number | null;
}
interface Bucket {
  type: string;
  primaryModel: string | null;
  requestedModel: string;
  resolvedModel: string | null;
  pairs: Pair[];
  shadows: JevShadowRecord[];
}
function accuracy(
  pairs: readonly Pair[],
  who: "primary" | "jev",
  classes: readonly string[],
) {
  const enough = pairs.length >= MIN_EVALUATION_SAMPLES;
  return {
    accuracy: enough
      ? pairs.filter((p) => p[who] === p.reference).length / pairs.length
      : null,
    classes: classes.map((value) => {
      const tp = pairs.filter(
        (p) => p[who] === value && p.reference === value,
      ).length;
      const fp = pairs.filter(
        (p) => p[who] === value && p.reference !== value,
      ).length;
      const fn = pairs.filter(
        (p) => p[who] !== value && p.reference === value,
      ).length;
      return {
        value,
        tp,
        fp,
        fn,
        precision: enough && tp + fp > 0 ? tp / (tp + fp) : null,
        recall: enough && tp + fn > 0 ? tp / (tp + fn) : null,
      };
    }),
  };
}
function summarize(shadows: readonly JevShadowRecord[]) {
  const ok = shadows.filter((s) => s.outcomeKind === "ok");
  const failed = shadows.filter((s) => s.outcomeKind !== "ok");
  return {
    successful: ok.length,
    failed: failed.length,
    latencyMs: observations(
      shadows.map((s) => s.latencyMs),
      0,
    ),
    successfulLatencyMs: observations(
      ok.map((s) => s.latencyMs),
      0,
    ),
    failedLatencyMs: observations(
      failed.map((s) => s.latencyMs),
      0,
    ),
    inputTokens: observations(
      ok.map((s) => s.inputTokens),
      failed.length,
    ),
    outputTokens: observations(
      ok.map((s) => s.outputTokens),
      failed.length,
    ),
  };
}
/** 同じstaging内だけで一意照合し、authorityから独立した評価値を返す。 */
export function evaluateShadowRecords(inputs: readonly EvaluationInput[]) {
  const diagnostics: EvaluationDiagnostic[] = [];
  const buckets = new Map<string, Bucket>();
  const all: JevShadowRecord[] = [];
  let decisions = 0,
    shadows = 0,
    labels = 0,
    joined = 0,
    labeled = 0,
    compared = 0,
    excluded = 0;
  const targets = [];
  for (const input of [...inputs].sort((a, b) =>
    a.staging.localeCompare(b.staging),
  )) {
    const stagingId = evaluationId(input.staging);
    targets.push({
      stagingId,
      status: input.unavailable ? "unavailable" : "available",
    });
    diagnostics.push(...input.diagnostics);
    decisions += input.decisions.length;
    shadows += input.shadows.length;
    labels += input.labels.length;
    const index = <T extends { decisionRecordId: string }>(
      rows: readonly T[],
    ) => {
      const m = new Map<string, T[]>();
      for (const r of rows)
        m.set(r.decisionRecordId, [...(m.get(r.decisionRecordId) ?? []), r]);
      return m;
    };
    const ds = index(input.decisions),
      ss = index(input.shadows),
      ls = index(input.labels);
    const keys = new Set([
      ...ds.keys(),
      ...ss.keys(),
      ...ls.keys(),
      ...(input.invalidKeys ?? []),
    ]);
    for (const id of [...keys].sort()) {
      const d = ds.get(id) ?? [],
        s = ss.get(id) ?? [],
        l = ls.get(id) ?? [];
      const invalid = (code: string) => {
        excluded++;
        diagnostics.push({ code, stagingId });
      };
      if (input.invalidKeys?.includes(id)) {
        invalid("invalid-record");
        continue;
      }
      if (d.length > 1 || s.length > 1 || l.length > 1) {
        invalid("duplicate-key");
        continue;
      }
      if (d.length !== 1) {
        invalid("orphan-record");
        continue;
      }
      if (!s.length) {
        if (l.length) diagnostics.push({ code: "missing-shadow", stagingId });
        continue;
      }
      const decision = d[0]!,
        shadow = s[0]!;
      if (
        decision.decisionTypeId !== shadow.decisionTypeId ||
        decision.candidateHeadSha !== shadow.candidateHeadSha ||
        decision.proposedValue !== shadow.primaryProposedValue ||
        decision.authorityMode !== shadow.primaryAuthorityMode
      ) {
        invalid("join-mismatch");
        continue;
      }
      const allowed = evaluationClasses(decision.decisionTypeId);
      if (
        decision.executor.kind !== "provider" ||
        !allowed.includes(decision.proposedValue) ||
        (shadow.outcomeKind === "ok" &&
          !allowed.includes(shadow.jevProposedValue ?? "")) ||
        (l[0] && !allowed.includes(l[0].referenceValue))
      ) {
        invalid("unsupported-value");
        continue;
      }
      if (input.unavailable) {
        excluded++;
        continue;
      }
      joined++;
      all.push(shadow);
      if (l.length) labeled++;
      const primaryModel =
          decision.providerModel === null
            ? null
            : evaluationId(decision.providerModel),
        requestedModel = evaluationId(shadow.jevModel),
        resolvedModel =
          shadow.jevResolvedModel === null
            ? null
            : evaluationId(shadow.jevResolvedModel);
      const key = JSON.stringify([
        decision.decisionTypeId,
        primaryModel,
        requestedModel,
        resolvedModel,
      ]);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          type: decision.decisionTypeId,
          primaryModel,
          requestedModel,
          resolvedModel,
          pairs: [],
          shadows: [],
        };
        buckets.set(key, bucket);
      }
      bucket.shadows.push(shadow);
      if (
        l[0] &&
        shadow.outcomeKind === "ok" &&
        shadow.jevProposedValue !== null
      ) {
        compared++;
        bucket.pairs.push({
          primary: decision.proposedValue,
          jev: shadow.jevProposedValue,
          reference: l[0].referenceValue,
          confidence: shadow.jevConfidence,
        });
      }
    }
  }
  const groups = [...buckets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => {
      const classes = [
        ...new Set(b.pairs.flatMap((p) => [p.primary, p.jev, p.reference])),
      ].sort();
      const calibrated = b.pairs.filter((p) => p.confidence !== null);
      const bins = Array.from({ length: 5 }, (_, i) => {
        const rows = calibrated.filter(
          (p) => Math.min(4, Math.floor(p.confidence! * 5)) === i,
        );
        return {
          lower: i / 5,
          upper: (i + 1) / 5,
          upperInclusive: i === 4,
          n: rows.length,
          meanConfidence: rows.length
            ? rows.reduce((a, p) => a + p.confidence!, 0) / rows.length
            : null,
          observedAccuracy:
            rows.length >= MIN_EVALUATION_SAMPLES
              ? rows.filter((p) => p.jev === p.reference).length / rows.length
              : null,
        };
      });
      return {
        decisionTypeId: b.type,
        primaryModelId: b.primaryModel,
        requestedModelId: b.requestedModel,
        resolvedModelId: b.resolvedModel,
        compared: b.pairs.length,
        status:
          b.pairs.length >= MIN_EVALUATION_SAMPLES
            ? "sufficient"
            : "insufficient-evidence",
        primary: accuracy(b.pairs, "primary", classes),
        jev: accuracy(b.pairs, "jev", classes),
        calibration: {
          n: calibrated.length,
          missing: b.pairs.length - calibrated.length,
          status:
            calibrated.length >= MIN_EVALUATION_SAMPLES
              ? "sufficient"
              : "insufficient-evidence",
          bins,
        },
        primaryConfidence: null,
        primaryCalibration: null,
        ...summarize(b.shadows),
      };
    });
  return {
    schemaVersion: "agent-skill-chain/shadow-evaluation/v1",
    minSamples: MIN_EVALUATION_SAMPLES,
    targets,
    totals: {
      decisions,
      shadows,
      labels,
      joined,
      labeled,
      compared,
      excluded,
      unlabeled: joined - labeled,
      labelCoverage: joined ? labeled / joined : null,
      ...summarize(all),
    },
    groups,
    primaryInferenceLatencyMs: null,
    cost: null,
    diagnostics: diagnostics.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
  };
}
export type ShadowEvaluationReport = ReturnType<typeof evaluateShadowRecords>;
