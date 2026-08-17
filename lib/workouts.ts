import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
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
  users,
} from "../db/schema";
import { formatDuration } from "./dates";
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

export async function getSingleUser() {
  const rows = await db.select().from(users).orderBy(users.id).limit(1);
  return rows[0] ?? null;
}

export async function getActivePlan() {
  const rows = await db
    .select()
    .from(workoutPlans)
    .where(eq(workoutPlans.status, "active"))
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

/** Sets from the most recent *completed* session for an exercise. */
export async function getLastCompletedSets(exerciseId: number) {
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
        eq(workoutSessionExercises.exerciseId, exerciseId),
        isNotNull(workoutSessions.completedAt),
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
  planExercise: PlanExercise,
  recovery: RecoverySnapshot | null = null,
): Promise<ProgressionResult> {
  const lastSets = await getLastCompletedSets(planExercise.exerciseId);
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

  const recovery = await getLatestRecoverySnapshot();
  for (const pe of planExercises) {
    const recommendation = await computeRecommendation(pe, recovery);
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
  loggedSets: {
    setNumber: number;
    weightKg: number;
    reps: number;
    rpe: number | null;
  }[];
  completed: boolean;
}

export interface ActiveWorkoutData {
  sessionId: number;
  title: string;
  completed: boolean;
  exercises: SessionExerciseData[];
}

export async function getActiveWorkoutData(
  sessionId: number,
): Promise<ActiveWorkoutData | null> {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
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

  const recovery = await getLatestRecoverySnapshot();
  const mediaMap = await getExerciseMediaMap(
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

    const lastSets = await getLastCompletedSets(pe.exerciseId);
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
      loggedSets: sets,
      completed: sse?.completed ?? false,
    });
  }

  return {
    sessionId,
    title: planDay?.title ?? "Workout",
    completed: session.completedAt != null,
    exercises: exercisesData,
  };
}

export interface SessionSummary {
  id: number;
  title: string;
  startedAt: Date;
  completedAt: Date | null;
  exerciseCount: number;
  setCount: number;
  durationText: string;
  inProgress: boolean;
}

export async function getSessionSummary(
  sessionId: number,
): Promise<SessionSummary | null> {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
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

  const exerciseCountRow = await db
    .select({ c: count() })
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

  const end = session.completedAt ?? new Date();

  return {
    id: session.id,
    title: planDay?.title ?? "Workout",
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    exerciseCount: exerciseCountRow[0]?.c ?? 0,
    setCount: setCountRow[0]?.c ?? 0,
    durationText: formatDuration(session.startedAt, end),
    inProgress: session.completedAt == null,
  };
}

export interface HistoryEntry {
  id: number;
  title: string;
  startedAt: Date;
  completedAt: Date | null;
}

export async function getSessionHistory(): Promise<HistoryEntry[]> {
  return db
    .select({
      id: workoutSessions.id,
      title: workoutPlanDays.title,
      startedAt: workoutSessions.startedAt,
      completedAt: workoutSessions.completedAt,
    })
    .from(workoutSessions)
    .innerJoin(
      workoutPlanDays,
      eq(workoutSessions.workoutPlanDayId, workoutPlanDays.id),
    )
    .where(isNotNull(workoutSessions.completedAt))
    .orderBy(desc(workoutSessions.startedAt));
}

export interface SessionDetailExercise {
  name: string;
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
  overallRpe: number | null;
  energyRating: string | null;
  durationText: string;
  exercises: SessionDetailExercise[];
}

export async function getSessionDetail(
  sessionId: number,
): Promise<SessionDetail | null> {
  const session = (
    await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1)
  )[0];
  if (!session || session.completedAt == null) return null;

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
      sets,
    });
  }

  return {
    id: session.id,
    title: planDay?.title ?? "Workout",
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    overallRpe: session.overallRpe,
    energyRating: session.energyRating,
    durationText: formatDuration(session.startedAt, session.completedAt),
    exercises: exercisesData,
  };
}
