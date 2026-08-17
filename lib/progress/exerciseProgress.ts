import { estimateExposureCapacity, isWeightedResistance } from "./strengthEstimate";
import type {
  AdaptationDirection,
  ExerciseExposure,
  ExerciseMeta,
  ExerciseProgress,
  ExposureSet,
  TrendDirection,
} from "./types";

/**
 * Per-exercise performance analysis.
 *
 * Only *attempted* exposures influence capability. Load, reps and RPE are
 * tracked as independent, explainable dimensions (never collapsed into a
 * single made-up score). Direction is derived conservatively from the earlier
 * vs later part of the recent exposure window so a single noisy session cannot
 * flip the verdict.
 */

export const MIN_EXPOSURES_FOR_TREND = 2;
export const MAX_EXPOSURE_WINDOW = 8;

const LOAD_CHANGE_PCT = 0.02; // ±2% working load counts as a change
const REP_CHANGE_PER_SET = 1; // ±1 rep per set counts as a change
const RPE_CHANGE = 0.5; // ±0.5 average RPE counts as a change

const FAST_WEEKLY_RATE = 3;
const SLOW_WEEKLY_RATE = 1;

interface ExposureSummary {
  completedAt: string;
  weightKg: number | null;
  avgRepsPerSet: number | null;
  totalReps: number;
  avgRpe: number | null;
  capacity: number | null;
}

function workingWeight(sets: ExposureSet[]): number | null {
  if (sets.length === 0) return null;
  return sets[sets.length - 1].weightKg;
}

function avgRepsPerSet(sets: ExposureSet[]): number | null {
  if (sets.length === 0) return null;
  return sets.reduce((sum, set) => sum + set.reps, 0) / sets.length;
}

function totalReps(sets: ExposureSet[]): number {
  return sets.reduce((sum, set) => sum + set.reps, 0);
}

function avgRpe(sets: ExposureSet[]): number | null {
  const values = sets.map((set) => set.rpe).filter((rpe): rpe is number => rpe != null);
  if (values.length === 0) return null;
  return values.reduce((sum, rpe) => sum + rpe, 0) / values.length;
}

function summarize(exposure: ExerciseExposure, supportsCapacity: boolean): ExposureSummary {
  const sets = exposure.sets;
  return {
    completedAt: exposure.completedAt,
    weightKg: workingWeight(sets),
    avgRepsPerSet: avgRepsPerSet(sets),
    totalReps: totalReps(sets),
    avgRpe: avgRpe(sets),
    capacity: supportsCapacity ? estimateExposureCapacity(sets) : null,
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Splits a chronological series into earlier and later halves and returns their means. */
function halves(
  values: number[],
): { early: number; late: number; delta: number; deltaPct: number } | null {
  if (values.length < 2) return null;
  const mid = Math.ceil(values.length / 2);
  const earlyMean = mean(values.slice(0, mid));
  const lateMean = mean(values.slice(mid));
  if (earlyMean == null || lateMean == null) return null;
  const delta = lateMean - earlyMean;
  const deltaPct = earlyMean === 0 ? (delta === 0 ? 0 : delta > 0 ? Infinity : -Infinity) : (delta / earlyMean) * 100;
  return { early: earlyMean, late: lateMean, delta, deltaPct };
}

function classifyTrend(deltaPct: number, threshold: number): TrendDirection {
  if (!Number.isFinite(deltaPct)) return "stable";
  if (deltaPct >= threshold) return "increasing";
  if (deltaPct <= -threshold) return "decreasing";
  return "stable";
}

/** Absolute-value trend for rep counts (a ±1 rep change is meaningful). */
function classifyAbsoluteTrend(delta: number, threshold: number): TrendDirection {
  if (!Number.isFinite(delta)) return "stable";
  if (delta >= threshold) return "increasing";
  if (delta <= -threshold) return "decreasing";
  return "stable";
}

function classifyRpeTrend(delta: number): TrendDirection {
  if (delta >= RPE_CHANGE) return "increasing";
  if (delta <= -RPE_CHANGE) return "decreasing";
  return "stable";
}

/** Percentage change per week between two points of a chronological series. */
function segmentRatePct(values: number[], dates: string[], start: number, end: number): number | null {
  if (end <= start || end >= values.length || start < 0) return null;
  const startValue = values[start];
  const endValue = values[end];
  if (startValue == null || endValue == null || startValue <= 0) return null;
  const elapsedMs = Date.parse(dates[end]) - Date.parse(dates[start]);
  const elapsedDays = elapsedMs / 86400000;
  if (elapsedDays <= 0) return null;
  const totalPct = ((endValue - startValue) / startValue) * 100;
  return (totalPct / elapsedDays) * 7;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function directionFromRate(rate: number | null): AdaptationDirection {
  if (rate == null) return "improving";
  if (rate >= FAST_WEEKLY_RATE) return "improving_fast";
  if (rate >= SLOW_WEEKLY_RATE) return "improving";
  return "improving_slowly";
}

/**
 * Classifies direction from the independent load / rep / RPE markers.
 * A lone RPE rise with flat work is treated as "flat" (a plateau signal), not
 * "declining" — a single effort spike is not performance regression.
 */
function classifyDirection(
  loadTrend: TrendDirection,
  repTrend: TrendDirection,
  rpeTrend: TrendDirection,
  weeklyRate: number | null,
): AdaptationDirection {
  const workUp = loadTrend === "increasing" || repTrend === "increasing";
  const workDown = loadTrend === "decreasing" || repTrend === "decreasing";
  const rpeUp = rpeTrend === "increasing";
  const rpeDown = rpeTrend === "decreasing";

  if (workDown && !workUp) return "declining";
  if (workDown && workUp) return "flat"; // ambiguous trade-off
  if (workUp && !workDown) return directionFromRate(weeklyRate);
  // Work is flat.
  if (rpeDown) return "improving"; // same load/reps at lower effort = capability up
  if (rpeUp) return "flat"; // same work at higher effort = stagnation, not regression
  return "flat";
}

export function analyzeExercise(
  exercise: ExerciseMeta,
  exposures: ExerciseExposure[],
): ExerciseProgress {
  const attempted = exposures.filter((exposure) => exposure.outcome === "attempted");
  const skipped = exposures.filter((exposure) => exposure.outcome === "skipped").length;
  const notAttempted = exposures.filter((exposure) => exposure.outcome === "not_attempted").length;

  const supportsCapacity =
    isWeightedResistance(exercise) &&
    attempted.some((exposure) => exposure.sets.some((set) => set.weightKg > 0));

  const window = attempted.slice(0, MAX_EXPOSURE_WINDOW);
  const exposureCount = window.length;

  const summaries = window.map((exposure) => summarize(exposure, supportsCapacity));

  const base: ExerciseProgress = {
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    equipment: exercise.equipment,
    category: exercise.category,
    primaryMuscle: exercise.primaryMuscle,
    exposureCount,
    attemptedExposures: attempted.length,
    skippedExposures: skipped,
    notAttemptedExposures: notAttempted,
    supportsCapacityEstimate: supportsCapacity,
    loadTrend: "insufficient_data",
    repTrend: "insufficient_data",
    rpeTrend: "insufficient_data",
    capacityTrend: supportsCapacity ? "insufficient_data" : "unsupported",
    direction: "insufficient_data",
    weeklyRatePct: null,
    earlyWeeklyRatePct: null,
    lateWeeklyRatePct: null,
    firstVsLatestChangePct: null,
    recentLoadKg: null,
    recentRepsPerSet: null,
    recentRpe: null,
    isolatedDip: false,
    evidence: [],
  };

  if (exposureCount === 0) {
    base.evidence.push("No attempted exposures for this movement.");
    return base;
  }

  const latest = summaries[summaries.length - 1];
  base.recentLoadKg = latest.weightKg;
  base.recentRepsPerSet = latest.avgRepsPerSet == null ? null : round1(latest.avgRepsPerSet);
  base.recentRpe = latest.avgRpe == null ? null : round1(latest.avgRpe);

  if (exposureCount < MIN_EXPOSURES_FOR_TREND) {
    base.evidence.push(
      `Only ${exposureCount} attempted exposure${exposureCount === 1 ? "" : "s"} — not enough to judge this movement's trend.`,
    );
    return base;
  }

  const weights = summaries.map((summary) => summary.weightKg).filter((weight): weight is number => weight != null);
  const reps = summaries.map((summary) => summary.avgRepsPerSet).filter((value): value is number => value != null);
  const rpes = summaries.map((summary) => summary.avgRpe).filter((value): value is number => value != null);
  const capacities = summaries.map((summary) => summary.capacity).filter((value): value is number => value != null);
  const totalRepsSeries = summaries.map((summary) => summary.totalReps);
  const dates = summaries.map((summary) => summary.completedAt);

  const loadHalves = halves(weights);
  const repHalves = halves(reps);
  const rpeHalves = halves(rpes);

  const loadTrend: TrendDirection = loadHalves ? classifyTrend(loadHalves.deltaPct, LOAD_CHANGE_PCT * 100) : "insufficient_data";
  const repTrend: TrendDirection = repHalves ? classifyAbsoluteTrend(repHalves.delta, REP_CHANGE_PER_SET) : "insufficient_data";
  const rpeTrend: TrendDirection = rpeHalves ? classifyRpeTrend(rpeHalves.delta) : "insufficient_data";

  const workValues: number[] = summaries.map((summary) =>
    supportsCapacity ? (summary.capacity ?? summary.totalReps) : summary.totalReps,
  );
  const workHalves = supportsCapacity ? halves(capacities) : halves(totalRepsSeries);
  const capacityTrend: TrendDirection | "unsupported" = supportsCapacity
    ? workHalves
      ? classifyTrend(workHalves.deltaPct, SLOW_WEEKLY_RATE)
      : "insufficient_data"
    : "unsupported";

  const n = summaries.length;
  const mid = Math.ceil(n / 2);
  const weeklyRate = segmentRatePct(workValues, dates, 0, n - 1);
  const earlyRate = segmentRatePct(workValues, dates, 0, mid - 1);
  const lateRate = segmentRatePct(workValues, dates, mid, n - 1);

  let firstVsLatest: number | null = null;
  const firstValue = workValues[0];
  const lastValue = workValues[n - 1];
  if (firstValue != null && lastValue != null && firstValue > 0) {
    firstVsLatest = ((lastValue - firstValue) / firstValue) * 100;
  }

  base.loadTrend = loadTrend;
  base.repTrend = repTrend;
  base.rpeTrend = rpeTrend;
  base.capacityTrend = capacityTrend;
  base.direction = classifyDirection(loadTrend, repTrend, rpeTrend, weeklyRate);
  base.weeklyRatePct = weeklyRate == null ? null : round1(weeklyRate);
  base.earlyWeeklyRatePct = earlyRate == null ? null : round1(earlyRate);
  base.lateWeeklyRatePct = lateRate == null ? null : round1(lateRate);
  base.firstVsLatestChangePct = firstVsLatest == null ? null : round1(firstVsLatest);

  // Detect an isolated dip: the latest exposure dropped from the previous one
  // after an earlier improving run. This is noise, not a plateau or decline.
  if (n >= 3) {
    const latestWork = workValues[n - 1];
    const prevWork = workValues[n - 2];
    const earlierWork = workValues[0];
    if (
      prevWork != null &&
      latestWork != null &&
      earlierWork != null &&
      prevWork > 0 &&
      earlierWork > 0 &&
      latestWork < prevWork * 0.95 &&
      workValues[n - 2] > earlierWork * 1.02
    ) {
      base.isolatedDip = true;
      base.evidence.push("Latest exposure is an isolated dip after an improving run.");
    }
  }

  base.evidence.push(`${exposureCount} attempted exposures analysed.`);
  if (loadTrend !== "insufficient_data") base.evidence.push(`Load trend ${loadTrend}.`);
  if (repTrend !== "insufficient_data") base.evidence.push(`Reps per set trend ${repTrend}.`);
  if (rpeTrend !== "insufficient_data") base.evidence.push(`RPE trend ${rpeTrend}.`);
  if (supportsCapacity && base.weeklyRatePct != null) {
    base.evidence.push(`Estimated capacity changing ~${base.weeklyRatePct}%/week.`);
  }

  return base;
}
