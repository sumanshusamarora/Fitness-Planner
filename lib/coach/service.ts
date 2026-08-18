import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { weeklyPlanProposals } from "@/db/schema";
import { getActivePlan } from "@/lib/workouts";
import { isAICoachAvailable } from "./ai/client";
import { RuntimeLLMCoachReasoner } from "./reasoners/openai";
import { analyseWeek } from "./analyseWeek";
import { buildTrainingContext } from "./buildTrainingContext";
import { buildInitialTrainingContext } from "./initialContext";
import { proposeFirstWeek } from "./proposeFirstWeek";
import { proposeNextWeek } from "./proposeNextWeek";
import { parseWeeklyPlanProposal } from "./schemas";
import { validateInitialWeekProposal, validateProposal } from "./validateProposal";
import type { InitialTrainingContext, TrainingContext, WeeklyPlanProposal } from "./types";

export interface StoredWeeklyPlanProposal {
  id: number;
  status: string;
  proposalType: "initial_week" | "next_week";
  proposal: WeeklyPlanProposal;
  generatedAt: Date;
}

export async function createProposalForPlan(
  userId: number,
  sourcePlanId: number,
): Promise<StoredWeeklyPlanProposal> {
  const context = await buildTrainingContext(userId, sourcePlanId);
  if (!context) throw new Error("Could not build coaching context for this week.");
  const analysis = analyseWeek(context);
  const proposal = validateProposal(await buildNextWeekProposal(context, analysis), context);
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
      proposalType: "next_week",
      proposal: parseWeeklyPlanProposal(existing[0].proposal),
      generatedAt: existing[0].generatedAt,
    };
  }
  const [record] = await db
    .insert(weeklyPlanProposals)
    .values({
      userId,
      sourcePlanId,
      proposalType: "next_week",
      proposedWeekNumber: proposal.proposedWeekNumber,
      status: proposal.questions.length ? "awaiting_input" : "draft",
      proposal,
    })
    .returning();
  return { id: record.id, status: record.status, proposalType: "next_week", proposal, generatedAt: record.generatedAt };
}

export async function createProposalForActivePlan(
  userId: number,
): Promise<StoredWeeklyPlanProposal | null> {
  const plan = await getActivePlan(userId);
  if (!plan) return null;
  return createProposalForPlan(userId, plan.id);
}

export async function getProposal(
  userId: number,
  proposalId: number,
): Promise<StoredWeeklyPlanProposal | null> {
  const rows = await db
    .select()
    .from(weeklyPlanProposals)
    .where(and(eq(weeklyPlanProposals.id, proposalId), eq(weeklyPlanProposals.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    proposalType: row.proposalType as "initial_week" | "next_week",
    proposal: parseWeeklyPlanProposal(row.proposal),
    generatedAt: row.generatedAt,
  };
}

/** Creates (or regenerates) the draft first-week proposal for a new user. */
export async function createInitialProposal(
  userId: number,
): Promise<StoredWeeklyPlanProposal> {
  const context = await buildInitialTrainingContext(userId);
  if (!context) throw new Error("Could not build onboarding context.");

  // Regenerate from the current profile: replace any non-applied drafts so the
  // reviewed proposal always reflects the latest onboarding answers.
  await db
    .delete(weeklyPlanProposals)
    .where(
      and(
        eq(weeklyPlanProposals.userId, userId),
        eq(weeklyPlanProposals.proposalType, "initial_week"),
        ne(weeklyPlanProposals.status, "applied"),
      ),
    );

  const proposal = validateInitialWeekProposal(await buildInitialWeekProposal(context));
  const [record] = await db
    .insert(weeklyPlanProposals)
    .values({
      userId,
      sourcePlanId: null,
      proposalType: "initial_week",
      proposedWeekNumber: proposal.proposedWeekNumber,
      status: "draft",
      proposal,
    })
    .returning();
  return { id: record.id, status: record.status, proposalType: "initial_week", proposal, generatedAt: record.generatedAt };
}

async function buildNextWeekProposal(
  context: TrainingContext,
  analysis: ReturnType<typeof analyseWeek>,
): Promise<WeeklyPlanProposal> {
  if (isAICoachAvailable()) {
    try {
      return await new RuntimeLLMCoachReasoner().proposeNextWeek(context, analysis);
    } catch (error) {
      console.warn("[coach] AI next-week unavailable; falling back to deterministic.", error);
    }
  }
  return proposeNextWeek(context, analysis);
}

async function buildInitialWeekProposal(
  context: InitialTrainingContext,
): Promise<WeeklyPlanProposal> {
  if (isAICoachAvailable()) {
    try {
      return await new RuntimeLLMCoachReasoner().proposeInitialWeek(context);
    } catch (error) {
      console.warn("[coach] AI initial-week unavailable; falling back to deterministic.", error);
    }
  }
  return proposeFirstWeek(context);
}

/** Returns the user's draft initial proposal, or null if none exists yet. */
export async function getDraftInitialProposal(
  userId: number,
): Promise<StoredWeeklyPlanProposal | null> {
  const rows = await db
    .select()
    .from(weeklyPlanProposals)
    .where(
      and(
        eq(weeklyPlanProposals.userId, userId),
        eq(weeklyPlanProposals.proposalType, "initial_week"),
      ),
    )
    .orderBy(desc(weeklyPlanProposals.generatedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    proposalType: "initial_week",
    proposal: parseWeeklyPlanProposal(row.proposal),
    generatedAt: row.generatedAt,
  };
}
