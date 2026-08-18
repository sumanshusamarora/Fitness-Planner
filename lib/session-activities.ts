import { and, asc, count, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  sessionPlanSnapshotExercises,
  sessionPlanSnapshots,
  workoutPlanExercises,
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { measurementTypeFor, validateLoggedSet } from "@/lib/exercise-measurement";
import {
  recordInferredAvailabilityFromExerciseUse,
  recordInferredAvailabilityFromReplacement,
} from "@/lib/exercise-knowledge";
import { requireInProgressSession } from "@/lib/session-guards";

/**
 * Actual-session domain. A workout plan records what was prescribed; a workout
 * session records what actually happened. This module adds non-set activities
 * (cardio/mobility/stretching/warm-up/cool-down), unplanned resistance
 * exercises, and replacements, without rewriting planned history.
 */

export type ActivityType = "cardio" | "mobility" | "stretching" | "other";
export type ActivityRole = "warmup" | "cardio" | "mobility" | "cooldown" | "other";
export type ResistanceOrigin = "planned" | "added" | "replacement";
export type SetType = "warmup" | "working";

export const REPLACEMENT_REASONS = [
  "equipment_busy",
  "equipment_unavailable",
  "pain_discomfort",
  "preference",
  "coach_adjustment",
  "other",
] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

export interface SessionActivityInput {
  activityType: ActivityType;
  activityRole: ActivityRole;
  exerciseId: number | null;
  nameSnapshot: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  speed: number | null;
  inclinePercent: number | null;
  effortRpe: number | null;
  notes: string | null;
}

export async function addSessionActivity(
  userId: number,
  sessionId: number,
  input: SessionActivityInput,
) {
  await requireInProgressSession(userId, sessionId);
  const rows = await db
    .select({ sortOrder: workoutSessionActivities.sortOrder })
    .from(workoutSessionActivities)
    .where(eq(workoutSessionActivities.workoutSessionId, sessionId))
    .orderBy(asc(workoutSessionActivities.sortOrder));
  const sortOrder = rows.length ? (rows[rows.length - 1].sortOrder ?? 0) + 1 : 1;

  const [row] = await db
    .insert(workoutSessionActivities)
    .values({
      userId,
      workoutSessionId: sessionId,
      activityType: input.activityType,
      activityRole: input.activityRole,
      exerciseId: input.exerciseId,
      nameSnapshot: input.nameSnapshot,
      durationSeconds: input.durationSeconds,
      distanceMeters: input.distanceMeters,
      speed: input.speed,
      inclinePercent: input.inclinePercent,
      effortRpe: input.effortRpe,
      notes: input.notes,
      sortOrder,
    })
    .returning();
  return row;
}

export async function updateSessionActivity(
  userId: number,
  sessionId: number,
  activityId: number,
  input: Partial<SessionActivityInput>,
) {
  await requireInProgressSession(userId, sessionId);
  const existing = (
    await db
      .select()
      .from(workoutSessionActivities)
      .where(
        and(
          eq(workoutSessionActivities.id, activityId),
          eq(workoutSessionActivities.workoutSessionId, sessionId),
        ),
      )
      .limit(1)
  )[0];
  if (!existing) throw new Error("Activity not found.");

  const [row] = await db
    .update(workoutSessionActivities)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workoutSessionActivities.id, activityId))
    .returning();
  return row;
}

export async function removeSessionActivity(
  userId: number,
  sessionId: number,
  activityId: number,
) {
  await requireInProgressSession(userId, sessionId);
  await db
    .delete(workoutSessionActivities)
    .where(
      and(
        eq(workoutSessionActivities.id, activityId),
        eq(workoutSessionActivities.workoutSessionId, sessionId),
        eq(workoutSessionActivities.userId, userId),
      ),
    );
}

/** Add an unplanned resistance exercise to the session (origin: added). */
export async function addUnplannedExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
) {
  await requireInProgressSession(userId, sessionId);
  const exercise = (
    await db
      .select({ id: exercises.id, name: exercises.name, active: exercises.active })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1)
  )[0];
  if (!exercise || !exercise.active) throw new Error("Exercise not found.");

  const existing = await db
    .select({ position: workoutSessionExercises.position })
    .from(workoutSessionExercises)
    .where(eq(workoutSessionExercises.workoutSessionId, sessionId))
    .orderBy(asc(workoutSessionExercises.position));
  const position = existing.length ? (existing[existing.length - 1].position ?? 0) + 1 : 1;

  const [row] = await db
    .insert(workoutSessionExercises)
    .values({
      workoutSessionId: sessionId,
      exerciseId,
      position,
      suggestedWeightKg: null,
      completed: false,
      status: "pending",
      origin: "added",
    })
    .returning();
  return row;
}

/** Replace a pending planned exercise with another. Preserves the original. */
export async function replaceSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
  replacementExerciseId: number,
  reason: ReplacementReason,
) {
  await requireInProgressSession(userId, sessionId);
  if (exerciseId === replacementExerciseId) throw new Error("Choose a different exercise.");

  const planned = (
    await db
      .select()
      .from(workoutSessionExercises)
      .where(
        and(
          eq(workoutSessionExercises.workoutSessionId, sessionId),
          eq(workoutSessionExercises.exerciseId, exerciseId),
        ),
      )
      .limit(1)
  )[0];
  if (!planned) throw new Error("Exercise not found in session.");
  if (planned.origin !== "planned") {
    throw new Error("Only a planned exercise can be replaced.");
  }
  const plannedSets = (
    await db
      .select({ c: count() })
      .from(workoutSets)
      .where(eq(workoutSets.workoutSessionExerciseId, planned.id))
  )[0]?.c ?? 0;
  if (plannedSets > 0 || planned.status !== "pending") {
    throw new DomainError(
      "This exercise already has sets or was skipped; it can't be replaced. End the workout early instead.",
      "EXERCISE_ALREADY_FINALIZED",
      409,
    );
  }

  const replacement = (
    await db
      .select({ id: exercises.id, active: exercises.active })
      .from(exercises)
      .where(eq(exercises.id, replacementExerciseId))
      .limit(1)
  )[0];
  if (!replacement || !replacement.active) throw new Error("Replacement exercise not found.");

  const row = await db.transaction(async (tx) => {
    await tx
      .update(workoutSessionExercises)
      .set({ status: "replaced" })
      .where(eq(workoutSessionExercises.id, planned.id));

    const [row] = await tx
      .insert(workoutSessionExercises)
      .values({
        workoutSessionId: sessionId,
        exerciseId: replacementExerciseId,
        position: planned.position,
        suggestedWeightKg: planned.suggestedWeightKg,
        completed: false,
        status: "pending",
        origin: "replacement",
        replacementReason: reason,
        replacesSessionExerciseId: planned.id,
      })
      .returning();
    return row;
  });

  await recordInferredAvailabilityFromReplacement(
    userId,
    exerciseId,
    reason,
  );

  return row;
}

/**
 * Undo a replacement. Only allowed while the session is in_progress and the
 * replacement is empty: if the replacement has even one warm-up or working set,
 * restore is rejected and that logged work is never deleted.
 */
export async function restoreSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
) {
  await requireInProgressSession(userId, sessionId);
  const planned = (
    await db
      .select()
      .from(workoutSessionExercises)
      .where(
        and(
          eq(workoutSessionExercises.workoutSessionId, sessionId),
          eq(workoutSessionExercises.exerciseId, exerciseId),
          eq(workoutSessionExercises.status, "replaced"),
        ),
      )
      .limit(1)
  )[0];
  if (!planned) {
    throw new DomainError("No replacement to restore.", "NO_REPLACEMENT_TO_RESTORE", 409);
  }

  const replacement = (
    await db
      .select()
      .from(workoutSessionExercises)
      .where(eq(workoutSessionExercises.replacesSessionExerciseId, planned.id))
      .limit(1)
  )[0];

  return db.transaction(async (tx) => {
    const originalSetCount = (
      await tx
        .select({ c: count() })
        .from(workoutSets)
        .where(eq(workoutSets.workoutSessionExerciseId, planned.id))
    )[0]?.c ?? 0;
    if (originalSetCount > 0) {
      throw new DomainError(
        "The original already has logged work and can't be restored.",
        "ORIGINAL_HAS_ACTUAL_WORK",
        409,
      );
    }
    if (replacement) {
      const setCount = (
        await tx
          .select({ c: count() })
          .from(workoutSets)
          .where(eq(workoutSets.workoutSessionExerciseId, replacement.id))
      )[0]?.c ?? 0;
      if (setCount > 0) {
        throw new DomainError(
          "The replacement already has sets logged and can't be undone.",
          "REPLACEMENT_HAS_ACTUAL_WORK",
          409,
        );
      }
      await tx.delete(workoutSessionExercises).where(eq(workoutSessionExercises.id, replacement.id));
    }
    await tx
      .update(workoutSessionExercises)
      .set({ status: "pending" })
      .where(eq(workoutSessionExercises.id, planned.id));
  });
}

export interface LogSetInput {
  exerciseId: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  setType: SetType;
}

/**
 * Central set logger for a session exercise. Every actual set must be routed
 * here so the replaced-vs-live-state guards live in one place: the target row
 * must exist, the session must be in progress, and a replaced original whose
 * substitute now carries the load can never receive sets — log on the
 * replacement instead.
 */
export async function logSessionSet(
  userId: number,
  sessionId: number,
  input: LogSetInput,
) {
  await requireInProgressSession(userId, sessionId);

  const sse = (
    await db
      .select({
        id: workoutSessionExercises.id,
        status: workoutSessionExercises.status,
        exerciseId: workoutSessionExercises.exerciseId,
        measurementType: exercises.measurementType,
        category: exercises.category,
        equipment: exercises.equipment,
        name: exercises.name,
      })
      .from(workoutSessionExercises)
      .innerJoin(exercises, eq(workoutSessionExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessionExercises.workoutSessionId, sessionId),
          eq(workoutSessionExercises.exerciseId, input.exerciseId),
        ),
      )
      .limit(1)
  )[0];
  if (!sse) {
    throw new DomainError("Exercise not found in session.", "EXERCISE_NOT_FOUND", 404);
  }
  if (sse.status === "replaced") {
    throw new DomainError(
      "This exercise was replaced; log your sets on the replacement instead.",
      "EXERCISE_REPLACED",
      409,
    );
  }

  const measurementType = measurementTypeFor({
    measurementType: sse.measurementType,
    category: sse.category,
    equipment: sse.equipment,
    name: sse.name,
  });
  const validation = validateLoggedSet(measurementType, {
    weightKg: input.weightKg,
    reps: input.reps,
    rpe: input.rpe,
  });
  if (!validation.ok) {
    throw new DomainError(
      validation.error ?? "Invalid set data for this exercise.",
      "INVALID_SET_INPUT",
      400,
    );
  }

  const setCount = (
    await db
      .select({ c: count() })
      .from(workoutSets)
      .where(eq(workoutSets.workoutSessionExerciseId, sse.id))
  )[0]?.c ?? 0;

  const [set] = await db
    .insert(workoutSets)
    .values({
      workoutSessionExerciseId: sse.id,
      setNumber: setCount + 1,
      weightKg: input.weightKg,
      reps: input.reps,
      rpe: input.rpe,
      setType: input.setType,
    })
    .returning();

  if (input.setType === "working") {
    await recordInferredAvailabilityFromExerciseUse(userId, input.exerciseId);
  }

  return set;
}

export interface UpdateSessionSetInput {
  weightKg?: number;
  reps?: number;
  rpe?: number | null;
  setType?: SetType;
}

export async function updateSessionSet(
  userId: number,
  sessionId: number,
  setId: number,
  input: UpdateSessionSetInput,
) {
  await requireInProgressSession(userId, sessionId);

  const row = (
    await db
      .select({
        setId: workoutSets.id,
        weightKg: workoutSets.weightKg,
        reps: workoutSets.reps,
        rpe: workoutSets.rpe,
        measurementType: exercises.measurementType,
        category: exercises.category,
        equipment: exercises.equipment,
        name: exercises.name,
      })
      .from(workoutSets)
      .innerJoin(
        workoutSessionExercises,
        eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
      )
      .innerJoin(exercises, eq(workoutSessionExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSets.id, setId),
          eq(workoutSessionExercises.workoutSessionId, sessionId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new DomainError("Set not found.", "SET_NOT_FOUND", 404);
  }

  const nextSet = {
    weightKg: input.weightKg ?? row.weightKg,
    reps: input.reps ?? row.reps,
    rpe: input.rpe === undefined ? row.rpe : input.rpe,
  };
  const measurementType = measurementTypeFor({
    measurementType: row.measurementType,
    category: row.category,
    equipment: row.equipment,
    name: row.name,
  });
  const validation = validateLoggedSet(measurementType, nextSet);
  if (!validation.ok) {
    throw new DomainError(
      validation.error ?? "Invalid set data for this exercise.",
      "INVALID_SET_INPUT",
      400,
    );
  }

  const [updated] = await db
    .update(workoutSets)
    .set({
      ...(input.weightKg == null ? {} : { weightKg: input.weightKg }),
      ...(input.reps == null ? {} : { reps: input.reps }),
      ...(input.rpe === undefined ? {} : { rpe: input.rpe }),
      ...(input.setType == null ? {} : { setType: input.setType }),
    })
    .where(eq(workoutSets.id, setId))
    .returning();
  return updated;
}

export async function removeSessionSet(
  userId: number,
  sessionId: number,
  setId: number,
) {
  await requireInProgressSession(userId, sessionId);

  const row = (
    await db
      .select({
        setId: workoutSets.id,
        sseId: workoutSessionExercises.id,
      })
      .from(workoutSets)
      .innerJoin(
        workoutSessionExercises,
        eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
      )
      .where(
        and(
          eq(workoutSets.id, setId),
          eq(workoutSessionExercises.workoutSessionId, sessionId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new DomainError("Set not found.", "SET_NOT_FOUND", 404);
  }

  await db.transaction(async (tx) => {
    await tx.delete(workoutSets).where(eq(workoutSets.id, setId));
    const remaining = await tx
      .select({ id: workoutSets.id })
      .from(workoutSets)
      .where(eq(workoutSets.workoutSessionExerciseId, row.sseId))
      .orderBy(asc(workoutSets.setNumber));

    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(workoutSets)
        .set({ setNumber: i + 1 })
        .where(eq(workoutSets.id, remaining[i].id));
    }
  });
}

export async function removeAddedSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
) {
  await requireInProgressSession(userId, sessionId);

  const sse = (
    await db
      .select()
      .from(workoutSessionExercises)
      .where(
        and(
          eq(workoutSessionExercises.workoutSessionId, sessionId),
          eq(workoutSessionExercises.exerciseId, exerciseId),
          eq(workoutSessionExercises.origin, "added"),
        ),
      )
      .limit(1)
  )[0];
  if (!sse) {
    throw new DomainError("Added exercise not found.", "EXERCISE_NOT_FOUND", 404);
  }

  const setCount = (
    await db
      .select({ c: count() })
      .from(workoutSets)
      .where(eq(workoutSets.workoutSessionExerciseId, sse.id))
  )[0]?.c ?? 0;

  if (setCount > 0 || sse.status !== "pending") {
    throw new DomainError(
      "This added exercise already has actual work and cannot be removed.",
      "ADDED_EXERCISE_HAS_ACTUAL_WORK",
      409,
    );
  }

  await db.delete(workoutSessionExercises).where(eq(workoutSessionExercises.id, sse.id));
}

export interface SessionActivitySummary {
  workingResistanceSets: number;
  warmupSets: number;
  plannedExercisesCompleted: number;
  addedExercises: number;
  replacedExercises: number;
  warmupMinutes: number;
  cardioMinutes: number;
  mobilityMinutes: number;
  cooldownMinutes: number;
  extraWorkingSets: number;
  plannedWorkingSetsCompleted: number;
  plannedWorkingSetsExpected: number;
  replacementWorkingSets: number;
  activities: {
    id: number;
    activityType: ActivityType;
    activityRole: ActivityRole;
    name: string;
    durationSeconds: number | null;
    effortRpe: number | null;
    notes: string | null;
  }[];
}

function minutes(seconds: number | null): number {
  if (seconds == null || seconds <= 0) return 0;
  return Math.round((seconds / 60) * 10) / 10;
}

export async function buildSessionActivitySummary(
  userId: number,
  sessionId: number,
): Promise<SessionActivitySummary> {
  const session = (
    await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.id, sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1)
  )[0];
  if (!session) throw new DomainError("Session not found.", "SESSION_NOT_FOUND", 404);

  const [sseRows, activityRows] = await Promise.all([
    db
      .select({
        id: workoutSessionExercises.id,
        exerciseId: workoutSessionExercises.exerciseId,
        status: workoutSessionExercises.status,
        origin: workoutSessionExercises.origin,
        name: exercises.name,
      })
      .from(workoutSessionExercises)
      .innerJoin(exercises, eq(workoutSessionExercises.exerciseId, exercises.id))
      .where(eq(workoutSessionExercises.workoutSessionId, sessionId))
      .orderBy(asc(workoutSessionExercises.position)),
    db
      .select()
      .from(workoutSessionActivities)
      .where(eq(workoutSessionActivities.workoutSessionId, sessionId))
      .orderBy(asc(workoutSessionActivities.sortOrder)),
  ]);

  const sseIds = sseRows.map((row) => row.id);
  const [workingSets, warmupSets] = sseIds.length
    ? await Promise.all([
        db
          .select({ workoutSessionExerciseId: workoutSets.workoutSessionExerciseId })
          .from(workoutSets)
          .where(and(inArray(workoutSets.workoutSessionExerciseId, sseIds), eq(workoutSets.setType, "working"))),
        db
          .select({ workoutSessionExerciseId: workoutSets.workoutSessionExerciseId })
          .from(workoutSets)
          .where(and(inArray(workoutSets.workoutSessionExerciseId, sseIds), eq(workoutSets.setType, "warmup"))),
      ])
    : [[], []];

  const workingBySse = new Map<number, number>();
  for (const set of workingSets) {
    workingBySse.set(set.workoutSessionExerciseId, (workingBySse.get(set.workoutSessionExerciseId) ?? 0) + 1);
  }

  // Planned working-set expectation comes from the session-start prescription
  // snapshot (frozen), falling back to the live plan for legacy sessions.
  const sessionRow = (
    await db
      .select({ workoutPlanDayId: workoutSessions.workoutPlanDayId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1)
  )[0];
  let plannedWorkingSetsExpected = 0;
  if (sessionRow?.workoutPlanDayId) {
    const snapshot = (
      await db
        .select({ id: sessionPlanSnapshots.id })
        .from(sessionPlanSnapshots)
        .where(eq(sessionPlanSnapshots.workoutSessionId, sessionId))
        .limit(1)
    )[0];
    if (snapshot) {
      const snapshotRows = await db
        .select({ targetSets: sessionPlanSnapshotExercises.targetSets })
        .from(sessionPlanSnapshotExercises)
        .where(eq(sessionPlanSnapshotExercises.snapshotId, snapshot.id));
      plannedWorkingSetsExpected = snapshotRows.reduce(
        (sum, row) => sum + row.targetSets,
        0,
      );
    } else {
      const planExerciseRows = await db
        .select({ targetSets: workoutPlanExercises.targetSets })
        .from(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, sessionRow.workoutPlanDayId));
      plannedWorkingSetsExpected = planExerciseRows.reduce((sum, row) => sum + row.targetSets, 0);
    }
  }

  let plannedWorkingSetsCompleted = 0;
  let extraWorkingSets = 0;
  let replacementWorkingSets = 0;
  let plannedExercisesCompleted = 0;
  let addedExercises = 0;
  let replacedExercises = 0;

  for (const row of sseRows) {
    const working = workingBySse.get(row.id) ?? 0;
    if (row.origin === "added") {
      addedExercises += 1;
      extraWorkingSets += working;
    } else if (row.origin === "replacement") {
      replacedExercises += 1;
      replacementWorkingSets += working;
    } else {
      plannedWorkingSetsCompleted += working;
      if (row.status === "completed") plannedExercisesCompleted += 1;
    }
  }

  let warmupMinutes = 0;
  let cardioMinutes = 0;
  let mobilityMinutes = 0;
  let cooldownMinutes = 0;

  const activities = activityRows.map((row) => {
    const name = row.nameSnapshot ?? "";
    const mins = minutes(row.durationSeconds);
    if (row.activityRole === "warmup") warmupMinutes += mins;
    else if (row.activityRole === "cooldown") cooldownMinutes += mins;
    else if (row.activityType === "cardio") cardioMinutes += mins;
    else if (row.activityType === "mobility" || row.activityType === "stretching") mobilityMinutes += mins;
    return {
      id: row.id,
      activityType: row.activityType as ActivityType,
      activityRole: row.activityRole as ActivityRole,
      name,
      durationSeconds: row.durationSeconds,
      effortRpe: row.effortRpe,
      notes: row.notes,
    };
  });

  return {
    workingResistanceSets: plannedWorkingSetsCompleted + extraWorkingSets + replacementWorkingSets,
    warmupSets: warmupSets.length,
    plannedExercisesCompleted,
    addedExercises,
    replacedExercises,
    warmupMinutes,
    cardioMinutes,
    mobilityMinutes,
    cooldownMinutes,
    extraWorkingSets,
    plannedWorkingSetsCompleted,
    plannedWorkingSetsExpected,
    replacementWorkingSets,
    activities,
  };
}

export interface ReplacementPattern {
  plannedExercise: string;
  actualExercise: string;
  reason: string;
  count: number;
}

export interface RecentActualSummary {
  warmupMinutes: number;
  cardioMinutes: number;
  mobilityMinutes: number;
  cooldownMinutes: number;
  extraWorkingSets: number;
  replacementWorkingSets: number;
  addedExercises: number;
  replacements: ReplacementPattern[];
}

/** Compact recent "what actually happened" facts for the coach (user-scoped). */
export async function buildRecentActualSummary(
  userId: number,
  windowDays = 14,
): Promise<RecentActualSummary> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const sessions = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        inArray(workoutSessions.status, ["completed", "ended_early"]),
        gte(workoutSessions.completedAt, since),
      ),
    );
  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length === 0) {
    return {
      warmupMinutes: 0,
      cardioMinutes: 0,
      mobilityMinutes: 0,
      cooldownMinutes: 0,
      extraWorkingSets: 0,
      replacementWorkingSets: 0,
      addedExercises: 0,
      replacements: [],
    };
  }

  const [activities, sseRows] = await Promise.all([
    db
      .select()
      .from(workoutSessionActivities)
      .where(inArray(workoutSessionActivities.workoutSessionId, sessionIds)),
    db
      .select({
        id: workoutSessionExercises.id,
        exerciseId: workoutSessionExercises.exerciseId,
        origin: workoutSessionExercises.origin,
        replacementReason: workoutSessionExercises.replacementReason,
        replacesSessionExerciseId: workoutSessionExercises.replacesSessionExerciseId,
      })
      .from(workoutSessionExercises)
      .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds)),
  ]);

  const sseIds = sseRows.map((r) => r.id);
  const workingSets = sseIds.length
    ? await db
        .select({ workoutSessionExerciseId: workoutSets.workoutSessionExerciseId })
        .from(workoutSets)
        .where(and(inArray(workoutSets.workoutSessionExerciseId, sseIds), eq(workoutSets.setType, "working")))
    : [];
  const workingBySse = new Map<number, number>();
  for (const set of workingSets) {
    workingBySse.set(set.workoutSessionExerciseId, (workingBySse.get(set.workoutSessionExerciseId) ?? 0) + 1);
  }

  let warmupMinutes = 0;
  let cardioMinutes = 0;
  let mobilityMinutes = 0;
  let cooldownMinutes = 0;
  for (const activity of activities) {
    const mins = activity.durationSeconds != null ? activity.durationSeconds / 60 : 0;
    if (activity.activityRole === "warmup") warmupMinutes += mins;
    else if (activity.activityRole === "cooldown") cooldownMinutes += mins;
    else if (activity.activityType === "cardio") cardioMinutes += mins;
    else if (activity.activityType === "mobility" || activity.activityType === "stretching") mobilityMinutes += mins;
  }

  let extraWorkingSets = 0;
  let replacementWorkingSets = 0;
  let addedExercises = 0;
  const replacementsByKey = new Map<string, ReplacementPattern>();

  for (const row of sseRows) {
    const working = workingBySse.get(row.id) ?? 0;
    if (row.origin === "added") {
      addedExercises += 1;
      extraWorkingSets += working;
    } else if (row.origin === "replacement") {
      replacementWorkingSets += working;
      const key = `${row.replacesSessionExerciseId}:${row.exerciseId}`;
      const existing = replacementsByKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        const [planned, actual] = await Promise.all([
          row.replacesSessionExerciseId
            ? db
                .select({ name: exercises.name })
                .from(workoutSessionExercises)
                .innerJoin(exercises, eq(workoutSessionExercises.exerciseId, exercises.id))
                .where(eq(workoutSessionExercises.id, row.replacesSessionExerciseId))
                .limit(1)
            : Promise.resolve([]),
          db
            .select({ name: exercises.name })
            .from(exercises)
            .where(eq(exercises.id, row.exerciseId))
            .limit(1),
        ]);
        replacementsByKey.set(key, {
          plannedExercise: planned[0]?.name ?? "Unknown",
          actualExercise: actual[0]?.name ?? "Unknown",
          reason: row.replacementReason ?? "other",
          count: 1,
        });
      }
    }
  }

  return {
    warmupMinutes: Math.round(warmupMinutes * 10) / 10,
    cardioMinutes: Math.round(cardioMinutes * 10) / 10,
    mobilityMinutes: Math.round(mobilityMinutes * 10) / 10,
    cooldownMinutes: Math.round(cooldownMinutes * 10) / 10,
    extraWorkingSets,
    replacementWorkingSets,
    addedExercises,
    replacements: [...replacementsByKey.values()],
  };
}
