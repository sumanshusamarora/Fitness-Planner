export interface LastSet {
  reps: number;
  rpe: number | null;
}

export interface RecoverySnapshot {
  sleep: number | null;
  energy: number | null;
  soreness: number | null;
  jointPain: number | null;
  stress: number | null;
}

export interface ProgressionParams {
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  /** Weight used in the most recent completed session (or the planned starting weight). */
  lastWeightKg: number | null;
  /** Sets from the most recent completed session for this exercise. */
  lastSets: LastSet[];
  /** Latest pre-workout recovery snapshot, if available. */
  recovery?: RecoverySnapshot | null;
}

export interface ProgressionResult {
  recommendedWeight: number | null;
  reason: string;
}

export function smallestIncrement(weightKg: number): number {
  return weightKg <= 15 ? 1.25 : 2.5;
}

export function roundToQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

export function hasMeaningfulJointPain(recovery?: RecoverySnapshot | null): boolean {
  return (
    recovery?.jointPain != null && recovery.jointPain >= 7
  );
}

export function hasPoorRecovery(recovery?: RecoverySnapshot | null): boolean {
  if (!recovery) return false;
  const { sleep, energy, soreness, stress } = recovery;
  return (
    (sleep != null && sleep <= 4) ||
    (energy != null && energy <= 4) ||
    (soreness != null && soreness >= 8) ||
    (stress != null && stress >= 8)
  );
}

/**
 * Deterministic progression recommendation. No AI — pure rule-based logic.
 *
 * Performance is the primary signal:
 * - All sets completed + top of rep range + at/below target RPE  -> increase.
 * - RPE considerably above target                                  -> hold.
 * - Failed to reach minimum reps                                   -> reduce.
 * - Otherwise (reps within range but not at top)                    -> hold.
 *
 * Recovery only ever *blocks* an increase — it never forces one:
 * - Meaningful joint pain or poor overall recovery holds the weight.
 */
export function recommendNextWeight(
  params: ProgressionParams,
): ProgressionResult {
  const {
    targetSets,
    minReps,
    maxReps,
    targetRpe,
    lastWeightKg,
    lastSets,
    recovery,
  } = params;

  if (lastSets.length === 0) {
    return {
      recommendedWeight: lastWeightKg,
      reason:
        lastWeightKg != null
          ? "No previous session yet. Starting with the planned weight."
          : "No previous session yet. Pick a light, comfortable weight.",
    };
  }

  const completedSets = lastSets.length;
  const allSetsCompleted = completedSets >= targetSets;
  const reps = lastSets.map((s) => s.reps);
  const atTopOfRange = reps.every((r) => r >= maxReps);
  const belowMin = reps.some((r) => r < minReps);
  const rpes = lastSets
    .map((s) => s.rpe)
    .filter((r): r is number => r != null);
  const maxRpe = rpes.length ? Math.max(...rpes) : null;

  const baseWeight = lastWeightKg ?? 0;

  if (allSetsCompleted && atTopOfRange && maxRpe != null && maxRpe <= targetRpe) {
    if (hasMeaningfulJointPain(recovery)) {
      return {
        recommendedWeight: baseWeight,
        reason: "Joint pain reported. Holding weight this week.",
      };
    }
    if (hasPoorRecovery(recovery)) {
      return {
        recommendedWeight: baseWeight,
        reason: "Recovery is low. Holding weight this week.",
      };
    }
    return {
      recommendedWeight: roundToQuarter(
        baseWeight + smallestIncrement(baseWeight),
      ),
      reason: `Completed all sets at the top of the rep range with RPE ${maxRpe}.`,
    };
  }

  if (maxRpe != null && maxRpe > targetRpe + 1) {
    return {
      recommendedWeight: baseWeight,
      reason: `RPE ${maxRpe} was considerably higher than target. Hold the weight.`,
    };
  }

  if (belowMin) {
    const reduced = Math.max(
      0,
      roundToQuarter(baseWeight - smallestIncrement(baseWeight)),
    );
    return {
      recommendedWeight: reduced,
      reason: "Did not reach the minimum rep target. Reduce the weight.",
    };
  }

  return {
    recommendedWeight: baseWeight,
    reason: "Reps were within range. Keep the same weight.",
  };
}
