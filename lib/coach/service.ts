import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { weeklyPlanProposals } from "@/db/schema";
import { getActivePlan, getSingleUser } from "@/lib/workouts";
import { analyseWeek } from "./analyseWeek";
import { buildTrainingContext } from "./buildTrainingContext";
import { proposeNextWeek } from "./proposeNextWeek";
import { parseWeeklyPlanProposal } from "./schemas";
import { validateProposal } from "./validateProposal";
import type { WeeklyPlanProposal } from "./types";

export interface StoredWeeklyPlanProposal {
  id: number;
  status: string;
  proposal: WeeklyPlanProposal;
  generatedAt: Date;
}

export async function createProposalForPlan(
  userId: number,
  sourcePlanId: number,
): Promise<StoredWeeklyPlanProposal> {
  const context = await buildTrainingContext(userId, sourcePlanId);
  if (!context) throw new Error("Could not build coaching context for this week.");
  const proposal = validateProposal(proposeNextWeek(context, analyseWeek(context)), context);
  const existing = await db
    .select()
    .from(weeklyPlanProposals)
    .where(
      and(
        eq(weeklyPlanProposals.sourcePlanId, sourcePlanId),
        eq(weeklyPlanProposals.proposedWeekNumber, proposal.proposedWeekNumber),
      ),
    )
    .orderBy(desc(weeklyPlanProposals.generatedAt))
    .limit(1);
  // Keep a user-reviewed proposal stable. A draft can be regenerated from
  // updated training data by explicitly calling this service again.
  if (existing[0]) {
    return {
      id: existing[0].id,
      status: existing[0].status,
      proposal: parseWeeklyPlanProposal(existing[0].proposal),
      generatedAt: existing[0].generatedAt,
    };
  }
  const [record] = await db
    .insert(weeklyPlanProposals)
    .values({
      userId,
      sourcePlanId,
      proposedWeekNumber: proposal.proposedWeekNumber,
      status: proposal.questions.length ? "awaiting_input" : "draft",
      proposal,
    })
    .returning();
  return { id: record.id, status: record.status, proposal, generatedAt: record.generatedAt };
}

export async function createProposalForActivePlan(): Promise<StoredWeeklyPlanProposal | null> {
  const [user, plan] = await Promise.all([getSingleUser(), getActivePlan()]);
  if (!user || !plan) return null;
  return createProposalForPlan(user.id, plan.id);
}

export async function getProposal(proposalId: number): Promise<StoredWeeklyPlanProposal | null> {
  const rows = await db
    .select()
    .from(weeklyPlanProposals)
    .where(eq(weeklyPlanProposals.id, proposalId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, status: row.status, proposal: parseWeeklyPlanProposal(row.proposal), generatedAt: row.generatedAt };
}
