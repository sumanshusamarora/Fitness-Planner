import { recommendNextWeight } from "@/lib/progression";
import { recoverySummaryText } from "./recovery";
import type { ExerciseAnalysis, TrainingContext, WeekAnalysis } from "./types";

function trendForExercise(
  recent: TrainingContext["exercises"][number]["recentExposures"],
): ExerciseAnalysis["trend"] {
  if (recent.length < 2) return "insufficient_data";
  const latest = recent[0];
  const previous = recent[1];
  const latestReps = latest.sets.reduce((sum, set) => sum + set.reps, 0);
  const previousReps = previous.sets.reduce((sum, set) => sum + set.reps, 0);
  const latestRpe = latest.sets.reduce((sum, set) => sum + (set.rpe ?? 0), 0);
  const previousRpe = previous.sets.reduce((sum, set) => sum + (set.rpe ?? 0), 0);
  if (latestReps > previousReps || (latest.weightKg ?? 0) > (previous.weightKg ?? 0)) {
    return "improving";
  }
  if (latestReps < previousReps || latestRpe > previousRpe + 1) return "declining";
  return "stable";
}

export function analyseWeek(context: TrainingContext): WeekAnalysis {
  const exerciseAnalyses: Record<number, ExerciseAnalysis> = {};
  for (const exercise of context.exercises) {
    // Prefer source-week performance; older history supplies context only.
    const latestExposure =
      exercise.recentExposures.find((exposure) => exposure.belongsToSourceWeek) ?? null;
    const latestSets = latestExposure?.sets ?? [];
    const rpes = latestSets
      .map((set) => set.rpe)
      .filter((rpe): rpe is number => rpe != null);
    const allSetsCompleted = latestSets.length >= exercise.targetSets;
    const reachedTopOfRange =
      allSetsCompleted && latestSets.every((set) => set.reps >= exercise.maxReps);
    const reachedMinimumReps =
      latestSets.length > 0 && latestSets.every((set) => set.reps >= exercise.minReps);
    const lastWeightKg = latestExposure?.weightKg ?? exercise.suggestedWeightKg;
    const recommendation = recommendNextWeight({
      targetSets: exercise.targetSets,
      minReps: exercise.minReps,
      maxReps: exercise.maxReps,
      targetRpe: exercise.targetRpe,
      lastWeightKg,
      lastSets: latestSets,
      recovery: context.recovery.average ?? context.recovery.latest,
    });
    exerciseAnalyses[exercise.sourcePlanExerciseId] = {
      sourcePlanExerciseId: exercise.sourcePlanExerciseId,
      latestExposure,
      allSetsCompleted,
      reachedTopOfRange,
      reachedMinimumReps,
      latestRpe: rpes.length ? rpes[rpes.length - 1] : null,
      averageRpe: rpes.length
        ? Math.round((rpes.reduce((sum, rpe) => sum + rpe, 0) / rpes.length) * 10) / 10
        : null,
      trend: trendForExercise(exercise.recentExposures),
      deterministicWeightKg: recommendation.recommendedWeight,
      deterministicReason: recommendation.reason,
    };
  }

  return {
    completedSessions: context.completedSessions,
    plannedSessions: context.plannedSessions,
    missedSessions: context.missedDays.length,
    recoverySummary: recoverySummaryText(context.recovery),
    hasMaterialSafetyFlag: context.recovery.meaningfulJointPain,
    exerciseAnalyses,
  };
}
