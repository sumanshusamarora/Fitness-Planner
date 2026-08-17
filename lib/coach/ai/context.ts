import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  recoveryLogs,
  users,
  weeklyPlanProposals,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { addDaysToISODate, toISODate } from "@/lib/dates";
import { getLatestRecoverySnapshot } from "@/lib/recovery";
import { getTrainingProfile } from "@/lib/training-profile";
import type { RecoverySnapshot } from "@/lib/progression";
import { buildProgressAnalytics, type ProgressAnalytics } from "@/lib/progress";
import { buildRecentActualSummary, type RecentActualSummary } from "@/lib/session-activities";
import { parseWeeklyPlanProposal } from "../schemas";

/**
 * Rolling coaching context.
 *
 * Builds a compact past (14 days) / today / future (7 days) picture with
 * deterministically computed facts, so the model never has to count rows or
 * reason from raw database dumps. Pure assemblers are exported separately and
 * unit-tested without a database.
 */

export interface RollingWorkoutEntry {
  dateISO: string;
  dayName: string;
  title: string;
  status: "completed" | "ended_early" | "skipped";
  endReason: string | null;
  exerciseCount: number;
}

export interface RollingExercisePerformance {
  exerciseId: number;
  exerciseName: string;
  primaryMuscle: string;
  equipment: string;
  sets: number;
  latestWeightKg: number | null;
  latestReps: number;
  latestRpe: number | null;
  lastExposureDateISO: string | null;
  daysSinceLastExposure: number | null;
}

export interface PastTrainingSummary {
  windowDays: number;
  sessionsCompleted: number;
  sessionsEndedEarly: number;
  sessionsSkipped: number;
  plannedSessions: number;
  workouts: RollingWorkoutEntry[];
  setsByExercise: RollingExercisePerformance[];
  muscleSets: { muscle: string; sets: number }[];
  averageRpe: number | null;
  latestRpe: number | null;
  rpeTrend: "rising" | "falling" | "stable" | "insufficient_data";
  painFlags: boolean;
  meaningfulJointPainLatest: boolean;
}

export interface RollingRecoveryEntry {
  dateISO: string;
  sleep: number;
  energy: number;
  soreness: number;
  jointPain: number;
  stress: number;
}

export interface RollingFutureDay {
  dateISO: string;
  dayNumber: number;
  dayName: string;
  title: string | null;
  exerciseCount: number;
  muscles: string[];
  origin: "planned" | "extra" | "moved" | "proposed" | null;
}

export interface FutureWindowSummary {
  futurePlanKnown: boolean;
  days: RollingFutureDay[];
}

export interface RollingTodayState {
  dateISO: string;
  dayNumber: number;
  planned: { kind: "workout" | "rest"; title: string | null; exerciseCount: number } | null;
  latestRecovery: RecoverySnapshot | null;
  /** Current plan containing the anchor date, if any. */
  plan: { weekNumber: number } | null;
  /** Muscles trained on the day before / after the anchor date. */
  adjacentMuscles: string[];
}

export interface RollingCoachContext {
  generatedAt: string;
  anchorDateISO: string;
  user: { id: number };
  profile: {
    primaryGoal: string | null;
    experienceLevel: string | null;
    yearsSinceTraining: number | null;
    desiredDaysPerWeek: number | null;
    trainingEnvironment: string | null;
    sessionMinutes: string | null;
    equipmentNotes: string | null;
    limitationsNotes: string | null;
  };
  today: RollingTodayState;
  past: PastTrainingSummary;
  future: FutureWindowSummary;
  /** Longitudinal progress analytics (deterministic), added for the coach. */
  progress: ProgressAnalytics;
  /** Compact "what actually happened" facts (warm-up/cardio/mobility/added sets/replacements). */
  actual: RecentActualSummary;
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dayNameFor(dayNumber: number): string {
  return DAY_NAMES[dayNumber] ?? "";
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------------------
// Pure assemblers (unit-testable without a database)
// ---------------------------------------------------------------------------

export interface PastTrainingWindowInput {
  anchorDateISO: string;
  windowStartISO: string;
  sessions: RollingWorkoutEntry[];
  sets: {
    dateISO: string;
    exerciseId: number;
    exerciseName: string;
    primaryMuscle: string;
    equipment: string;
    weightKg: number;
    reps: number;
    rpe: number | null;
  }[];
  recovery: RollingRecoveryEntry[];
  plannedSessions: number;
}

export function assemblePastTraining(input: PastTrainingWindowInput): PastTrainingSummary {
  const completed = input.sessions.filter((s) => s.status === "completed").length;
  const endedEarly = input.sessions.filter((s) => s.status === "ended_early").length;
  const skipped = input.sessions.filter((s) => s.status === "skipped").length;

  const byExercise = new Map<number, RollingExercisePerformance>();
  const muscleSets = new Map<string, number>();
  const rpeValues: number[] = [];
  let latestRpe: number | null = null;
  let latestRpeDate = "";

  // Track exposures (one per exercise + date) to derive an RPE trend.
  const exposureRpes: { dateISO: string; rpe: number | null }[] = [];

  for (const set of input.sets) {
    const entry = byExercise.get(set.exerciseId) ?? {
      exerciseId: set.exerciseId,
      exerciseName: set.exerciseName,
      primaryMuscle: set.primaryMuscle,
      equipment: set.equipment,
      sets: 0,
      latestWeightKg: null,
      latestReps: 0,
      latestRpe: null,
      lastExposureDateISO: null,
      daysSinceLastExposure: null,
    };
    entry.sets += 1;
    if (set.rpe != null) rpeValues.push(set.rpe);
    if (set.dateISO > latestRpeDate || (set.dateISO === latestRpeDate && latestRpe == null)) {
      latestRpeDate = set.dateISO;
      latestRpe = set.rpe;
    }
    if (set.dateISO >= (entry.lastExposureDateISO ?? "")) {
      entry.lastExposureDateISO = set.dateISO;
      entry.latestWeightKg = set.weightKg;
      entry.latestReps = set.reps;
      entry.latestRpe = set.rpe;
    }
    byExercise.set(set.exerciseId, entry);
    muscleSets.set(set.primaryMuscle, (muscleSets.get(set.primaryMuscle) ?? 0) + 1);
    exposureRpes.push({ dateISO: set.dateISO, rpe: set.rpe });
  }

  const setsByExercise = [...byExercise.values()]
    .map((entry) => ({
      ...entry,
      daysSinceLastExposure:
        entry.lastExposureDateISO == null ? null : daysBetween(entry.lastExposureDateISO, input.anchorDateISO),
    }))
    .sort((a, b) => b.sets - a.sets);

  const muscleSetsSorted = [...muscleSets.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets);

  // RPE trend: average RPE per exposure date, compare the latest two dates.
  let rpeTrend: PastTrainingSummary["rpeTrend"] = "insufficient_data";
  const perDate = new Map<string, number[]>();
  for (const exposure of exposureRpes) {
    if (exposure.rpe == null) continue;
    const list = perDate.get(exposure.dateISO) ?? [];
    list.push(exposure.rpe);
    perDate.set(exposure.dateISO, list);
  }
  const dates = [...perDate.keys()].sort();
  if (dates.length >= 2) {
    const avg = (date: string) =>
      perDate.get(date)!.reduce((sum, n) => sum + n, 0) / perDate.get(date)!.length;
    const latest = avg(dates[dates.length - 1]);
    const previous = avg(dates[dates.length - 2]);
    if (latest > previous + 0.5) rpeTrend = "rising";
    else if (latest < previous - 0.5) rpeTrend = "falling";
    else rpeTrend = "stable";
  }

  const latestRecovery = input.recovery[input.recovery.length - 1] ?? null;

  return {
    windowDays: daysBetween(input.windowStartISO, input.anchorDateISO),
    sessionsCompleted: completed,
    sessionsEndedEarly: endedEarly,
    sessionsSkipped: skipped,
    plannedSessions: input.plannedSessions,
    workouts: [...input.sessions].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12),
    setsByExercise,
    muscleSets: muscleSetsSorted,
    averageRpe: rpeValues.length
      ? Math.round((rpeValues.reduce((sum, n) => sum + n, 0) / rpeValues.length) * 10) / 10
      : null,
    latestRpe,
    rpeTrend,
    painFlags: input.recovery.some((r) => r.jointPain >= 7),
    meaningfulJointPainLatest: latestRecovery != null && latestRecovery.jointPain >= 7,
  };
}

export interface FutureWindowInput {
  anchorDateISO: string;
  daysAhead: number;
  planDays: {
    dateISO: string;
    dayNumber: number;
    dayName: string;
    title: string;
    exerciseCount: number;
    muscles: string[];
    origin: string | null;
  }[];
  proposalWeeks: {
    startsOn: string;
    days: {
      dayNumber: number;
      dayName: string;
      title: string;
      exerciseCount: number;
      muscles: string[];
    }[];
  }[];
}

export function computeFutureWindow(input: FutureWindowInput): FutureWindowSummary {
  const byDate = new Map<string, RollingFutureDay>();
  for (const day of input.planDays) {
    if (day.dateISO <= input.anchorDateISO) continue;
    const origin: RollingFutureDay["origin"] =
      day.origin === "extra" || day.origin === "moved" ? day.origin : "planned";
    byDate.set(day.dateISO, {
      dateISO: day.dateISO,
      dayNumber: day.dayNumber,
      dayName: day.dayName,
      title: day.title,
      exerciseCount: day.exerciseCount,
      muscles: day.muscles,
      origin,
    });
  }
  for (const week of input.proposalWeeks) {
    for (const day of week.days) {
      if (day.exerciseCount === 0) continue;
      const dateISO = addDaysToISODate(week.startsOn, day.dayNumber - 1);
      if (dateISO <= input.anchorDateISO) continue;
      byDate.set(dateISO, {
        dateISO,
        dayNumber: day.dayNumber,
        dayName: day.dayName,
        title: day.title,
        exerciseCount: day.exerciseCount,
        muscles: day.muscles,
        origin: "proposed",
      });
    }
  }

  const days: RollingFutureDay[] = [];
  for (let offset = 1; offset <= input.daysAhead; offset++) {
    const dateISO = addDaysToISODate(input.anchorDateISO, offset);
    const entry = byDate.get(dateISO);
    if (entry) {
      days.push(entry);
    } else {
      const d = new Date(`${dateISO}T00:00:00Z`);
      const dayNumber = ((d.getUTCDay() + 6) % 7) + 1;
      days.push({
        dateISO,
        dayNumber,
        dayName: DAY_NAMES[dayNumber],
        title: null,
        exerciseCount: 0,
        muscles: [],
        origin: null,
      });
    }
  }

  return {
    futurePlanKnown: days.some((d) => d.title != null) || input.proposalWeeks.length > 0,
    days,
  };
}

// ---------------------------------------------------------------------------
// DB-backed builder
// ---------------------------------------------------------------------------

export async function buildRollingCoachContext(input: {
  userId: number;
  anchorDate?: Date;
  pastDays?: number;
  futureDays?: number;
}): Promise<RollingCoachContext> {
  const anchorDate = input.anchorDate ?? new Date();
  const pastDays = input.pastDays ?? 14;
  const futureDays = input.futureDays ?? 7;
  const anchorDateISO = toISODate(anchorDate);
  const windowStartISO = addDaysToISODate(anchorDateISO, -pastDays);
  const futureEndISO = addDaysToISODate(anchorDateISO, futureDays);

  const [user, profile, plans, proposalRows, sessionRows, setRows, recoveryRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, input.userId)).limit(1),
    getTrainingProfile(input.userId),
    db.select().from(workoutPlans).where(eq(workoutPlans.userId, input.userId)).orderBy(asc(workoutPlans.startsOn)),
    db
      .select()
      .from(weeklyPlanProposals)
      .where(
        and(
          eq(weeklyPlanProposals.userId, input.userId),
          inArray(weeklyPlanProposals.status, ["draft", "awaiting_input"]),
          inArray(weeklyPlanProposals.proposalType, ["next_week", "initial_week"]),
        ),
      )
      .orderBy(desc(weeklyPlanProposals.generatedAt)),
    db
      .select({
        workoutPlanDayId: workoutSessions.workoutPlanDayId,
        startedAt: workoutSessions.startedAt,
        completedAt: workoutSessions.completedAt,
        status: workoutSessions.status,
        endReason: workoutSessions.endReason,
        title: workoutPlanDays.title,
        dayNumber: workoutPlanDays.dayNumber,
      })
      .from(workoutSessions)
      .innerJoin(workoutPlanDays, eq(workoutSessions.workoutPlanDayId, workoutPlanDays.id))
      .where(
        and(
          eq(workoutSessions.userId, input.userId),
          ne(workoutSessions.status, "in_progress"),
          gte(workoutSessions.startedAt, new Date(`${windowStartISO}T00:00:00Z`)),
          lte(workoutSessions.startedAt, new Date(`${anchorDateISO}T23:59:59.999Z`)),
        ),
      )
      .orderBy(asc(workoutSessions.startedAt)),
    db
      .select({
        completedAt: workoutSessions.completedAt,
        exerciseId: exercises.id,
        exerciseName: exercises.name,
        primaryMuscle: exercises.primaryMuscle,
        equipment: exercises.equipment,
        weightKg: workoutSets.weightKg,
        reps: workoutSets.reps,
        rpe: workoutSets.rpe,
      })
      .from(workoutSets)
      .innerJoin(workoutSessionExercises, eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id))
      .innerJoin(workoutSessions, eq(workoutSessionExercises.workoutSessionId, workoutSessions.id))
      .innerJoin(exercises, eq(workoutSessionExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessions.userId, input.userId),
          eq(workoutSessions.status, "completed"),
          eq(workoutSets.setType, "working"),
          gte(workoutSessions.completedAt, new Date(`${windowStartISO}T00:00:00Z`)),
          lte(workoutSessions.completedAt, new Date(`${anchorDateISO}T23:59:59.999Z`)),
        ),
      )
      .orderBy(asc(workoutSessions.completedAt), asc(workoutSets.setNumber)),
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
          gte(recoveryLogs.logDate, windowStartISO),
          lte(recoveryLogs.logDate, anchorDateISO),
        ),
      )
      .orderBy(asc(recoveryLogs.logDate)),
  ]);

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const relevantPlanIds = plans
    .filter((plan) => {
      const end = addDaysToISODate(plan.startsOn, 6);
      return plan.startsOn <= futureEndISO && end >= windowStartISO;
    })
    .map((plan) => plan.id);

  const planDayRows = relevantPlanIds.length
    ? await db
        .select()
        .from(workoutPlanDays)
        .where(inArray(workoutPlanDays.workoutPlanId, relevantPlanIds))
        .orderBy(asc(workoutPlanDays.dayNumber))
    : [];

  const planDayIds = planDayRows.map((day) => day.id);
  const planExerciseRows = planDayIds.length
    ? await db
        .select({
          dayId: workoutPlanExercises.workoutPlanDayId,
          exerciseId: exercises.id,
          primaryMuscle: exercises.primaryMuscle,
        })
        .from(workoutPlanExercises)
        .innerJoin(exercises, eq(workoutPlanExercises.exerciseId, exercises.id))
        .where(inArray(workoutPlanExercises.workoutPlanDayId, planDayIds))
    : [];

  const musclesByPlanDayId = new Map<number, string[]>();
  const exerciseCountByDay = new Map<number, number>();
  for (const row of planExerciseRows) {
    const list = musclesByPlanDayId.get(row.dayId) ?? [];
    list.push(row.primaryMuscle);
    musclesByPlanDayId.set(row.dayId, list);
    exerciseCountByDay.set(row.dayId, (exerciseCountByDay.get(row.dayId) ?? 0) + 1);
  }

  const planDayByDate = new Map<string, { title: string; dayNumber: number; origin: string | null; dayId: number }>();
  for (const day of planDayRows) {
    const plan = planById.get(day.workoutPlanId);
    if (!plan) continue;
    const dateISO = addDaysToISODate(plan.startsOn, day.dayNumber - 1);
    planDayByDate.set(dateISO, { title: day.title, dayNumber: day.dayNumber, origin: day.origin, dayId: day.id });
  }

  // Exercises referenced by draft proposals, for muscle summaries.
  const proposalExerciseIds = new Set<number>();
  const proposalWeeks = [];
  for (const row of proposalRows) {
    try {
      const parsed = parseWeeklyPlanProposal(row.proposal);
      const end = addDaysToISODate(parsed.proposedStartsOn, 6);
      if (parsed.proposedStartsOn > futureEndISO || end < anchorDateISO) continue;
      for (const day of parsed.days) {
        for (const exercise of day.exercises) proposalExerciseIds.add(exercise.exerciseId);
      }
      proposalWeeks.push(parsed);
    } catch {
      // ignore malformed drafts
    }
  }
  const proposalMuscleById = new Map<number, string>();
  if (proposalExerciseIds.size > 0) {
    const rows = await db
      .select({ id: exercises.id, primaryMuscle: exercises.primaryMuscle })
      .from(exercises)
      .where(inArray(exercises.id, [...proposalExerciseIds]));
    for (const row of rows) proposalMuscleById.set(row.id, row.primaryMuscle);
  }

  const future = computeFutureWindow({
    anchorDateISO,
    daysAhead: futureDays,
    planDays: [...planDayByDate.entries()].map(([dateISO, info]) => ({
      dateISO,
      dayNumber: info.dayNumber,
      dayName: dayNameFor(info.dayNumber),
      title: info.title,
      exerciseCount: exerciseCountByDay.get(info.dayId) ?? 0,
      muscles: musclesByPlanDayId.get(info.dayId) ?? [],
      origin: info.origin,
    })),
    proposalWeeks: proposalWeeks.map((parsed) => ({
      startsOn: parsed.proposedStartsOn,
      days: parsed.days.map((day) => ({
        dayNumber: day.dayNumber,
        dayName: day.dayName,
        title: day.title,
        exerciseCount: day.exercises.length,
        muscles: day.exercises.map((ex) => proposalMuscleById.get(ex.exerciseId) ?? "").filter(Boolean),
      })),
    })),
  });

  const todayInfo = planDayByDate.get(anchorDateISO) ?? null;
  const planOnAnchor = plans.find(
    (plan) => plan.startsOn <= anchorDateISO && addDaysToISODate(plan.startsOn, 6) >= anchorDateISO,
  );

  const adjacentMuscles = new Set<string>();
  for (const offset of [-1, 1]) {
    const dateISO = addDaysToISODate(anchorDateISO, offset);
    const info = planDayByDate.get(dateISO);
    if (!info) continue;
    for (const muscle of musclesByPlanDayId.get(info.dayId) ?? []) adjacentMuscles.add(muscle);
  }

  const today: RollingTodayState = {
    dateISO: anchorDateISO,
    dayNumber: ((anchorDate.getDay() + 6) % 7) + 1,
    planned: todayInfo
      ? {
          kind: (exerciseCountByDay.get(todayInfo.dayId) ?? 0) > 0 ? "workout" : "rest",
          title: todayInfo.title,
          exerciseCount: exerciseCountByDay.get(todayInfo.dayId) ?? 0,
        }
      : null,
    latestRecovery: await getLatestRecoverySnapshot(input.userId),
    plan: planOnAnchor ? { weekNumber: planOnAnchor.weekNumber } : null,
    adjacentMuscles: [...adjacentMuscles],
  };

  const plannedWorkoutDaysInWindow = [...planDayByDate.values()].filter(
    (info) => (exerciseCountByDay.get(info.dayId) ?? 0) > 0,
  ).length;

  const sessions: RollingWorkoutEntry[] = sessionRows.map((row) => ({
    dateISO: toISODate(row.completedAt ?? row.startedAt),
    dayName: dayNameFor(row.dayNumber),
    title: row.title ?? "Workout",
    status: (row.status === "ended_early" || row.status === "skipped"
      ? row.status
      : "completed") as RollingWorkoutEntry["status"],
    endReason: row.endReason,
    exerciseCount: exerciseCountByDay.get(row.workoutPlanDayId) ?? 0,
  }));

  const past = assemblePastTraining({
    anchorDateISO,
    windowStartISO,
    sessions,
    sets: setRows
      .filter((row) => row.completedAt != null)
      .map((row) => ({
        dateISO: toISODate(row.completedAt!),
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        primaryMuscle: row.primaryMuscle,
        equipment: row.equipment,
        weightKg: row.weightKg,
        reps: row.reps,
        rpe: row.rpe,
      })),
    recovery: recoveryRows.map((row) => ({
      dateISO: row.logDate,
      sleep: row.sleep,
      energy: row.energy,
      soreness: row.soreness,
      jointPain: row.jointPain,
      stress: row.stress,
    })),
    plannedSessions: plannedWorkoutDaysInWindow,
  });

  return {
    generatedAt: new Date().toISOString(),
    anchorDateISO,
    user: { id: user[0]?.id ?? input.userId },
    profile: {
      primaryGoal: profile?.primaryGoal ?? null,
      experienceLevel: profile?.experienceLevel ?? null,
      yearsSinceTraining: profile?.yearsSinceTraining ?? null,
      desiredDaysPerWeek: profile?.desiredDaysPerWeek ?? null,
      trainingEnvironment: profile?.trainingEnvironment ?? null,
      sessionMinutes: profile?.sessionMinutes ?? null,
      equipmentNotes: profile?.equipmentNotes ?? null,
      limitationsNotes: profile?.limitationsNotes ?? null,
    },
    today,
    past,
    future,
    progress: await buildProgressAnalytics({ userId: input.userId, anchorDate }),
    actual: await buildRecentActualSummary(input.userId),
  };
}
