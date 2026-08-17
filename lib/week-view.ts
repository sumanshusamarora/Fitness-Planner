import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  planRevisions,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
} from "@/db/schema";
import { addDaysToISODate, toISODate } from "./dates";
import { hasActualWork } from "./session-guards";
import { getActivePlan } from "./workouts";
import type { PlanRevisionSnapshot } from "./plan-revisions";

export type DayStatus =
  | "completed"
  | "in-progress"
  | "ended_early"
  | "skipped"
  | "scheduled"
  | "rest"
  | "missed";

export interface WeekDayView {
  planDayId: number;
  dayNumber: number;
  dayName: string;
  title: string;
  dateISO: string;
  origin: "moved" | "extra" | null;
  exerciseCount: number;
  exerciseNames: string[];
  durationMinutes: number;
  status: DayStatus;
  sessionId: number | null;
  progressExercises: number;
  isToday: boolean;
  /** Head plan revision that would restore this day's move/swap, when legal. */
  restoreRevisionId: number | null;
  /** For an in-progress session: whether any actual work has been logged. */
  sessionHasActualWork: boolean;
}

export interface WeekView {
  planId: number;
  weekNumber: number;
  startsOn: string;
  planName: string;
  days: WeekDayView[];
  completedCount: number;
  endedEarlyCount: number;
  skippedCount: number;
  workoutCount: number;
  weekComplete: boolean;
  nextWeekExists: boolean;
}

export async function getWeekView(userId: number): Promise<WeekView | null> {
  const plan = await getActivePlan(userId);
  if (!plan) return null;

  const days = await db
    .select()
    .from(workoutPlanDays)
    .where(eq(workoutPlanDays.workoutPlanId, plan.id))
    .orderBy(asc(workoutPlanDays.dayNumber));

  const dayIds = days.map((d) => d.id);

  const [exerciseRows, sessionRows] = await Promise.all([
    dayIds.length
      ? db
          .select({
            dayId: workoutPlanExercises.workoutPlanDayId,
            name: exercises.name,
            targetSets: workoutPlanExercises.targetSets,
            restSeconds: workoutPlanExercises.restSeconds,
          })
          .from(workoutPlanExercises)
          .innerJoin(exercises, eq(workoutPlanExercises.exerciseId, exercises.id))
          .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds))
      : Promise.resolve([]),
    dayIds.length
      ? db
          .select({
            id: workoutSessions.id,
            dayId: workoutSessions.workoutPlanDayId,
            startedAt: workoutSessions.startedAt,
            completedAt: workoutSessions.completedAt,
            status: workoutSessions.status,
            endReason: workoutSessions.endReason,
          })
          .from(workoutSessions)
          .where(inArray(workoutSessions.workoutPlanDayId, dayIds))
          .orderBy(desc(workoutSessions.startedAt))
      : Promise.resolve([]),
  ]);

  const todayISO = toISODate(new Date());
  const exerciseCountByDay = new Map<number, { count: number; duration: number; names: string[] }>();
  for (const row of exerciseRows) {
    const entry = exerciseCountByDay.get(row.dayId) ?? { count: 0, duration: 0, names: [] };
    entry.count += 1;
    entry.duration += row.targetSets * (row.restSeconds + 45);
    entry.names.push(row.name);
    exerciseCountByDay.set(row.dayId, entry);
  }
  const sessionsByDay = new Map<number, typeof sessionRows>();
  for (const row of sessionRows) {
    const list = sessionsByDay.get(row.dayId) ?? [];
    list.push(row);
    sessionsByDay.set(row.dayId, list);
  }

  const sessionIds = sessionRows.map((s) => s.id);
  const sseRows = sessionIds.length
    ? await db
        .select({ sessionId: workoutSessionExercises.workoutSessionId, status: workoutSessionExercises.status })
        .from(workoutSessionExercises)
        .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds))
    : [];
  const doneBySession = new Map<number, number>();
  for (const row of sseRows) {
    if (row.status === "completed" || row.status === "skipped") {
      doneBySession.set(row.sessionId, (doneBySession.get(row.sessionId) ?? 0) + 1);
    }
  }

  // Restorable provenance: which day currently holds an un-restored move/swap.
  const activeRevisions = await db
    .select()
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.workoutPlanId, plan.id),
        inArray(planRevisions.kind, ["move", "swap"]),
      ),
    )
    .orderBy(desc(planRevisions.id));
  const restoreRevisionIdByDay = new Map<number, number>();
  for (const revision of activeRevisions) {
    if (revision.restoredAt != null) continue;
    const after = revision.afterSnapshot as unknown as PlanRevisionSnapshot;
    for (const day of after.days) {
      if (day.exercises.length > 0 && !restoreRevisionIdByDay.has(day.dayId)) {
        restoreRevisionIdByDay.set(day.dayId, revision.id);
      }
    }
  }

  // Whether each in-progress session has logged actual work (Cancel Start gate).
  const actualWorkBySession = new Map<number, boolean>();
  for (const row of sessionRows) {
    if (row.status === "in_progress") {
      actualWorkBySession.set(row.id, await hasActualWork(db, row.id));
    }
  }

  const viewDays: WeekDayView[] = days.map((day) => {
    const dateISO = addDaysToISODate(plan.startsOn, day.dayNumber - 1);
    const isToday = dateISO === todayISO;
    const isPast = dateISO < todayISO;
    const info = exerciseCountByDay.get(day.id) ?? { count: 0, duration: 0, names: [] as string[] };
    const sessions = sessionsByDay.get(day.id) ?? [];
    const completedSession = sessions.find((s) => s.status === "completed");
    const endedEarlySession = sessions.find((s) => s.status === "ended_early");
    const skippedSession = sessions.find((s) => s.status === "skipped");
    const activeSession = sessions.find((s) => s.status === "in_progress");

    let status: DayStatus = "rest";
    let sessionId: number | null = null;
    if (info.count > 0) {
      if (activeSession) {
        status = "in-progress";
        sessionId = activeSession.id;
      } else if (completedSession) {
        status = "completed";
        sessionId = completedSession.id;
      } else if (endedEarlySession) {
        status = "ended_early";
        sessionId = endedEarlySession.id;
      } else if (skippedSession) {
        status = "skipped";
        sessionId = skippedSession.id;
      } else if (isToday) {
        status = "scheduled";
      } else if (isPast) {
        status = "missed";
      } else {
        status = "scheduled";
      }
    }

    return {
      planDayId: day.id,
      dayNumber: day.dayNumber,
      dayName: day.dayName,
      title: day.title,
      dateISO,
      origin: (day.origin as "moved" | "extra" | null) ?? null,
      exerciseCount: info.count,
      exerciseNames: info.names,
      durationMinutes: Math.max(1, Math.round(info.duration / 60)),
      status,
      sessionId,
      progressExercises: sessionId ? (doneBySession.get(sessionId) ?? 0) : 0,
      isToday,
      restoreRevisionId: activeSession
        ? null
        : restoreRevisionIdByDay.get(day.id) ?? null,
      sessionHasActualWork: sessionId
        ? (actualWorkBySession.get(sessionId) ?? false)
        : false,
    };
  });

  const workoutCount = viewDays.filter((d) => d.exerciseCount > 0).length;
  const completedCount = viewDays.filter((d) => d.status === "completed").length;
  const endedEarlyCount = viewDays.filter((d) => d.status === "ended_early").length;
  const skippedCount = viewDays.filter((d) => d.status === "skipped").length;

  const nextPlan = await db
    .select({ id: workoutPlans.id })
    .from(workoutPlans)
    .where(
      and(
        eq(workoutPlans.userId, userId),
        eq(workoutPlans.weekNumber, plan.weekNumber + 1),
      ),
    )
    .limit(1);

  return {
    planId: plan.id,
    weekNumber: plan.weekNumber,
    startsOn: plan.startsOn,
    planName: plan.name,
    days: viewDays,
    completedCount,
    endedEarlyCount,
    skippedCount,
    workoutCount,
    weekComplete: workoutCount > 0 && completedCount >= workoutCount,
    nextWeekExists: nextPlan.length > 0,
  };
}
