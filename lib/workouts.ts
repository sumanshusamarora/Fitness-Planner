import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  exerciseMedia,
  exercises,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "../db/schema";
import { DomainError } from "./errors";
import { hasActualWork, requireInProgressSession } from "./session-guards";
import { formatDuration } from "./dates";
import { measurementTypeFor } from "./exercise-measurement";
import { getApprovedExternalReferences } from "./external-exercises";
import { sanitizeInstructionsHtml } from "./external-exercises/sanitize";
import { extractYoutubeVideoId } from "./media";
import {
  recommendNextWeight,
  type ProgressionResult,
  type RecoverySnapshot,
} from "./progression";
import { getLatestRecoverySnapshot } from "./recovery";

export interface PlanExercise {
  id: number;
  exerciseId: number;
  name: string;
  measurementType: string | null;
  category: string;
  equipment: string;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
}

export interface LastTimeSummary {
  weightKg: number | null;
  reps: string;
  rpe: number | null;
}

export interface ExerciseMedia {
  primaryImageUrl: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeTitle: string | null;
  articleUrl: string | null;
  articleTitle: string | null;
}

/** Approved external catalogue reference (already sanitized) for enrichment. */
export interface ExerciseExternalReference {
  provider: string;
  name: string;
  sourceUrl: string | null;
  instructionsHtml: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
}

export async function getExerciseMediaMap(
  exerciseIds: number[],
): Promise<Map<number, ExerciseMedia>> {
  const map = new Map<number, ExerciseMedia>();
  if (exerciseIds.length === 0) return map;

  const rows = await db
    .select()
    .from(exerciseMedia)
    .where(inArray(exerciseMedia.exerciseId, exerciseIds))
    .orderBy(asc(exerciseMedia.sortOrder), asc(exerciseMedia.id));

  for (const row of rows) {
    const m = map.get(row.exerciseId) ?? {
      primaryImageUrl: null,
      youtubeVideoId: null,
      youtubeUrl: null,
      youtubeTitle: null,
      articleUrl: null,
      articleTitle: null,
    };
    if (row.mediaType === "image" && (row.isPrimary || !m.primaryImageUrl)) {
      m.primaryImageUrl = row.url;
    }
    if (row.mediaType === "youtube" && !m.youtubeVideoId) {
      m.youtubeVideoId = row.youtubeVideoId ?? extractYoutubeVideoId(row.url);
      m.youtubeUrl = row.url;
      m.youtubeTitle = row.title;
    }
    if (row.mediaType === "article" && !m.articleUrl) {
      m.articleUrl = row.url;
      m.articleTitle = row.title;
    }
    map.set(row.exerciseId, m);
  }

  return map;
}

function buildExternalReference(
  reference:
    | {
        provider: string;
        name: string;
        sourceUrl: string | null;
        instructionsSource: string | null;
        videoUrl: string | null;
        imageUrl: string | null;
      }
    | undefined,
): ExerciseExternalReference | null {
  if (!reference) return null;
  return {
    provider: reference.provider,
    name: reference.name,
    sourceUrl: reference.sourceUrl,
    instructionsHtml: reference.instructionsSource
      ? sanitizeInstructionsHtml(reference.instructionsSource)
      : null,
    videoUrl: reference.videoUrl,
    imageUrl: reference.imageUrl,
  };
}

export async function getActivePlan(userId: number) {
  const rows = await db
    .select()
    .from(workoutPlans)
    .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.status, "active")))
    .orderBy(desc(workoutPlans.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPlanDay(planId: number, dayNumber: number) {
  const rows = await db
    .select()
    .from(workoutPlanDays)
    .where(
      and(
        eq(workoutPlanDays.workoutPlanId, planId),
        eq(workoutPlanDays.dayNumber, dayNumber),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getPlanExercises(planDayId: number): Promise<PlanExercise[]> {
  return db
    .select({
      id: workoutPlanExercises.id,
      exerciseId: exercises.id,
      name: exercises.name,
      measurementType: exercises.measurementType,
      category: exercises.category,
      equipment: exercises.equipment,
      position: workoutPlanExercises.position,
      targetSets: workoutPlanExercises.targetSets,
      minReps: workoutPlanExercises.minReps,
      maxReps: workoutPlanExercises.maxReps,
      targetRpe: workoutPlanExercises.targetRpe,
      suggestedWeightKg: workoutPlanExercises.suggestedWeightKg,
      restSeconds: workoutPlanExercises.restSeconds,
    })
    .from(workoutPlanExercises)
    .innerJoin(exercises, eq(workoutPlanExercises.exerciseId, exercises.id))
    .where(eq(workoutPlanExercises.workoutPlanDayId, planDayId))
    .orderBy(workoutPlanExercises.position);
}

export function estimateDurationMinutes(planExercises: PlanExercise[]): number {
  const seconds = planExercises.reduce(
    (acc, pe) => acc + pe.targetSets * (pe.restSeconds + 45),
    0,
  );
  return Math.max(1, Math.round(seconds / 60));
}

/** Sets from the most recent *completed* session for an exercise (user-scoped, working sets only). */
export async function getLastCompletedSets(userId: number, exerciseId: number) {
  const rows = await db
    .select({
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      rpe: workoutSets.rpe,
      setType: workoutSets.setType,
      sessionStartedAt: workoutSessions.startedAt,
    })
    .from(workoutSets)
    .innerJoin(
      workoutSessionExercises,
      eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
    )
    .innerJoin(
      workoutSessions,
      eq(workoutSessionExercises.workoutSessionId, workoutSessions.id),
    )
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessionExercises.exerciseId, exerciseId),
        eq(workoutSessions.status, "completed"),
        eq(workoutSets.setType, "working"),
      ),
    )
    .orderBy(desc(workoutSessions.startedAt), asc(workoutSets.setNumber));

  if (rows.length === 0) return [];

  const latest = rows[0].sessionStartedAt.getTime();
  return rows.filter((r) => r.sessionStartedAt.getTime() === latest);
}

export function summarizeLastTime(sets: {
  weightKg: number;
  reps: number;
  rpe: number | null;
}[]): LastTimeSummary | null {
  if (sets.length === 0) return null;
  const last = sets[sets.length - 1];
  return {
    weightKg: last.weightKg,
    reps: sets.map((s) => s.reps).join(" / "),
    rpe: last.rpe,
  };
}

export async function computeRecommendation(
  userId: number,
  planExercise: PlanExercise,
  recovery: RecoverySnapshot | null = null,
): Promise<ProgressionResult> {
  const lastSets = await getLastCompletedSets(userId, planExercise.exerciseId);
  return recommendNextWeight({
    targetSets: planExercise.targetSets,
    minReps: planExercise.minReps,
    maxReps: planExercise.maxReps,
    targetRpe: planExercise.targetRpe,
    lastWeightKg:
      lastSets.length > 0
        ? lastSets[lastSets.length - 1].weightKg
        : planExercise.suggestedWeightKg,
    lastSets: lastSets.map((s) => ({ reps: s.reps, rpe: s.rpe })),
    recovery,
  });
}

export async function createSession(userId: number, planDayId: number) {
  const planExercises = await getPlanExercises(planDayId);

  const [session] = await db
    .insert(workoutSessions)
    .values({ userId, workoutPlanDayId: planDayId })
    .returning();

  const recovery = await getLatestRecoverySnapshot(userId);
  for (const pe of planExercises) {
    const recommendation = await computeRecommendation(userId, pe, recovery);
    await db.insert(workoutSessionExercises).values({
      workoutSessionId: session.id,
      exerciseId: pe.exerciseId,
      position: pe.position,
      suggestedWeightKg: recommendation.recommendedWeight,
    });
  }

  return session;
}

/**
 * The single safe "Start" operation: resume an in-progress session for the
 * plan day if one exists, otherwise create one atomically. Rest days are
 * rejected. Approved "extra" workout days (which carry plan exercises) start
 * normally.
 *
 * Concurrency is handled two ways: the plan-day row is locked inside the
 * transaction so concurrent starts serialize, and the partial unique index
 * `workout_sessions_active_session_day_idx` makes a second in-progress session
 * for the same day impossible at the DB level.
 */
export async function startOrResumeSession(
  userId: number,
  planDayId: number,
): Promise<{ session: typeof workoutSessions.$inferSelect; created: boolean }> {
  return db.transaction(async (tx) => {
    const owned = (
      await tx
        .select({ id: workoutPlans.id })
        .from(workoutPlans)
        .innerJoin(
          workoutPlanDays,
          eq(workoutPlanDays.workoutPlanId, workoutPlans.id),
        )
        .where(
          and(eq(workoutPlanDays.id, planDayId), eq(workoutPlans.userId, userId)),
        )
        .limit(1)
    )[0];
    if (!owned) {
      throw new DomainError("Day not found.", "PLAN_DAY_NOT_FOUND", 404);
    }

    // Serialize concurrent Starts for the same day.
    await tx
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.id, planDayId))
      .for("update");

    const planExercises = await getPlanExercises(planDayId);
    if (planExercises.length === 0) {
      throw new DomainError(
        "Rest days can't be started as a workout.",
        "PLAN_DAY_IS_REST",
        409,
      );
    }

    const existing = (
      await tx
        .select()
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.workoutPlanDayId, planDayId),
            eq(workoutSessions.status, "in_progress"),
          ),
        )
        .orderBy(asc(workoutSessions.startedAt))
        .limit(1)
    )[0];
    if (existing) return { session: existing, created: false };

    try {
      const recovery = await getLatestRecoverySnapshot(userId);
      const [session] = await tx
        .insert(workoutSessions)
        .values({ userId, workoutPlanDayId: planDayId })
        .returning();
      for (const pe of planExercises) {
        const recommendation = await computeRecommendation(userId, pe, recovery);
        await tx.insert(workoutSessionExercises).values({
          workoutSessionId: session.id,
          exerciseId: pe.exerciseId,
          position: pe.position,
          suggestedWeightKg: recommendation.recommendedWeight,
        });
      }
      return { session, created: true };
    } catch (error) {
      // A second in-flight start hit the partial unique index: resume it.
      const resumed = (
        await tx
          .select()
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.workoutPlanDayId, planDayId),
              eq(workoutSessions.status, "in_progress"),
            ),
          )
          .limit(1)
      )[0];
      if (resumed) return { session: resumed, created: false };
      throw error;
    }
  });
}

export interface SessionExerciseData {
  sessionExerciseId: number;
  exerciseId: number;
  name: string;
  measurementType: string;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  restSeconds: number;
  suggestedWeightKg: number | null;
  lastTime: LastTimeSummary | null;
  recommendationReason: string | null;
  media: ExerciseMedia | null;
  externalReference: ExerciseExternalReference | null;
  loggedSets: {
    setNumber: number;
    weightKg: number;
    reps: number;
    rpe: number | null;
    setType: string;
  }[];
  status: "pending" | "completed" | "skipped" | "not_attempted" | "replaced";
  origin: "planned" | "added" | "replacement";
  replacementReason: string | null;
  skipReason: string | null;
}

export interface ActiveWorkoutData {
  sessionId: number;
  title: string;
  status: "in_progress" | "completed" | "ended_early" | "skipped";
  exercises: SessionExerciseData[];
}

export async function getActiveWorkoutData(
  userId: number,
  sessionId: number,
): Promise<ActiveWorkoutData | null> {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
      .limit(1)
  )[0];
  if (!session) return null;

  const planDay = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.id, session.workoutPlanDayId))
      .limit(1)
  )[0];

  const planExercises = await getPlanExercises(session.workoutPlanDayId);
  const sseRows = await db
    .select()
    .from(workoutSessionExercises)
    .where(eq(workoutSessionExercises.workoutSessionId, sessionId));

  const sseById = new Map(sseRows.map((row) => [row.id, row]));
  const sseByExercise = new Map(sseRows.map((row) => [row.exerciseId, row]));
  const planByExerciseId = new Map(planExercises.map((pe) => [pe.exerciseId, pe]));

  const extraExercises: { exerciseId: number; name: string; measurementType: string; sse: typeof sseRows[number] }[] = [];
  for (const sse of sseRows) {
    if ((sse.origin === "added" || sse.origin === "replacement") && !planByExerciseId.has(sse.exerciseId)) {
      const ex = (
        await db
          .select({
            name: exercises.name,
            measurementType: exercises.measurementType,
            category: exercises.category,
            equipment: exercises.equipment,
          })
          .from(exercises)
          .where(eq(exercises.id, sse.exerciseId))
          .limit(1)
      )[0];
      const name = ex?.name ?? "Exercise";
      extraExercises.push({
        exerciseId: sse.exerciseId,
        name,
        measurementType: measurementTypeFor({ measurementType: ex?.measurementType ?? null, category: ex?.category ?? null, equipment: ex?.equipment ?? null, name }),
        sse,
      });
    }
  }

  const allExerciseIds = [...new Set([...planExercises.map((pe) => pe.exerciseId), ...extraExercises.map((ex) => ex.exerciseId)])];
  const recovery = await getLatestRecoverySnapshot(userId);
  const mediaMap = await getExerciseMediaMap(allExerciseIds);
  const referenceMap = await getApprovedExternalReferences(allExerciseIds);

  async function buildExerciseData(input: {
    exerciseId: number;
    name: string;
    measurementType: string;
    position: number;
    targetSets: number;
    minReps: number;
    maxReps: number;
    targetRpe: number;
    restSeconds: number;
    suggestedWeightKg: number | null;
    sse: typeof sseRows[number] | undefined;
  }): Promise<SessionExerciseData> {
    const sets = input.sse
      ? await db
          .select({
            setNumber: workoutSets.setNumber,
            weightKg: workoutSets.weightKg,
            reps: workoutSets.reps,
            rpe: workoutSets.rpe,
            setType: workoutSets.setType,
          })
          .from(workoutSets)
          .where(eq(workoutSets.workoutSessionExerciseId, input.sse.id))
          .orderBy(asc(workoutSets.setNumber))
      : [];

    const lastSets = await getLastCompletedSets(userId, input.exerciseId);
    const recommendation = recommendNextWeight({
      targetSets: input.targetSets,
      minReps: input.minReps,
      maxReps: input.maxReps,
      targetRpe: input.targetRpe,
      lastWeightKg:
        lastSets.length > 0 ? lastSets[lastSets.length - 1].weightKg : input.suggestedWeightKg,
      lastSets: lastSets.map((s) => ({ reps: s.reps, rpe: s.rpe })),
      recovery,
    });

    return {
      sessionExerciseId: input.sse?.id ?? 0,
      exerciseId: input.exerciseId,
      name: input.name,
      measurementType: input.measurementType,
      position: input.position,
      targetSets: input.targetSets,
      minReps: input.minReps,
      maxReps: input.maxReps,
      targetRpe: input.targetRpe,
      restSeconds: input.restSeconds,
      suggestedWeightKg: recommendation.recommendedWeight,
      lastTime: summarizeLastTime(lastSets),
      recommendationReason: recommendation.reason,
      media: mediaMap.get(input.exerciseId) ?? null,
      externalReference: buildExternalReference(referenceMap.get(input.exerciseId)),
      loggedSets: sets,
      status: (input.sse?.status as SessionExerciseData["status"]) ?? "pending",
      origin: (input.sse?.origin as SessionExerciseData["origin"]) ?? "planned",
      replacementReason: input.sse?.replacementReason ?? null,
      skipReason: input.sse?.skipReason ?? null,
    };
  }

  const exercisesData: SessionExerciseData[] = [];
  for (const pe of planExercises) {
    exercisesData.push(
      await buildExerciseData({
        exerciseId: pe.exerciseId,
        name: pe.name,
        measurementType: measurementTypeFor({ measurementType: pe.measurementType, category: pe.category, equipment: pe.equipment, name: pe.name }),
        position: pe.position,
        targetSets: pe.targetSets,
        minReps: pe.minReps,
        maxReps: pe.maxReps,
        targetRpe: pe.targetRpe,
        restSeconds: pe.restSeconds,
        suggestedWeightKg: pe.suggestedWeightKg,
        sse: sseByExercise.get(pe.exerciseId),
      }),
    );
  }

  for (const extra of extraExercises) {
    const sse = extra.sse;
    let prescription = { targetSets: 3, minReps: 8, maxReps: 12, targetRpe: 6, restSeconds: 90, suggestedWeightKg: null as number | null };
    if (sse.origin === "replacement" && sse.replacesSessionExerciseId != null) {
      const original = sseById.get(sse.replacesSessionExerciseId);
      const planExercise = original ? planByExerciseId.get(original.exerciseId) : undefined;
      if (planExercise) {
        prescription = {
          targetSets: planExercise.targetSets,
          minReps: planExercise.minReps,
          maxReps: planExercise.maxReps,
          targetRpe: planExercise.targetRpe,
          restSeconds: planExercise.restSeconds,
          suggestedWeightKg: planExercise.suggestedWeightKg,
        };
      }
    }
    exercisesData.push(
      await buildExerciseData({
        exerciseId: extra.exerciseId,
        name: extra.name,
        measurementType: extra.measurementType,
        position: sse.position,
        targetSets: prescription.targetSets,
        minReps: prescription.minReps,
        maxReps: prescription.maxReps,
        targetRpe: prescription.targetRpe,
        restSeconds: prescription.restSeconds,
        suggestedWeightKg: prescription.suggestedWeightKg,
        sse,
      }),
    );
  }

  exercisesData.sort((a, b) => a.position - b.position);

  return {
    sessionId,
    title: planDay?.title ?? "Workout",
    status: session.status as ActiveWorkoutData["status"],
    exercises: exercisesData,
  };
}

export interface SessionSummary {
  id: number;
  title: string;
  startedAt: Date;
  completedAt: Date | null;
  status: "in_progress" | "completed" | "ended_early" | "skipped";
  endReason: string | null;
  exerciseCount: number;
  completedExerciseCount: number;
  skippedExerciseCount: number;
  notAttemptedExerciseCount: number;
  setCount: number;
  durationText: string;
  inProgress: boolean;
}

export async function getSessionSummary(
  userId: number,
  sessionId: number,
): Promise<SessionSummary | null> {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
      .limit(1)
  )[0];
  if (!session) return null;

  const planDay = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.id, session.workoutPlanDayId))
      .limit(1)
  )[0];

  const sseRows = await db
    .select({ status: workoutSessionExercises.status })
    .from(workoutSessionExercises)
    .where(eq(workoutSessionExercises.workoutSessionId, sessionId));

  const setCountRow = await db
    .select({ c: count() })
    .from(workoutSets)
    .innerJoin(
      workoutSessionExercises,
      eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
    )
    .where(eq(workoutSessionExercises.workoutSessionId, sessionId));

  const completedExerciseCount = sseRows.filter((r) => r.status === "completed").length;
  const skippedExerciseCount = sseRows.filter((r) => r.status === "skipped").length;
  const notAttemptedExerciseCount = sseRows.filter(
    (r) => r.status === "not_attempted",
  ).length;

  const end = session.completedAt ?? new Date();

  return {
    id: session.id,
    title: planDay?.title ?? "Workout",
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    status: session.status as SessionSummary["status"],
    endReason: session.endReason,
    exerciseCount: sseRows.length,
    completedExerciseCount,
    skippedExerciseCount,
    notAttemptedExerciseCount,
    setCount: setCountRow[0]?.c ?? 0,
    durationText: formatDuration(session.startedAt, end),
    inProgress: session.status === "in_progress",
  };
}

export interface HistoryEntry {
  id: number;
  title: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
}

export async function getSessionHistory(userId: number): Promise<HistoryEntry[]> {
  return db
    .select({
      id: workoutSessions.id,
      title: workoutPlanDays.title,
      startedAt: workoutSessions.startedAt,
      completedAt: workoutSessions.completedAt,
      status: workoutSessions.status,
    })
    .from(workoutSessions)
    .innerJoin(
      workoutPlanDays,
      eq(workoutSessions.workoutPlanDayId, workoutPlanDays.id),
    )
    .where(and(eq(workoutSessions.userId, userId), ne(workoutSessions.status, "in_progress")))
    .orderBy(desc(workoutSessions.startedAt));
}

export interface SessionDetailExercise {
  name: string;
  status: string | null;
  skipReason: string | null;
  origin: string | null;
  replacementReason: string | null;
  sets: {
    setNumber: number;
    weightKg: number;
    reps: number;
    rpe: number | null;
    setType: string;
  }[];
}

export interface SessionDetail {
  id: number;
  title: string;
  startedAt: Date;
  completedAt: Date;
  status: string;
  endReason: string | null;
  overallRpe: number | null;
  energyRating: string | null;
  durationText: string;
  exercises: SessionDetailExercise[];
  activities: {
    id: number;
    activityType: string;
    activityRole: string;
    name: string;
    durationSeconds: number | null;
  }[];
}

export async function getSessionDetail(
  userId: number,
  sessionId: number,
): Promise<SessionDetail | null> {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
      .limit(1)
  )[0];
  if (!session || session.status === "in_progress") return null;

  const planDay = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.id, session.workoutPlanDayId))
      .limit(1)
  )[0];

  const sseRows = await db
    .select()
    .from(workoutSessionExercises)
    .where(eq(workoutSessionExercises.workoutSessionId, sessionId))
    .orderBy(asc(workoutSessionExercises.position));

  const exercisesData: SessionDetailExercise[] = [];
  for (const sse of sseRows) {
    const ex = (
      await db
        .select({ name: exercises.name })
        .from(exercises)
        .where(eq(exercises.id, sse.exerciseId))
        .limit(1)
    )[0];
    const sets = await db
      .select({
        setNumber: workoutSets.setNumber,
        weightKg: workoutSets.weightKg,
        reps: workoutSets.reps,
        rpe: workoutSets.rpe,
        setType: workoutSets.setType,
      })
      .from(workoutSets)
      .where(eq(workoutSets.workoutSessionExerciseId, sse.id))
      .orderBy(asc(workoutSets.setNumber));

    exercisesData.push({
      name: ex?.name ?? "Exercise",
      status: sse.status,
      skipReason: sse.skipReason,
      origin: sse.origin,
      replacementReason: sse.replacementReason,
      sets,
    });
  }

  const activityRows = await db
    .select()
    .from(workoutSessionActivities)
    .where(eq(workoutSessionActivities.workoutSessionId, sessionId))
    .orderBy(asc(workoutSessionActivities.sortOrder));

  return {
    id: session.id,
    title: planDay?.title ?? "Workout",
    startedAt: session.startedAt,
    completedAt: session.completedAt ?? new Date(),
    status: session.status,
    endReason: session.endReason,
    overallRpe: session.overallRpe,
    energyRating: session.energyRating,
    durationText: formatDuration(session.startedAt, session.completedAt ?? new Date()),
    exercises: exercisesData,
    activities: activityRows.map((row) => ({
      id: row.id,
      activityType: row.activityType,
      activityRole: row.activityRole,
      name: row.nameSnapshot ?? "",
      durationSeconds: row.durationSeconds,
    })),
  };
}

async function requireOwnedSession(userId: number, sessionId: number) {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
      .limit(1)
  )[0];
  if (!session) throw new DomainError("Session not found.", "SESSION_NOT_FOUND", 404);
  return session;
}

/** Mutate an exercise outcome only while the session and exercise allow it. */
async function requireExecutor(
  session: typeof workoutSessions.$inferSelect,
  sessionExercise: typeof workoutSessionExercises.$inferSelect,
  allowedFrom: string[],
  error: string,
) {
  if (session.status !== "in_progress") {
    throw new DomainError(
      "This workout is already finalised; actual history is locked.",
      "SESSION_NOT_IN_PROGRESS",
      409,
    );
  }
  if (!allowedFrom.includes(sessionExercise.status)) {
    throw new DomainError(error, "EXERCISE_ALREADY_FINALIZED", 409);
  }
}

export async function completeSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
) {
  const session = await requireOwnedSession(userId, sessionId);
  const sse = (
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
  if (!sse) {
    throw new DomainError("Exercise not found in session.", "EXERCISE_NOT_FOUND", 404);
  }
  await requireExecutor(
    session,
    sse,
    ["pending"],
    "Only a pending exercise can be completed.",
  );
  return db
    .update(workoutSessionExercises)
    .set({ completed: true, status: "completed" })
    .where(eq(workoutSessionExercises.id, sse.id))
    .returning();
}

export async function skipSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
  reason: string,
) {
  const session = await requireOwnedSession(userId, sessionId);
  const sse = (
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
  if (!sse) {
    throw new DomainError("Exercise not found in session.", "EXERCISE_NOT_FOUND", 404);
  }
  await requireExecutor(
    session,
    sse,
    ["pending"],
    "Only a pending exercise can be skipped.",
  );
  return db
    .update(workoutSessionExercises)
    .set({ completed: false, status: "skipped", skipReason: reason })
    .where(eq(workoutSessionExercises.id, sse.id))
    .returning();
}

async function markRemainingNotAttempted(sessionId: number) {
  await db
    .update(workoutSessionExercises)
    .set({ status: "not_attempted" })
    .where(
      and(
        eq(workoutSessionExercises.workoutSessionId, sessionId),
        eq(workoutSessionExercises.status, "pending"),
      ),
    );
}

export async function finishSession(
  userId: number,
  sessionId: number,
  input: { energyRating?: string | null; overallRpe?: number | null },
) {
  const session = await requireOwnedSession(userId, sessionId);
  // Repeated submits are idempotent; they must not create a second outcome.
  if (session.status === "completed") return session;
  if (session.status !== "in_progress") {
    throw new DomainError(
      "You can only finish an active workout.",
      "SESSION_NOT_IN_PROGRESS",
      409,
    );
  }
  const [updated] = await db
    .update(workoutSessions)
    .set({
      status: "completed",
      completedAt: new Date(),
      energyRating: input.energyRating ?? null,
      overallRpe: input.overallRpe ?? null,
    })
    .where(
      and(
        eq(workoutSessions.id, sessionId),
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.status, "in_progress"),
      ),
    )
    .returning();
  await markRemainingNotAttempted(sessionId);
  return updated;
}

export async function endSessionEarly(
  userId: number,
  sessionId: number,
  input: { reason?: string | null; energyRating?: string | null; overallRpe?: number | null },
) {
  const session = await requireOwnedSession(userId, sessionId);
  // Repeated submits are idempotent; they must not create conflicting state.
  if (session.status === "ended_early") return session;
  if (session.status !== "in_progress") {
    throw new DomainError(
      "You can only end an active workout early.",
      "SESSION_NOT_IN_PROGRESS",
      409,
    );
  }
  const [updated] = await db
    .update(workoutSessions)
    .set({
      status: "ended_early",
      completedAt: new Date(),
      endReason: input.reason ?? null,
      energyRating: input.energyRating ?? null,
      overallRpe: input.overallRpe ?? null,
    })
    .where(
      and(
        eq(workoutSessions.id, sessionId),
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.status, "in_progress"),
      ),
    )
    .returning();
  await markRemainingNotAttempted(sessionId);
  return updated;
}

/**
 * Skip a prescribed workout that has not started. Rest days and optional
 * "extra" workouts are rejected (removing an extra is Phase 2.6B). Any
 * existing session for the day — in progress or terminal — blocks skipping.
 */
export async function skipPlannedSession(
  userId: number,
  planDayId: number,
  reason: string | null,
) {
  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.id, planDayId))
      .limit(1)
  )[0];
  if (!day) throw new DomainError("Day not found.", "PLAN_DAY_NOT_FOUND", 404);

  const plan = (
    await db
      .select({ id: workoutPlans.id })
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, day.workoutPlanId), eq(workoutPlans.userId, userId)))
      .limit(1)
  )[0];
  if (!plan) throw new DomainError("Day not found.", "PLAN_DAY_NOT_FOUND", 404);

  const [exerciseRows, existingSessions] = await Promise.all([
    db
      .select({ id: workoutPlanExercises.id })
      .from(workoutPlanExercises)
      .where(eq(workoutPlanExercises.workoutPlanDayId, planDayId)),
    db
      .select({ id: workoutSessions.id, status: workoutSessions.status })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.workoutPlanDayId, planDayId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1),
  ]);

  if (exerciseRows.length === 0) {
    throw new DomainError("Rest days can't be skipped.", "PLAN_DAY_IS_REST", 409);
  }

  if (existingSessions.length > 0) {
    const existing = existingSessions[0];
    if (existing.status === "in_progress") {
      throw new DomainError(
        "This workout is in progress. Resume or end it first.",
        "PLAN_DAY_ALREADY_STARTED",
        409,
      );
    }
    throw new DomainError(
      "This workout already has a recorded outcome.",
      "PLAN_DAY_ALREADY_STARTED",
      409,
    );
  }

  if (day.origin === "extra") {
    throw new DomainError(
      "Optional extra sessions can't be skipped; they can be removed instead.",
      "PLAN_DAY_IS_EXTRA",
      409,
    );
  }

  const [session] = await db
    .insert(workoutSessions)
    .values({
      userId,
      workoutPlanDayId: planDayId,
      status: "skipped",
      completedAt: new Date(),
      endReason: reason,
    })
    .returning();
  return session;
}

/**
 * Cancel an accidental, zero-work start. The session must be in_progress and
 * must carry no user-authored actual state. Automatically created pending
 * planned exercise rows are not actual work. On success the workout returns to
 * its unstarted state without creating any terminal history.
 */
export async function cancelEmptySession(userId: number, sessionId: number) {
  return db.transaction(async (tx) => {
    const session = await requireInProgressSession(userId, sessionId, tx);
    await tx
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, session.id))
      .for("update");

    if (await hasActualWork(tx, sessionId)) {
      throw new DomainError(
        "Work has already been logged; end the workout early instead.",
        "SESSION_HAS_ACTUAL_WORK",
        409,
      );
    }

    const exerciseIds = (
      await tx
        .select({ id: workoutSessionExercises.id })
        .from(workoutSessionExercises)
        .where(eq(workoutSessionExercises.workoutSessionId, sessionId))
    ).map((row) => row.id);
    if (exerciseIds.length > 0) {
      await tx
        .delete(workoutSessionExercises)
        .where(inArray(workoutSessionExercises.id, exerciseIds));
    }
    await tx
      .delete(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));

    return { cancelled: true };
  });
}

/**
 * Server-backed undo for a skipped exercise. Allowed only while the session is
 * still in_progress; a skipped exercise returns to pending and stays restored
 * after refresh. Once the session is terminal this is rejected.
 */
export async function restoreSkippedExercise(
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
        ),
      )
      .limit(1)
  )[0];
  if (!sse) {
    throw new DomainError("Exercise not found in session.", "EXERCISE_NOT_FOUND", 404);
  }
  if (sse.status !== "skipped") {
    throw new DomainError("This exercise is not skipped.", "EXERCISE_NOT_SKIPPED", 409);
  }

  const [row] = await db
    .update(workoutSessionExercises)
    .set({ status: "pending", skipReason: null, completed: false })
    .where(eq(workoutSessionExercises.id, sse.id))
    .returning();
  return row;
}
