import type {
  AdaptationDirection,
  AdaptationInterpretation,
  AdaptationSummary,
  AdaptationTrend,
  ExerciseProgress,
  ProfileRecord,
  TrainingStage,
} from "./types";

/**
 * User-level adaptation: how quickly (and how consistently) the user is
 * improving, and whether that rate itself is changing (natural flattening).
 *
 * Derived, never user-entered. Prefers an explainable aggregate over an opaque
 * statistical model, and refuses to classify strongly without enough evidence.
 */

function isImproving(direction: AdaptationDirection): boolean {
  return direction === "improving_fast" || direction === "improving" || direction === "improving_slowly";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateDirection(exercises: ExerciseProgress[]): AdaptationDirection {
  const analyzed = exercises.filter((exercise) => exercise.exposureCount >= 2);
  if (analyzed.length === 0) return "insufficient_data";

  const directions = analyzed.map((exercise) => exercise.direction);
  const improving = directions.filter(isImproving).length;
  const declining = directions.filter((direction) => direction === "declining").length;
  const flat = directions.filter((direction) => direction === "flat").length;

  // A conservative, explainable aggregation: the direction that best
  // characterises the *share* of movements, with declining weighted down so a
  // few stuck accessories do not mask broad improvement.
  if (declining >= improving + flat && declining > 0) return "declining";
  if (improving === 0 && declining === 0 && flat > 0) return "flat";
  if (improving > declining && improving >= flat) {
    const fast = directions.filter((direction) => direction === "improving_fast").length;
    if (fast >= Math.ceil(improving / 2)) return "improving_fast";
    return "improving";
  }
  if (improving > 0) return "improving_slowly";
  if (flat > 0) return "flat";
  return "declining";
}

function adaptationConfidence(exercises: ExerciseProgress[]): "high" | "medium" | "low" {
  const analyzed = exercises.filter((exercise) => exercise.exposureCount >= 4);
  if (analyzed.length >= 3) return "high";
  if (analyzed.length >= 1) return "medium";
  return "low";
}

/**
 * Natural flattening: compare the user's own recent rate against their earlier
 * rate across weighted movements. Slower-but-still-positive progress is normal
 * as capability rises; it is not automatically program failure.
 */
function adaptationTrend(exercises: ExerciseProgress[]): AdaptationTrend {
  const weighted = exercises.filter(
    (exercise) =>
      exercise.supportsCapacityEstimate &&
      exercise.earlyWeeklyRatePct != null &&
      exercise.lateWeeklyRatePct != null,
  );

  // For bodyweight/non-weighted we still respect the direction spread when no
  // numerical rate exists.
  if (weighted.length === 0) {
    const improving = exercises.filter((exercise) => isImproving(exercise.direction)).length;
    const analyzed = exercises.filter((exercise) => exercise.exposureCount >= 2).length;
    if (analyzed === 0) return "unknown";
    if (improving === 0) return "flat";
    return "stable";
  }

  const earlyMedian = median(weighted.map((exercise) => exercise.earlyWeeklyRatePct as number));
  const lateMedian = median(weighted.map((exercise) => exercise.lateWeeklyRatePct as number));
  if (earlyMedian == null || lateMedian == null) return "unknown";

  if (Math.abs(earlyMedian) < 0.3 && Math.abs(lateMedian) < 0.3) return "flat";
  if (lateMedian >= earlyMedian + 1) return "accelerating";
  if (lateMedian <= earlyMedian - 1) {
    return lateMedian > 0 ? "slowing" : "flat";
  }
  return "stable";
}

function interpretationFor(direction: AdaptationDirection, trend: AdaptationTrend): AdaptationInterpretation {
  if (direction === "insufficient_data") return "insufficient_data";
  if (direction === "declining") return "concerning";
  if (direction === "flat") return "normal_so_far";
  if (trend === "accelerating") return "accelerating";
  if (trend === "slowing") return "normal_flattening";
  return "normal_so_far";
}

export function summarizeAdaptation(exercises: ExerciseProgress[]): AdaptationSummary {
  const direction = aggregateDirection(exercises);
  const trend = adaptationTrend(exercises);
  const rate = median(
    exercises
      .filter((exercise) => exercise.weeklyRatePct != null)
      .map((exercise) => exercise.weeklyRatePct as number),
  );

  const evidence: string[] = [];
  const improving = exercises.filter((exercise) => isImproving(exercise.direction)).length;
  const flat = exercises.filter((exercise) => exercise.direction === "flat").length;
  const declining = exercises.filter((exercise) => exercise.direction === "declining").length;
  evidence.push(`${improving} improving, ${flat} flat, ${declining} declining movements.`);
  if (rate != null) evidence.push(`Median capability change ~${round1(rate)}%/week.`);
  if (trend === "slowing") evidence.push("Improvement is slowing versus earlier — consistent with normal flattening.");
  if (trend === "flat") evidence.push("Capability is not meaningfully changing.");

  return {
    direction,
    trend,
    ratePctPerWeek: rate == null ? null : round1(rate),
    confidence: adaptationConfidence(exercises),
    interpretation: interpretationFor(direction, trend),
    evidence,
  };
}

/**
 * Conservative training stage. Uses the declared profile plus accumulated
 * valid exposures and progression behaviour — never account age or weeks in
 * the app alone. Deliberately reluctant to call someone intermediate/advanced.
 */
export function classifyTrainingStage(
  profile: ProfileRecord,
  totalAttemptedExposures: number,
  direction: AdaptationDirection,
): TrainingStage {
  const level = profile.experienceLevel?.toLowerCase() ?? null;
  const yearsSince = profile.yearsSinceTraining ?? null;

  if (level === "advanced") return "advanced";
  if (level === "intermediate") return "intermediate";
  if (level === "occasional") return "developing";

  const returning = level === "returning" || (yearsSince != null && yearsSince >= 1);
  if (returning) {
    if (totalAttemptedExposures >= 20 && isImproving(direction)) return "developing";
    return "returning";
  }

  if (level === "beginner" || level == null) {
    if (level == null && totalAttemptedExposures === 0) return "unknown";
    if (totalAttemptedExposures >= 20 && isImproving(direction)) return "developing";
    return "novice";
  }

  return "unknown";
}
