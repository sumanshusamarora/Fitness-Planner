import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workoutPlanDays, workoutPlans, workoutSessions } from "@/db/schema";

export interface SessionRouteContext {
  weekId: number;
  dayId: number;
  sessionId: number;
  status: string;
}

export interface DayRouteContext {
  weekId: number;
  dayId: number;
}

export async function resolveSessionRouteContext(
  userId: number,
  sessionId: number,
): Promise<SessionRouteContext | null> {
  const row = (
    await db
      .select({
        weekId: workoutPlans.id,
        dayId: workoutPlanDays.id,
        sessionId: workoutSessions.id,
        status: workoutSessions.status,
      })
      .from(workoutSessions)
      .innerJoin(
        workoutPlanDays,
        eq(workoutPlanDays.id, workoutSessions.workoutPlanDayId),
      )
      .innerJoin(
        workoutPlans,
        eq(workoutPlans.id, workoutPlanDays.workoutPlanId),
      )
      .where(
        and(
          eq(workoutSessions.id, sessionId),
          eq(workoutSessions.userId, userId),
          eq(workoutPlans.userId, userId),
        ),
      )
      .limit(1)
  )[0];

  if (!row) return null;
  return {
    weekId: row.weekId,
    dayId: row.dayId,
    sessionId: row.sessionId,
    status: row.status,
  };
}

export async function validateDayRouteContext(
  userId: number,
  weekId: number,
  dayId: number,
): Promise<DayRouteContext | null> {
  const row = (
    await db
      .select({ weekId: workoutPlans.id, dayId: workoutPlanDays.id })
      .from(workoutPlanDays)
      .innerJoin(workoutPlans, eq(workoutPlans.id, workoutPlanDays.workoutPlanId))
      .where(
        and(
          eq(workoutPlanDays.id, dayId),
          eq(workoutPlanDays.workoutPlanId, weekId),
          eq(workoutPlans.userId, userId),
        ),
      )
      .limit(1)
  )[0];

  if (!row) return null;
  return { weekId: row.weekId, dayId: row.dayId };
}

export async function validateSessionRouteContext(
  userId: number,
  weekId: number,
  dayId: number,
  sessionId: number,
): Promise<SessionRouteContext | null> {
  const row = (
    await db
      .select({
        weekId: workoutPlans.id,
        dayId: workoutPlanDays.id,
        sessionId: workoutSessions.id,
        status: workoutSessions.status,
      })
      .from(workoutSessions)
      .innerJoin(
        workoutPlanDays,
        eq(workoutPlanDays.id, workoutSessions.workoutPlanDayId),
      )
      .innerJoin(
        workoutPlans,
        eq(workoutPlans.id, workoutPlanDays.workoutPlanId),
      )
      .where(
        and(
          eq(workoutSessions.id, sessionId),
          eq(workoutSessions.workoutPlanDayId, dayId),
          eq(workoutPlanDays.workoutPlanId, weekId),
          eq(workoutSessions.userId, userId),
          eq(workoutPlans.userId, userId),
        ),
      )
      .limit(1)
  )[0];

  if (!row) return null;
  return {
    weekId: row.weekId,
    dayId: row.dayId,
    sessionId: row.sessionId,
    status: row.status,
  };
}
