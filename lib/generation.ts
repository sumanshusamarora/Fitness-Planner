import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workoutPlanDays, workoutPlans, workoutSessions } from "@/db/schema";
import { applyProposal } from "@/lib/coach/applyProposal";
import type { ProposalDecision } from "@/lib/coach/types";
import { getPlanExercises } from "@/lib/workouts";

/**
 * Compatibility entry point for callers that previously generated a week.
 * It now requires an existing proposal plus explicit approval.
 */
export async function generateNextWeek(
  userId: number,
  proposalId: number,
  decisions: Record<string, ProposalDecision>,
  confirmation: "approve",
) {
  return applyProposal(userId, proposalId, { confirmation, decisions });
}

export async function isWeekComplete(plan: { id: number }): Promise<boolean> {
  const days = await db
    .select()
    .from(workoutPlanDays)
    .where(eq(workoutPlanDays.workoutPlanId, plan.id))
    .orderBy(asc(workoutPlanDays.dayNumber));
  let hasResistanceDay = false;
  for (const day of days) {
    const planExercises = await getPlanExercises(day.id);
    if (planExercises.length === 0) continue;
    hasResistanceDay = true;
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.workoutPlanDayId, day.id));
    if (!sessions.some((session) => session.completedAt != null)) return false;
  }
  return hasResistanceDay;
}

export async function hasPlanForWeek(
  userId: number,
  weekNumber: number,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(workoutPlans)
    .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.weekNumber, weekNumber)));
  return rows.length > 0;
}
