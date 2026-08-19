export interface GateVerdictLike<Finding extends { severity: string } = { severity: string }> {
  conformance?: 'pass' | 'fail' | 'pending';
  falsification?: 'pass' | 'fail' | 'pending';
  blockers?: Finding[];
  inconclusive?: boolean;
  final?: 'approved' | 'rejected' | 'pending' | 'human_required';
}

export type SlotVerdict<Verdict extends GateVerdictLike> =
  | { status: 'resolved'; verdict: Verdict }
  | { status: 'unresolved' };

export interface GateAttemptAggregationInput<Verdict extends GateVerdictLike> {
  requiredReviewerCount: number | undefined;
  launchedSlots: readonly number[];
  verdictBySlot: ReadonlyMap<number, SlotVerdict<Verdict>>;
}

export interface GateAttemptAggregation<Finding extends { severity: string }> {
  final: 'approved' | 'rejected' | 'human_required';
  conformance: 'pass' | 'fail' | 'pending';
  falsification: 'pass' | 'fail' | 'pending';
  inconclusive: boolean;
  blockers: Finding[];
}

function aggregateView<Finding extends { severity: string }>(
  verdicts: readonly GateVerdictLike<Finding>[],
  key: 'conformance' | 'falsification',
): 'pass' | 'fail' | 'pending' {
  const values = verdicts.map((verdict) => verdict[key] ?? 'pending');
  if (values.includes('fail')) return 'fail';
  if (values.length > 0 && values.every((value) => value === 'pass')) return 'pass';
  return 'pending';
}

/**
 * Issue #733: attempt の要求体数・起動済み slot・判定確定数を混同せず、
 * 判定が揃わない状態を必ず human_required へ倒す。
 */
export function aggregateGateAttempt<
  Finding extends { severity: string },
  Verdict extends GateVerdictLike<Finding>,
>(input: GateAttemptAggregationInput<Verdict>): GateAttemptAggregation<Finding> {
  const launchedSlots = [...new Set(input.launchedSlots)];
  const required = input.requiredReviewerCount;
  if (required === undefined || !Number.isInteger(required) || required < 1) {
    return {
      final: 'human_required', conformance: 'pending', falsification: 'pending',
      inconclusive: true, blockers: [],
    };
  }
  if (launchedSlots.length === 0 || launchedSlots.length < required) {
    return {
      final: 'human_required', conformance: 'pending', falsification: 'pending',
      inconclusive: true, blockers: [],
    };
  }

  const verdicts: Verdict[] = [];
  for (const slot of launchedSlots) {
    const result = input.verdictBySlot.get(slot);
    if (!result || result.status === 'unresolved') {
      return {
        final: 'human_required', conformance: 'pending', falsification: 'pending',
        inconclusive: true, blockers: [],
      };
    }
    verdicts.push(result.verdict);
  }

  const blockers = verdicts.flatMap((verdict) => verdict.blockers ?? []);
  const conformance = aggregateView(verdicts, 'conformance');
  const falsification = aggregateView(verdicts, 'falsification');
  const hasBlocking = blockers.some((finding) => finding.severity === 'blocking');
  const hasFail = conformance === 'fail' || falsification === 'fail';
  const hasPending = conformance === 'pending' || falsification === 'pending';
  const hasInconclusive = verdicts.some(
    (verdict) => verdict.inconclusive === true || verdict.final === 'human_required',
  );
  const final = hasFail || hasBlocking
    ? 'rejected'
    : hasPending || hasInconclusive
      ? 'human_required'
      : 'approved';
  return {
    final,
    conformance,
    falsification,
    inconclusive: final === 'human_required',
    blockers,
  };
}
