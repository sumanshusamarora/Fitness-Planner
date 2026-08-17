import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  exerciseMedia,
  exercises,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "../db/schema";
import { formatDuration } from "./dates";
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

/** Sets from the most recent *completed* session for an exercise (user-scoped). */
export async function getLastCompletedSets(userId: number, exerciseId: number) {
  const rows = await db
    .select({
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      rpe: workoutSets.rpe,
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

export interface SessionExerciseData {
  sessionExerciseId: number;
  exerciseId: number;
  name: string;
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
  }[];
  status: "pending" | "completed" | "skipped" | "not_attempted";
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

  const sseByExercise = new Map(
    sseRows.map((row) => [row.exerciseId, row]),
  );

  const recovery = await getLatestRecoverySnapshot(userId);
  const mediaMap = await getExerciseMediaMap(
    planExercises.map((pe) => pe.exerciseId),
  );
  const referenceMap = await getApprovedExternalReferences(
    planExercises.map((pe) => pe.exerciseId),
  );

  const exercisesData: SessionExerciseData[] = [];
  for (const pe of planExercises) {
    const sse = sseByExercise.get(pe.exerciseId);
    const sets = sse
      ? await db
          .select({
            setNumber: workoutSets.setNumber,
            weightKg: workoutSets.weightKg,
            reps: workoutSets.reps,
            rpe: workoutSets.rpe,
          })
          .from(workoutSets)
          .where(eq(workoutSets.workoutSessionExerciseId, sse.id))
          .orderBy(asc(workoutSets.setNumber))
      : [];

    const lastSets = await getLastCompletedSets(userId, pe.exerciseId);
    const recommendation = recommendNextWeight({
      targetSets: pe.targetSets,
      minReps: pe.minReps,
      maxReps: pe.maxReps,
      targetRpe: pe.targetRpe,
      lastWeightKg:
        lastSets.length > 0
          ? lastSets[lastSets.length - 1].weightKg
          : pe.suggestedWeightKg,
      lastSets: lastSets.map((s) => ({ reps: s.reps, rpe: s.rpe })),
      recovery,
    });

    exercisesData.push({
      sessionExerciseId: sse?.id ?? 0,
      exerciseId: pe.exerciseId,
      name: pe.name,
      position: pe.position,
      targetSets: pe.targetSets,
      minReps: pe.minReps,
      maxReps: pe.maxReps,
      targetRpe: pe.targetRpe,
      restSeconds: pe.restSeconds,
      suggestedWeightKg: recommendation.recommendedWeight,
      lastTime: summarizeLastTime(lastSets),
      recommendationReason: recommendation.reason,
      media: mediaMap.get(pe.exerciseId) ?? null,
      externalReference: buildExternalReference(
        referenceMap.get(pe.exerciseId),
      ),
      loggedSets: sets,
      status: (sse?.status as SessionExerciseData["status"]) ?? "pending",
      skipReason: sse?.skipReason ?? null,
    });
  }

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
  sets: {
    setNumber: number;
    weightKg: number;
    reps: number;
    rpe: number | null;
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
      })
      .from(workoutSets)
      .where(eq(workoutSets.workoutSessionExerciseId, sse.id))
      .orderBy(asc(workoutSets.setNumber));

    exercisesData.push({
      name: ex?.name ?? "Exercise",
      status: sse.status,
      skipReason: sse.skipReason,
      sets,
    });
  }

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
  if (!session) throw new Error("Session not found.");
  return session;
}

export async function completeSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
) {
  await requireOwnedSession(userId, sessionId);
  return db
    .update(workoutSessionExercises)
    .set({ completed: true, status: "completed" })
    .where(
      and(
        eq(workoutSessionExercises.workoutSessionId, sessionId),
        eq(workoutSessionExercises.exerciseId, exerciseId),
      ),
    )
    .returning();
}

export async function skipSessionExercise(
  userId: number,
  sessionId: number,
  exerciseId: number,
  reason: string,
) {
  await requireOwnedSession(userId, sessionId);
  return db
    .update(workoutSessionExercises)
    .set({ completed: false, status: "skipped", skipReason: reason })
    .where(
      and(
        eq(workoutSessionExercises.workoutSessionId, sessionId),
        eq(workoutSessionExercises.exerciseId, exerciseId),
      ),
    )
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
  await requireOwnedSession(userId, sessionId);
  const [session] = await db
    .update(workoutSessions)
    .set({
      status: "completed",
      completedAt: new Date(),
      energyRating: input.energyRating ?? null,
      overallRpe: input.overallRpe ?? null,
    })
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
    .returning();
  await markRemainingNotAttempted(sessionId);
  return session;
}

export async function endSessionEarly(
  userId: number,
  sessionId: number,
  input: { reason?: string | null; energyRating?: string | null; overallRpe?: number | null },
) {
  await requireOwnedSession(userId, sessionId);
  const [session] = await db
    .update(workoutSessions)
    .set({
      status: "ended_early",
      completedAt: new Date(),
      endReason: input.reason ?? null,
      energyRating: input.energyRating ?? null,
      overallRpe: input.overallRpe ?? null,
    })
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
    .returning();
  await markRemainingNotAttempted(sessionId);
  return session;
}

export async function createSkippedSession(
  userId: number,
  planDayId: number,
  reason: string | null,
) {
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
