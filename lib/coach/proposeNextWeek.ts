import { addDaysToISODate } from "@/lib/dates";
import type {
  CoachQuestion,
  ExerciseAction,
  ExerciseChange,
  ProposedWorkoutDay,
  TrainingContext,
  WeekAnalysis,
  WeeklyPlanProposal,
} from "./types";

function actionFor(
  previousWeight: number | null,
  proposedWeight: number | null,
): ExerciseAction {
  if ((proposedWeight ?? 0) > (previousWeight ?? 0)) return "increase_load";
  if ((proposedWeight ?? 0) < (previousWeight ?? 0)) return "decrease_load";
  return "maintain";
}

function evidenceFor(
  exercise: TrainingContext["exercises"][number],
  analysis: WeekAnalysis["exerciseAnalyses"][number],
  hasPain: boolean,
): string[] {
  const evidence: string[] = [];
  if (analysis.latestExposure) {
    evidence.push(
      `Completed ${analysis.latestExposure.sets.length}/${exercise.targetSets} planned sets`,
    );
    evidence.push(
      analysis.reachedTopOfRange
        ? `Reached ${exercise.maxReps} reps on every set`
        : `Reps: ${analysis.latestExposure.sets.map((set) => set.reps).join(", ")}`,
    );
    if (analysis.latestRpe != null) evidence.push(`Latest RPE ${analysis.latestRpe}`);
  } else {
    evidence.push("No completed source-week session for this exercise");
  }
  if (analysis.trend !== "insufficient_data") evidence.push(`Recent trend: ${analysis.trend}`);
  if (hasPain) evidence.push("Meaningful joint pain reported");
  return evidence;
}

export function proposeNextWeek(
  context: TrainingContext,
  analysis: WeekAnalysis,
): WeeklyPlanProposal {
  const questions: CoachQuestion[] = [];
  if (analysis.hasMaterialSafetyFlag) {
    questions.push({
      id: "joint-pain-current",
      prompt: "You reported meaningful joint pain. Do you still have pain today?",
      options: ["Yes", "No"],
    });
  }
  if (analysis.missedSessions >= 2) {
    questions.push({
      id: "missed-sessions-reason",
      prompt: `You completed ${analysis.completedSessions} of ${analysis.plannedSessions} workouts. What got in the way?`,
      options: ["Work/time", "Recovery", "Pain", "Illness", "Other"],
    });
  }

  const changes: ExerciseChange[] = context.exercises.map((exercise) => {
    const item = analysis.exerciseAnalyses[exercise.sourcePlanExerciseId];
    const previousWeight = item.latestExposure?.weightKg ?? exercise.suggestedWeightKg;
    const proposedWeight = item.deterministicWeightKg ?? previousWeight;
    const blockedForPain = analysis.hasMaterialSafetyFlag;
    const action: ExerciseAction = blockedForPain
      ? "needs_input"
      : actionFor(previousWeight, proposedWeight);
    const confidence = blockedForPain
      ? "needs-input"
      : context.recovery.poorRecovery || !item.latestExposure
        ? "medium"
        : "high";
    return {
      sourcePlanExerciseId: exercise.sourcePlanExerciseId,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      previous: {
        weightKg: previousWeight,
        sets: exercise.targetSets,
        minReps: exercise.minReps,
        maxReps: exercise.maxReps,
        targetRpe: exercise.targetRpe,
      },
      proposed: {
        weightKg: proposedWeight,
        sets: exercise.targetSets,
        minReps: exercise.minReps,
        maxReps: exercise.maxReps,
        targetRpe: exercise.targetRpe,
      },
      action,
      confidence,
      reason: blockedForPain
        ? "Joint pain can change the right exercise or load. Keep this plan conservative until you confirm how it feels."
        : item.deterministicReason,
      evidence: evidenceFor(exercise, item, blockedForPain),
    };
  });

  const days = [...new Map(context.exercises.map((exercise) => [exercise.sourcePlanDayId, exercise])).values()]
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map<ProposedWorkoutDay>((day) => ({
      sourcePlanDayId: day.sourcePlanDayId,
      dayNumber: day.dayNumber,
      dayName: day.dayName,
      title: day.dayTitle,
      exercises: context.exercises
        .filter((exercise) => exercise.sourcePlanDayId === day.sourcePlanDayId)
        .sort((a, b) => a.position - b.position)
        .map((exercise) => ({
          ...changes.find((change) => change.sourcePlanExerciseId === exercise.sourcePlanExerciseId)!,
          position: exercise.position,
          restSeconds: exercise.restSeconds,
        })),
    }));
  const confidence = questions.length ? "needs-input" : changes.some((change) => change.confidence === "medium") ? "medium" : "high";

  return {
    proposalType: "next_week",
    sourceWeekId: context.sourcePlan.id,
    proposedWeekNumber: context.sourcePlan.weekNumber + 1,
    proposedStartsOn: addDaysToISODate(context.sourcePlan.startsOn, 7),
    summary: {
      completedSessions: analysis.completedSessions,
      plannedSessions: analysis.plannedSessions,
      recoverySummary: analysis.recoverySummary,
      overallRecommendation: questions.length
        ? "I need one answer before this plan can be applied."
        : "Keep the return-to-training phase steady and only progress where the completed work supports it.",
    },
    changes,
    days,
    questions,
    confidence,
    methodologyVersion: "local-deterministic-v1",
  };
}
