import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  recoveryLogs,
  users,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { summariseRecovery } from "./recovery";
import type {
  CompletedSet,
  ExerciseExposure,
  TrainingContext,
  TrainingContextExercise,
} from "./types";

/**
 * Loads only the facts a weekly coach needs, then compacts set history to the
 * four latest completed exposures per planned exercise. It is the single DB
 * boundary for both the local skill and a future provider-backed reasoner.
 */
export async function buildTrainingContext(
  userId: number,
  sourcePlanId: number,
): Promise<TrainingContext | null> {
  const [user, plan] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, sourcePlanId), eq(workoutPlans.userId, userId)))
      .limit(1),
  ]);
  if (!user[0] || !plan[0]) return null;

  const plannedRows = await db
    .select({
      sourcePlanExerciseId: workoutPlanExercises.id,
      sourcePlanDayId: workoutPlanDays.id,
      dayNumber: workoutPlanDays.dayNumber,
      dayName: workoutPlanDays.dayName,
      dayTitle: workoutPlanDays.title,
      position: workoutPlanExercises.position,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      equipment: exercises.equipment,
      targetSets: workoutPlanExercises.targetSets,
      minReps: workoutPlanExercises.minReps,
      maxReps: workoutPlanExercises.maxReps,
      targetRpe: workoutPlanExercises.targetRpe,
      suggestedWeightKg: workoutPlanExercises.suggestedWeightKg,
      restSeconds: workoutPlanExercises.restSeconds,
    })
    .from(workoutPlanExercises)
    .innerJoin(workoutPlanDays, eq(workoutPlanExercises.workoutPlanDayId, workoutPlanDays.id))
    .innerJoin(exercises, eq(workoutPlanExercises.exerciseId, exercises.id))
    .where(eq(workoutPlanDays.workoutPlanId, plan[0].id))
    .orderBy(asc(workoutPlanDays.dayNumber), asc(workoutPlanExercises.position));

  const sourceDayIds = [...new Set(plannedRows.map((row) => row.sourcePlanDayId))];
  const exerciseIds = [...new Set(plannedRows.map((row) => row.exerciseId))];
  const [sourceSessions, recoveryRows, historicalSetRows] = await Promise.all([
    sourceDayIds.length
      ? db
          .select({
            id: workoutSessions.id,
            workoutPlanDayId: workoutSessions.workoutPlanDayId,
            completedAt: workoutSessions.completedAt,
            status: workoutSessions.status,
            endReason: workoutSessions.endReason,
          })
          .from(workoutSessions)
          .where(inArray(workoutSessions.workoutPlanDayId, sourceDayIds))
      : Promise.resolve([]),
    db
      .select({
        sleep: recoveryLogs.sleepRating,
        energy: recoveryLogs.energyRating,
        soreness: recoveryLogs.sorenessRating,
        jointPain: recoveryLogs.jointPainRating,
        stress: recoveryLogs.stressRating,
        notes: recoveryLogs.notes,
      })
      .from(recoveryLogs)
      .where(eq(recoveryLogs.userId, userId))
      .orderBy(desc(recoveryLogs.logDate), desc(recoveryLogs.createdAt))
      .limit(12),
    exerciseIds.length
      ? db
          .select({
            exerciseId: workoutSessionExercises.exerciseId,
            sessionId: workoutSessions.id,
            workoutPlanDayId: workoutSessions.workoutPlanDayId,
            completedAt: workoutSessions.completedAt,
            setNumber: workoutSets.setNumber,
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
          .where(
            and(
              eq(workoutSessions.userId, userId),
              inArray(workoutSessionExercises.exerciseId, exerciseIds),
              eq(workoutSessions.status, "completed"),
            ),
          )
          .orderBy(desc(workoutSessions.completedAt), asc(workoutSets.setNumber))
          .limit(500)
      : Promise.resolve([]),
  ]);

  const sourceSessionIds = new Set(
    sourceSessions.filter((session) => session.status === "completed").map((session) => session.id),
  );
  const completedDayIds = new Set(
    sourceSessions
      .filter((session) => session.status === "completed")
      .map((session) => session.workoutPlanDayId),
  );
  // Map each source plan day to its calendar day number so a repeated exercise
  // can be evaluated against its own slot rather than the latest exposure.
  const dayNumberByDayId = new Map<number, number>(
    plannedRows.map((row) => [row.sourcePlanDayId, row.dayNumber]),
  );
  const exposuresByExercise = new Map<number, ExerciseExposure[]>();
  const exposureMap = new Map<string, ExerciseExposure>();
  for (const row of historicalSetRows) {
    if (!row.completedAt) continue;
    const key = `${row.exerciseId}:${row.sessionId}`;
    let exposure = exposureMap.get(key);
    if (!exposure) {
      exposure = {
        completedAt: row.completedAt.toISOString(),
        weightKg: null,
        sets: [],
        belongsToSourceWeek: sourceSessionIds.has(row.sessionId),
        dayNumber: dayNumberByDayId.get(row.workoutPlanDayId) ?? null,
      };
      exposureMap.set(key, exposure);
      const items = exposuresByExercise.get(row.exerciseId) ?? [];
      items.push(exposure);
      exposuresByExercise.set(row.exerciseId, items);
    }
    const set: CompletedSet = { weightKg: row.weightKg, reps: row.reps, rpe: row.rpe };
    exposure.sets.push(set);
    exposure.weightKg = row.weightKg;
  }

  const contextExercises: TrainingContextExercise[] = plannedRows.map((row) => ({
    ...row,
    recentExposures: (exposuresByExercise.get(row.exerciseId) ?? []).slice(0, 4),
  }));
  const plannedDayIds = new Set(sourceDayIds);
  const missedDays = [...plannedDayIds]
    .filter((id) => !completedDayIds.has(id))
    .map((id) => {
      const day = plannedRows.find((row) => row.sourcePlanDayId === id)!;
      return { dayNumber: day.dayNumber, dayName: day.dayName, title: day.dayTitle };
    });

  const sessionOutcomes = sourceSessions
    .filter((session) => session.status !== "in_progress")
    .map((session) => {
      const day = plannedRows.find((row) => row.sourcePlanDayId === session.workoutPlanDayId)!;
      return {
        dayNumber: day.dayNumber,
        dayName: day.dayName,
        title: day.dayTitle,
        status: session.status,
        endReason: session.endReason,
      };
    });

  return {
    user: user[0],
    sourcePlan: plan[0],
    exercises: contextExercises,
    plannedSessions: plannedDayIds.size,
    completedSessions: completedDayIds.size,
    missedDays,
    sessionOutcomes,
    recovery: summariseRecovery(recoveryRows),
  };
}
