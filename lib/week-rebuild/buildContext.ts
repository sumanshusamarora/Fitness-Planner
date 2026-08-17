import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessions,
} from "@/db/schema";
import { addDaysToISODate, toISODate } from "@/lib/dates";
import { getLatestRecoverySnapshot } from "@/lib/recovery";
import { buildProgressAnalytics } from "@/lib/progress";
import { buildRecentActualSummary } from "@/lib/session-activities";
import { hasMeaningfulJointPain, hasPoorRecovery } from "@/lib/progression";
import { getTrainingProfile } from "@/lib/training-profile";
import { computeRebuildConstraints } from "./constraints";
import { getRecentWeekFeedbackSummary } from "./feedback";
import type {
  RebuildDayContext,
  RebuildDayExercise,
  RebuildRecoverySummary,
  WeekFeedbackInput,
  WeekRebuildContext,
} from "./types";

/**
 * Builds the full context a week-rebuild decision needs: profile, current
 * week, completed history, feedback, recovery, Phase-1 progress analytics,
 * remaining availability, and deterministic modifiability constraints.
 * Pure enough to test the constraint computation separately.
 */

export async function buildWeekRebuildContext(input: {
  userId: number;
  workoutPlanId: number;
  feedback: WeekFeedbackInput;
  anchorDate?: Date;
}): Promise<WeekRebuildContext> {
  const anchorDate = input.anchorDate ?? new Date();
  const anchorDateISO = toISODate(anchorDate);

  const [plan, profile, progress, actual] = await Promise.all([
    db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, input.workoutPlanId), eq(workoutPlans.userId, input.userId)))
      .limit(1),
    getTrainingProfile(input.userId),
    buildProgressAnalytics({ userId: input.userId, anchorDate }),
    buildRecentActualSummary(input.userId),
  ]);
  if (!plan[0]) throw new Error("Plan not found.");

  const dayRows = await db
    .select()
    .from(workoutPlanDays)
    .where(eq(workoutPlanDays.workoutPlanId, plan[0].id))
    .orderBy(asc(workoutPlanDays.dayNumber));

  const dayIds = dayRows.map((day) => day.id);
  const [exerciseRows, sessionRows, nextPlan] = await Promise.all([
    dayIds.length
      ? db
          .select({
            dayId: workoutPlanExercises.workoutPlanDayId,
            exerciseId: exercises.id,
            name: exercises.name,
            primaryMuscle: exercises.primaryMuscle,
            equipment: exercises.equipment,
            sets: workoutPlanExercises.targetSets,
            minReps: workoutPlanExercises.minReps,
            maxReps: workoutPlanExercises.maxReps,
            targetRpe: workoutPlanExercises.targetRpe,
            suggestedWeightKg: workoutPlanExercises.suggestedWeightKg,
            restSeconds: workoutPlanExercises.restSeconds,
          })
          .from(workoutPlanExercises)
          .innerJoin(exercises, eq(workoutPlanExercises.exerciseId, exercises.id))
          .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds))
          .orderBy(asc(workoutPlanExercises.position))
      : Promise.resolve([]),
    dayIds.length
      ? db
          .select()
          .from(workoutSessions)
          .where(inArray(workoutSessions.workoutPlanDayId, dayIds))
          .orderBy(asc(workoutSessions.startedAt))
      : Promise.resolve([]),
    db
      .select({ id: workoutPlans.id })
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.userId, input.userId),
          eq(workoutPlans.weekNumber, plan[0].weekNumber + 1),
        ),
      )
      .limit(1),
  ]);

  const exercisesByDay = new Map<number, RebuildDayExercise[]>();
  for (const row of exerciseRows) {
    const list = exercisesByDay.get(row.dayId) ?? [];
    list.push({
      exerciseId: row.exerciseId,
      name: row.name,
      primaryMuscle: row.primaryMuscle,
      equipment: row.equipment,
      sets: row.sets,
      minReps: row.minReps,
      maxReps: row.maxReps,
      targetRpe: row.targetRpe,
      suggestedWeightKg: row.suggestedWeightKg,
      restSeconds: row.restSeconds,
    });
    exercisesByDay.set(row.dayId, list);
  }

  const sessionsByDay = new Map<number, typeof sessionRows>();
  for (const session of sessionRows) {
    const list = sessionsByDay.get(session.workoutPlanDayId) ?? [];
    list.push(session);
    sessionsByDay.set(session.workoutPlanDayId, list);
  }

  const days: RebuildDayContext[] = dayRows.map((day) => {
    const dateISO = addDaysToISODate(plan[0].startsOn, day.dayNumber - 1);
    const sessions = sessionsByDay.get(day.id) ?? [];
    const latest = sessions[sessions.length - 1];
    const sessionStatus: RebuildDayContext["sessionStatus"] = latest
      ? (latest.status as RebuildDayContext["sessionStatus"])
      : "none";
    const exs = exercisesByDay.get(day.id) ?? [];
    const isWorkout = exs.length > 0;
    const modifiable = sessionStatus === "none" && dateISO >= anchorDateISO;
    return {
      dayId: day.id,
      dayNumber: day.dayNumber,
      dayName: day.dayName,
      dateISO,
      title: day.title,
      origin: (day.origin as "moved" | "extra" | null) ?? null,
      exercises: exs,
      sessionStatus,
      sessionId: latest?.id ?? null,
      endReason: latest?.endReason ?? null,
      modifiable,
      isWorkout,
    };
  });

  const latestRecovery = await getLatestRecoverySnapshot(input.userId);
  const recoveryTrend: RebuildRecoverySummary["trend"] =
    progress.tolerance.recoveryTrend === "increasing"
      ? "improving"
      : progress.tolerance.recoveryTrend === "decreasing"
        ? "worsening"
        : progress.tolerance.recoveryTrend === "stable"
          ? "stable"
          : "unknown";

  const allWeekExerciseIds = [...new Set(exerciseRows.map((row) => row.exerciseId))];
  const library = await db
    .select({ exerciseId: exercises.id })
    .from(exercises)
    .where(eq(exercises.active, true));
  const allowedExerciseIds = [...new Set([...allWeekExerciseIds, ...library.map((row) => row.exerciseId)])];

  const recentMuscles = [...new Set(exerciseRows.map((row) => row.primaryMuscle))];

  const completedSessions = days.filter((day) => day.sessionStatus === "completed").length;
  const plannedSessions = days.filter((day) => day.isWorkout).length;

  const constraints = computeRebuildConstraints(days, input.feedback, {
    futureWeekExists: nextPlan.length > 0,
    maxExercisesPerDay: exercisesPerDay(profile?.sessionMinutes ?? null),
    minSets: 1,
    maxSets: 6,
    maxRpe: 9,
    allowedExerciseIds,
    recentMuscles,
  });

  const feedbackSummary = await getRecentWeekFeedbackSummary(input.userId);

  const remainingDays = days
    .filter((day) => day.dateISO >= anchorDateISO)
    .map((day) => ({ dayNumber: day.dayNumber, dateISO: day.dateISO, dayName: day.dayName }));

  return {
    user: { id: input.userId },
    profile: {
      primaryGoal: profile?.primaryGoal ?? null,
      experienceLevel: profile?.experienceLevel ?? null,
      yearsSinceTraining: profile?.yearsSinceTraining ?? null,
      desiredDaysPerWeek: profile?.desiredDaysPerWeek ?? null,
      sessionMinutes: profile?.sessionMinutes ?? null,
      trainingEnvironment: profile?.trainingEnvironment ?? null,
      limitationsNotes: profile?.limitationsNotes ?? null,
    },
    currentWeek: {
      planId: plan[0].id,
      weekNumber: plan[0].weekNumber,
      startsOn: plan[0].startsOn,
      plannedSessions,
      completedSessions,
      days,
    },
    feedback: input.feedback,
    recovery: {
      latest: latestRecovery,
      poorRecovery: hasPoorRecovery(latestRecovery),
      meaningfulJointPain: hasMeaningfulJointPain(latestRecovery),
      trend: recoveryTrend,
    },
    progress,
    actual,
    future: {
      nextWeekKnown: nextPlan.length > 0,
      remainingDays,
    },
    constraints,
  };
}

function exercisesPerDay(sessionMinutes: string | null): number {
  switch (sessionMinutes) {
    case "30":
      return 4;
    case "45":
      return 5;
    case "60":
      return 6;
    case "60+":
      return 7;
    default:
      return 6;
  }
}
