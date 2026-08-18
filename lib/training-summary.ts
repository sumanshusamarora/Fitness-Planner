import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  sessionPlanSnapshotExercises,
  sessionPlanSnapshots,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { addDaysToISODate, toISODate } from "@/lib/dates";

export type AdherenceSessionStatus = "none" | "in_progress" | "completed" | "ended_early" | "skipped";

export interface AdherenceOpportunity {
  dateISO: string;
  status: AdherenceSessionStatus;
}

export interface AdherenceSummary {
  prescribedSessions: number;
  completedPrescribedSessions: number;
  endedEarlyPrescribedSessions: number;
  skippedPrescribedSessions: number;
  inProgressPrescribedSessions: number;
  futurePrescribedSessions: number;
  pastDuePrescribedSessions: number;
  knownOpportunityPrescribedSessions: number;
  adherenceRate: number | null;
  adherencePercent: number | null;
}

export interface SessionPlanVsActualFact {
  sessionId: number;
  dateISO: string;
  isPrescribed: boolean;
  status: "in_progress" | "completed" | "ended_early" | "skipped";
  plannedWorkingSets: number;
  completedPlannedWorkingSets: number;
  extraWorkingSets: number;
  replacementWorkingSets: number;
  replacements: number;
  replacementReasons: string[];
  warmupMinutes: number;
  cardioMinutes: number;
  mobilityMinutes: number;
  cooldownMinutes: number;
  otherActivityMinutes: number;
}

export interface SessionPlanVsActualSummary extends SessionPlanVsActualFact {
  completedPlannedRatio: number | null;
}

export interface PlanVsActualSummary {
  sessions: SessionPlanVsActualSummary[];
  plannedWorkingSets: number;
  completedPlannedWorkingSets: number;
  extraWorkingSets: number;
  replacementWorkingSets: number;
  actualWorkingSets: number;
  replacements: number;
  replacementReasons: { reason: string; count: number }[];
  activityMinutes: {
    warmup: number;
    cardio: number;
    mobility: number;
    cooldown: number;
    other: number;
  };
  extraSessions: number;
}

export interface WeeklyActualSummary {
  adherence: AdherenceSummary;
  planVsActual: PlanVsActualSummary;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function statusCount(opportunities: AdherenceOpportunity[], status: AdherenceSessionStatus): number {
  return opportunities.filter((item) => item.status === status).length;
}

export function buildAdherenceSummary(input: {
  anchorDateISO: string;
  prescribedOpportunities: AdherenceOpportunity[];
}): AdherenceSummary {
  const completedPrescribedSessions = statusCount(input.prescribedOpportunities, "completed");
  const endedEarlyPrescribedSessions = statusCount(input.prescribedOpportunities, "ended_early");
  const skippedPrescribedSessions = statusCount(input.prescribedOpportunities, "skipped");
  const inProgressPrescribedSessions = statusCount(input.prescribedOpportunities, "in_progress");

  let futurePrescribedSessions = 0;
  let pastDuePrescribedSessions = 0;
  let knownOpportunityPrescribedSessions = 0;

  for (const item of input.prescribedOpportunities) {
    const terminal =
      item.status === "completed" || item.status === "ended_early" || item.status === "skipped";
    const opportunityPassed = item.dateISO < input.anchorDateISO;
    if (terminal || opportunityPassed) {
      knownOpportunityPrescribedSessions += 1;
    } else {
      futurePrescribedSessions += 1;
    }
    if (opportunityPassed && item.status === "none") {
      pastDuePrescribedSessions += 1;
    }
  }

  const adherenceRate =
    knownOpportunityPrescribedSessions > 0
      ? completedPrescribedSessions / knownOpportunityPrescribedSessions
      : null;

  return {
    prescribedSessions: input.prescribedOpportunities.length,
    completedPrescribedSessions,
    endedEarlyPrescribedSessions,
    skippedPrescribedSessions,
    inProgressPrescribedSessions,
    futurePrescribedSessions,
    pastDuePrescribedSessions,
    knownOpportunityPrescribedSessions,
    adherenceRate,
    adherencePercent: adherenceRate == null ? null : Math.round(adherenceRate * 100),
  };
}

export function buildPlanVsActualSummary(input: {
  sessions: SessionPlanVsActualFact[];
}): PlanVsActualSummary {
  const replacementReasons = new Map<string, number>();

  const sessions = input.sessions.map((session) => {
    for (const reason of session.replacementReasons) {
      replacementReasons.set(reason, (replacementReasons.get(reason) ?? 0) + 1);
    }
    const completedPlannedRatio =
      session.plannedWorkingSets > 0
        ? session.completedPlannedWorkingSets / session.plannedWorkingSets
        : null;
    return {
      ...session,
      completedPlannedRatio,
    };
  });

  const plannedWorkingSets = sessions.reduce((sum, session) => sum + session.plannedWorkingSets, 0);
  const completedPlannedWorkingSets = sessions.reduce(
    (sum, session) => sum + session.completedPlannedWorkingSets,
    0,
  );
  const extraWorkingSets = sessions.reduce((sum, session) => sum + session.extraWorkingSets, 0);
  const replacementWorkingSets = sessions.reduce(
    (sum, session) => sum + session.replacementWorkingSets,
    0,
  );
  const replacements = sessions.reduce((sum, session) => sum + session.replacements, 0);

  return {
    sessions,
    plannedWorkingSets,
    completedPlannedWorkingSets,
    extraWorkingSets,
    replacementWorkingSets,
    actualWorkingSets: completedPlannedWorkingSets + extraWorkingSets + replacementWorkingSets,
    replacements,
    replacementReasons: [...replacementReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    activityMinutes: {
      warmup: round1(sessions.reduce((sum, session) => sum + session.warmupMinutes, 0)),
      cardio: round1(sessions.reduce((sum, session) => sum + session.cardioMinutes, 0)),
      mobility: round1(sessions.reduce((sum, session) => sum + session.mobilityMinutes, 0)),
      cooldown: round1(sessions.reduce((sum, session) => sum + session.cooldownMinutes, 0)),
      other: round1(sessions.reduce((sum, session) => sum + session.otherActivityMinutes, 0)),
    },
    extraSessions: sessions.filter((session) => !session.isPrescribed).length,
  };
}

function minutes(seconds: number | null): number {
  if (seconds == null || seconds <= 0) return 0;
  return seconds / 60;
}

export async function buildWeeklyActualSummary(input: {
  userId: number;
  anchorDateISO: string;
  windowStartISO: string;
  windowEndISO?: string;
}): Promise<WeeklyActualSummary> {
  const windowEndISO = input.windowEndISO ?? input.anchorDateISO;
  const userPlans = await db
    .select({ id: workoutPlans.id, startsOn: workoutPlans.startsOn })
    .from(workoutPlans)
    .where(eq(workoutPlans.userId, input.userId));

  const planIds = userPlans.map((plan) => plan.id);
  const dayRows = planIds.length
    ? await db
        .select({
          id: workoutPlanDays.id,
          workoutPlanId: workoutPlanDays.workoutPlanId,
          dayNumber: workoutPlanDays.dayNumber,
          origin: workoutPlanDays.origin,
        })
        .from(workoutPlanDays)
        .innerJoin(workoutPlanExercises, eq(workoutPlanDays.id, workoutPlanExercises.workoutPlanDayId))
        .where(inArray(workoutPlanDays.workoutPlanId, planIds))
        .groupBy(workoutPlanDays.id)
    : [];

  const startsOnByPlanId = new Map(userPlans.map((plan) => [plan.id, plan.startsOn]));

  const dayFacts = dayRows
    .map((day) => {
      const startsOn = startsOnByPlanId.get(day.workoutPlanId);
      if (!startsOn) return null;
      const dateISO = addDaysToISODate(startsOn, day.dayNumber - 1);
      if (dateISO < input.windowStartISO || dateISO > windowEndISO) return null;
      return {
        dayId: day.id,
        dateISO,
        isPrescribed: day.origin !== "extra",
      };
    })
    .filter((row): row is { dayId: number; dateISO: string; isPrescribed: boolean } => row != null);

  const dayIds = dayFacts.map((day) => day.dayId);
  const sessionRows = dayIds.length
    ? await db
        .select({
          sessionId: workoutSessions.id,
          workoutPlanDayId: workoutSessions.workoutPlanDayId,
          startedAt: workoutSessions.startedAt,
          completedAt: workoutSessions.completedAt,
          status: workoutSessions.status,
        })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, input.userId), inArray(workoutSessions.workoutPlanDayId, dayIds)))
        .orderBy(asc(workoutSessions.startedAt))
    : [];

  const latestByDay = new Map<number, typeof sessionRows[number]>();
  for (const session of sessionRows) {
    latestByDay.set(session.workoutPlanDayId, session);
  }

  const prescribedOpportunities: AdherenceOpportunity[] = [];
  const sessionFacts: SessionPlanVsActualFact[] = [];

  const sessionIds = sessionRows.map((session) => session.sessionId);
  const snapshotRows = sessionIds.length
    ? await db
        .select({
          id: sessionPlanSnapshots.id,
          workoutSessionId: sessionPlanSnapshots.workoutSessionId,
        })
        .from(sessionPlanSnapshots)
        .where(inArray(sessionPlanSnapshots.workoutSessionId, sessionIds))
    : [];
  const snapshotIds = snapshotRows.map((row) => row.id);
  const snapshotSetRows = snapshotIds.length
    ? await db
        .select({
          snapshotId: sessionPlanSnapshotExercises.snapshotId,
          targetSets: sessionPlanSnapshotExercises.targetSets,
        })
        .from(sessionPlanSnapshotExercises)
        .where(inArray(sessionPlanSnapshotExercises.snapshotId, snapshotIds))
    : [];

  const sessionExerciseRows = sessionIds.length
    ? await db
        .select({
          id: workoutSessionExercises.id,
          workoutSessionId: workoutSessionExercises.workoutSessionId,
          origin: workoutSessionExercises.origin,
          replacementReason: workoutSessionExercises.replacementReason,
        })
        .from(workoutSessionExercises)
        .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds))
    : [];

  const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
  const workingSetRows = sessionExerciseIds.length
    ? await db
        .select({ workoutSessionExerciseId: workoutSets.workoutSessionExerciseId })
        .from(workoutSets)
        .where(and(inArray(workoutSets.workoutSessionExerciseId, sessionExerciseIds), eq(workoutSets.setType, "working")))
    : [];

  const activities = sessionIds.length
    ? await db
        .select({
          workoutSessionId: workoutSessionActivities.workoutSessionId,
          activityType: workoutSessionActivities.activityType,
          activityRole: workoutSessionActivities.activityRole,
          durationSeconds: workoutSessionActivities.durationSeconds,
        })
        .from(workoutSessionActivities)
        .where(inArray(workoutSessionActivities.workoutSessionId, sessionIds))
    : [];

  const workingBySse = new Map<number, number>();
  for (const set of workingSetRows) {
    workingBySse.set(set.workoutSessionExerciseId, (workingBySse.get(set.workoutSessionExerciseId) ?? 0) + 1);
  }

  const sessionDayById = new Map(dayFacts.map((day) => [day.dayId, day]));
  const sessionBySnapshotId = new Map(snapshotRows.map((row) => [row.id, row.workoutSessionId]));
  const expectedBySnapshotSession = new Map<number, number>();
  for (const row of snapshotSetRows) {
    const sessionId = sessionBySnapshotId.get(row.snapshotId);
    if (!sessionId) continue;
    expectedBySnapshotSession.set(
      sessionId,
      (expectedBySnapshotSession.get(sessionId) ?? 0) + row.targetSets,
    );
  }

  for (const day of dayFacts) {
    const latest = latestByDay.get(day.dayId);
    const status = (latest?.status ?? "none") as AdherenceSessionStatus;
    if (day.isPrescribed) {
      prescribedOpportunities.push({ dateISO: day.dateISO, status });
    }
  }

  const sessionExercisesBySession = new Map<number, typeof sessionExerciseRows>();
  for (const row of sessionExerciseRows) {
    const list = sessionExercisesBySession.get(row.workoutSessionId) ?? [];
    list.push(row);
    sessionExercisesBySession.set(row.workoutSessionId, list);
  }

  const activitiesBySession = new Map<number, typeof activities>();
  for (const activity of activities) {
    const list = activitiesBySession.get(activity.workoutSessionId) ?? [];
    list.push(activity);
    activitiesBySession.set(activity.workoutSessionId, list);
  }

  const expectedBySession = new Map<number, number>();
  if (sessionRows.length > 0) {
    const plannedByDay = dayIds.length
      ? await db
          .select({
            dayId: workoutPlanExercises.workoutPlanDayId,
            targetSets: workoutPlanExercises.targetSets,
          })
          .from(workoutPlanExercises)
          .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds))
      : [];
    const expectedByDay = new Map<number, number>();
    for (const row of plannedByDay) {
      expectedByDay.set(row.dayId, (expectedByDay.get(row.dayId) ?? 0) + row.targetSets);
    }
    for (const session of sessionRows) {
      expectedBySession.set(
        session.sessionId,
        expectedBySnapshotSession.get(session.sessionId) ??
          expectedByDay.get(session.workoutPlanDayId) ??
          0,
      );
    }
  }

  for (const session of sessionRows) {
    if (session.status === "in_progress") continue;
    const day = sessionDayById.get(session.workoutPlanDayId);
    if (!day) continue;

    const sseRows = sessionExercisesBySession.get(session.sessionId) ?? [];
    let completedPlannedWorkingSets = 0;
    let extraWorkingSets = 0;
    let replacementWorkingSets = 0;
    let replacements = 0;
    const replacementReasons: string[] = [];

    for (const sse of sseRows) {
      const working = workingBySse.get(sse.id) ?? 0;
      if (sse.origin === "added") {
        extraWorkingSets += working;
      } else if (sse.origin === "replacement") {
        replacementWorkingSets += working;
        replacements += 1;
        replacementReasons.push(sse.replacementReason ?? "other");
      } else {
        completedPlannedWorkingSets += working;
      }
    }

    let warmupMinutes = 0;
    let cardioMinutes = 0;
    let mobilityMinutes = 0;
    let cooldownMinutes = 0;
    let otherActivityMinutes = 0;

    for (const activity of activitiesBySession.get(session.sessionId) ?? []) {
      const mins = minutes(activity.durationSeconds);
      if (activity.activityRole === "warmup") warmupMinutes += mins;
      else if (activity.activityRole === "cooldown") cooldownMinutes += mins;
      else if (activity.activityType === "cardio") cardioMinutes += mins;
      else if (activity.activityType === "mobility" || activity.activityType === "stretching") mobilityMinutes += mins;
      else otherActivityMinutes += mins;
    }

    sessionFacts.push({
      sessionId: session.sessionId,
      dateISO: toISODate(session.completedAt ?? session.startedAt),
      isPrescribed: day.isPrescribed,
      status: session.status as SessionPlanVsActualFact["status"],
      plannedWorkingSets: expectedBySession.get(session.sessionId) ?? 0,
      completedPlannedWorkingSets,
      extraWorkingSets,
      replacementWorkingSets,
      replacements,
      replacementReasons,
      warmupMinutes: round1(warmupMinutes),
      cardioMinutes: round1(cardioMinutes),
      mobilityMinutes: round1(mobilityMinutes),
      cooldownMinutes: round1(cooldownMinutes),
      otherActivityMinutes: round1(otherActivityMinutes),
    });
  }

  return {
    adherence: buildAdherenceSummary({
      anchorDateISO: input.anchorDateISO,
      prescribedOpportunities,
    }),
    planVsActual: buildPlanVsActualSummary({ sessions: sessionFacts }),
  };
}
