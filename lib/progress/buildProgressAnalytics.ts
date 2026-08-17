import { and, asc, eq, gte, gt, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  recoveryLogs,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { addDaysToISODate, toISODate } from "@/lib/dates";
import { getTrainingProfile } from "@/lib/training-profile";
import { classifyTrainingStage, summarizeAdaptation } from "./adaptation";
import { analyzeExercise } from "./exerciseProgress";
import { assessPlateau } from "./plateau";
import { analyzeTolerance } from "./tolerance";
import type {
  AdaptationDirection,
  CompactExposure,
  ExerciseExposure,
  ExerciseMeta,
  PerformanceSummary,
  ProgressAnalytics,
  ProgressAnalyticsInput,
  SessionRecord,
} from "./types";

/**
 * Canonical entry point for longitudinal progress analytics.
 *
 * `assembleProgressAnalytics` is pure (no database) and unit-testable; it is
 * the deterministic engine. `buildProgressAnalytics` is the user-scoped
 * database loader that feeds it. Neither ever calls the model.
 */

function isImproving(direction: AdaptationDirection): boolean {
  return direction === "improving_fast" || direction === "improving" || direction === "improving_slowly";
}

function buildPerformanceSummary(exercises: ProgressAnalytics["exercises"]): PerformanceSummary {
  const improvingExercises = exercises.filter((exercise) => isImproving(exercise.direction)).length;
  const improvingFastExercises = exercises.filter((exercise) => exercise.direction === "improving_fast").length;
  const flatExercises = exercises.filter((exercise) => exercise.direction === "flat").length;
  const decliningExercises = exercises.filter((exercise) => exercise.direction === "declining").length;
  const insufficientDataExercises = exercises.filter((exercise) => exercise.direction === "insufficient_data").length;
  const analyzedExercises = exercises.filter((exercise) => exercise.exposureCount >= 2).length;

  return {
    overallDirection: summarizeAdaptation(exercises).direction,
    improvingExercises,
    improvingFastExercises,
    flatExercises,
    decliningExercises,
    insufficientDataExercises,
    analyzedExercises,
    summary: `${improvingExercises} improving, ${flatExercises} flat, ${decliningExercises} declining, ${insufficientDataExercises} without enough data.`,
  };
}

export function assembleProgressAnalytics(input: ProgressAnalyticsInput): ProgressAnalytics {
  const exposureMap = new Map<number, ExerciseExposure[]>();
  for (const entry of input.exposures) {
    const list = [...(entry.exposures ?? [])].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    exposureMap.set(entry.exerciseId, list);
  }

  const exerciseProgress = input.exercises.map((exercise) =>
    analyzeExercise(exercise, exposureMap.get(exercise.exerciseId) ?? []),
  );

  const performance = buildPerformanceSummary(exerciseProgress);
  const adaptation = summarizeAdaptation(exerciseProgress);
  const totalAttemptedExposures = exerciseProgress.reduce((sum, exercise) => sum + exercise.attemptedExposures, 0);
  const trainingStage = classifyTrainingStage(input.profile, totalAttemptedExposures, adaptation.direction);

  const tolerance = analyzeTolerance({
    plannedSessions: input.plannedSessions,
    sessions: input.sessions,
    sets: flatSets(input.exposures),
    recovery: input.recovery,
  });

  const plateau = assessPlateau({
    exercises: exerciseProgress,
    adherenceRate: tolerance.adherenceRate,
    completedSessions: tolerance.completedSessions,
    plannedSessions: input.plannedSessions,
    recoveryTrend: tolerance.recoveryTrend,
    meaningfulJointPain: tolerance.meaningfulJointPain,
    scheduleConfounders: tolerance.scheduleRelatedEndedEarly,
    totalAttemptedExposures,
  });

  const recentExposures = buildRecentExposures(input);

  return {
    userId: input.userId,
    generatedAt: new Date().toISOString(),
    anchorDateISO: input.anchorDateISO,
    trainingStage,
    performance,
    exercises: exerciseProgress,
    tolerance,
    adaptation,
    plateau,
    recentExposures,
  };
}

function flatSets(
  exposures: ProgressAnalyticsInput["exposures"],
): { sessionId: number; rpe: number | null }[] {
  const result: { sessionId: number; rpe: number | null }[] = [];
  for (const entry of exposures) {
    for (const exposure of entry.exposures) {
      if (exposure.outcome !== "attempted") continue;
      for (const set of exposure.sets) {
        result.push({ sessionId: exposure.sessionId, rpe: set.rpe });
      }
    }
  }
  return result;
}

function buildRecentExposures(input: ProgressAnalyticsInput): CompactExposure[] {
  const nameById = new Map(input.exercises.map((exercise) => [exercise.exerciseId, exercise.name]));
  const recent: CompactExposure[] = [];
  for (const entry of input.exposures) {
    for (const exposure of entry.exposures) {
      if (exposure.outcome !== "attempted") continue;
      recent.push({
        exerciseId: entry.exerciseId,
        exerciseName: nameById.get(entry.exerciseId) ?? "Exercise",
        completedAt: exposure.completedAt,
        sets: exposure.sets,
      });
    }
  }
  return recent.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Database-backed builder
// ---------------------------------------------------------------------------

export async function buildProgressAnalytics(input: {
  userId: number;
  anchorDate?: Date;
}): Promise<ProgressAnalytics> {
  const anchorDate = input.anchorDate ?? new Date();
  const anchorDateISO = toISODate(anchorDate);
  const toleranceStartISO = addDaysToISODate(anchorDateISO, -28);

  const [profile, sessionRows, recoveryRows] = await Promise.all([
    getTrainingProfile(input.userId),
    db
      .select({
        sessionId: workoutSessions.id,
        startedAt: workoutSessions.startedAt,
        completedAt: workoutSessions.completedAt,
        status: workoutSessions.status,
        endReason: workoutSessions.endReason,
        overallRpe: workoutSessions.overallRpe,
        energyRating: workoutSessions.energyRating,
      })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, input.userId), ne(workoutSessions.status, "in_progress")))
      .orderBy(asc(workoutSessions.startedAt)),
    db
      .select({
        logDate: recoveryLogs.logDate,
        sleep: recoveryLogs.sleepRating,
        energy: recoveryLogs.energyRating,
        soreness: recoveryLogs.sorenessRating,
        jointPain: recoveryLogs.jointPainRating,
        stress: recoveryLogs.stressRating,
      })
      .from(recoveryLogs)
      .where(
        and(
          eq(recoveryLogs.userId, input.userId),
          gte(recoveryLogs.logDate, toleranceStartISO),
          lte(recoveryLogs.logDate, anchorDateISO),
        ),
      )
      .orderBy(asc(recoveryLogs.logDate)),
  ]);

  const sessionIds = sessionRows.map((row) => row.sessionId);
  const sessionExerciseRows = sessionIds.length
    ? await db
        .select({
          id: workoutSessionExercises.id,
          sessionId: workoutSessionExercises.workoutSessionId,
          exerciseId: workoutSessionExercises.exerciseId,
          status: workoutSessionExercises.status,
          skipReason: workoutSessionExercises.skipReason,
        })
        .from(workoutSessionExercises)
        .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds))
    : [];

  const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
  const setRows = sessionExerciseIds.length
    ? await db
        .select({
          sessionId: workoutSessionExercises.workoutSessionId,
          exerciseId: workoutSessionExercises.exerciseId,
          completedAt: workoutSessions.completedAt,
          weightKg: workoutSets.weightKg,
          reps: workoutSets.reps,
          rpe: workoutSets.rpe,
        })
        .from(workoutSets)
        .innerJoin(
          workoutSessionExercises,
          eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
        )
        .innerJoin(workoutSessions, eq(workoutSessionExercises.workoutSessionId, workoutSessions.id))
        .where(and(inArray(workoutSets.workoutSessionExerciseId, sessionExerciseIds), eq(workoutSets.setType, "working"), gt(workoutSets.reps, 0)))
        .orderBy(asc(workoutSessions.completedAt), asc(workoutSets.setNumber))
    : [];

  const exerciseIds = [...new Set(sessionExerciseRows.map((row) => row.exerciseId))];
  const exerciseRows: ExerciseMeta[] = exerciseIds.length
    ? await db
        .select({
          exerciseId: exercises.id,
          name: exercises.name,
          equipment: exercises.equipment,
          category: exercises.category,
          primaryMuscle: exercises.primaryMuscle,
          measurementType: exercises.measurementType,
        })
        .from(exercises)
        .where(inArray(exercises.id, exerciseIds))
    : [];

  const plannedSessions = await countPlannedSessions(input.userId, toleranceStartISO, anchorDateISO);

  const completedAtBySession = new Map<number, string>(
    sessionRows.map((row) => [row.sessionId, toISODate(row.completedAt ?? row.startedAt)]),
  );
  const setsByExerciseSession = new Map<string, { weightKg: number; reps: number; rpe: number | null }[]>();
  for (const set of setRows) {
    if (!set.completedAt) continue;
    const key = `${set.exerciseId}:${set.sessionId}`;
    const list = setsByExerciseSession.get(key) ?? [];
    list.push({ weightKg: set.weightKg, reps: set.reps, rpe: set.rpe });
    setsByExerciseSession.set(key, list);
  }

  const exposuresByExercise = new Map<number, ExerciseExposure[]>();
  for (const row of sessionExerciseRows) {
    const completedAt = completedAtBySession.get(row.sessionId) ?? anchorDateISO;
    const sets = setsByExerciseSession.get(`${row.exerciseId}:${row.sessionId}`) ?? [];
    const outcome = sets.length > 0 ? "attempted" : row.status === "skipped" ? "skipped" : "not_attempted";
    const exposure: ExerciseExposure = {
      sessionId: row.sessionId,
      completedAt,
      outcome,
      skipReason: row.skipReason,
      sets,
    };
    const list = exposuresByExercise.get(row.exerciseId) ?? [];
    list.push(exposure);
    exposuresByExercise.set(row.exerciseId, list);
  }

  const exposuresInput = exerciseIds.map((exerciseId) => ({
    exerciseId,
    exposures: exposuresByExercise.get(exerciseId) ?? [],
  }));

  const sessions: SessionRecord[] = sessionRows.map((row) => ({
    sessionId: row.sessionId,
    status: row.status as SessionRecord["status"],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    endReason: row.endReason,
    overallRpe: row.overallRpe,
    energyRating: row.energyRating,
  }));

  return assembleProgressAnalytics({
    userId: input.userId,
    anchorDateISO,
    profile: {
      experienceLevel: profile?.experienceLevel ?? null,
      yearsSinceTraining: profile?.yearsSinceTraining ?? null,
      desiredDaysPerWeek: profile?.desiredDaysPerWeek ?? null,
    },
    exercises: exerciseRows,
    exposures: exposuresInput,
    sessions,
    recovery: recoveryRows.map((row) => ({
      logDate: row.logDate,
      sleep: row.sleep,
      energy: row.energy,
      soreness: row.soreness,
      jointPain: row.jointPain,
      stress: row.stress,
    })),
    plannedSessions,
  });
}

async function countPlannedSessions(userId: number, fromISO: string, toISO: string): Promise<number | null> {
  const planRows = await db
    .select({ id: workoutPlans.id, startsOn: workoutPlans.startsOn })
    .from(workoutPlans)
    .where(eq(workoutPlans.userId, userId));
  if (planRows.length === 0) return null;

  const planIds = planRows.map((row) => row.id);
  // Only days that actually carry exercises count as planned training sessions.
  const dayRows = await db
    .select({
      workoutPlanId: workoutPlanDays.workoutPlanId,
      dayNumber: workoutPlanDays.dayNumber,
    })
    .from(workoutPlanDays)
    .innerJoin(workoutPlanExercises, eq(workoutPlanDays.id, workoutPlanExercises.workoutPlanDayId))
    .where(inArray(workoutPlanDays.workoutPlanId, planIds))
    .groupBy(workoutPlanDays.id);

  const planStarts = new Map(planRows.map((row) => [row.id, row.startsOn]));
  let count = 0;
  for (const day of dayRows) {
    const startsOn = planStarts.get(day.workoutPlanId);
    if (!startsOn) continue;
    const dateISO = addDaysToISODate(startsOn, day.dayNumber - 1);
    if (dateISO >= fromISO && dateISO <= toISO) count += 1;
  }
  return count;
}
