import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { weeklyPlanProposals, workoutPlanDays, workoutPlanExercises, workoutPlans } from "@/db/schema";
import { parseWeeklyPlanProposal } from "./schemas";
import { validateInitialWeekProposal, validateProposal } from "./validateProposal";
import type { ProposalDecision } from "./types";

export interface ApplyProposalOptions {
  confirmation: "approve";
  decisions?: Record<string, ProposalDecision>;
}

/**
 * The sole mutation path from a reviewed proposal to an active workout plan.
 * An explicit `confirmation: "approve"` is required even for code callers.
 */
export async function applyProposal(
  userId: number,
  proposalId: number,
  options: ApplyProposalOptions,
): Promise<{ planId: number; weekNumber: number }> {
  if (options.confirmation !== "approve") throw new Error("Explicit approval is required.");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(weeklyPlanProposals)
      .where(eq(weeklyPlanProposals.id, proposalId))
      .limit(1);
    const record = rows[0];
    if (!record) throw new Error("Proposal not found.");
    if (record.userId !== userId) throw new Error("Proposal not found.");
    if (record.status === "applied" && record.appliedPlanId) {
      return { planId: record.appliedPlanId, weekNumber: record.proposedWeekNumber };
    }
    if (record.status === "rejected") throw new Error("Rejected proposals cannot be applied.");

    const isInitial = record.proposalType === "initial_week";
    const proposal = isInitial
      ? validateInitialWeekProposal(parseWeeklyPlanProposal(record.proposal))
      : validateProposal(parseWeeklyPlanProposal(record.proposal));
    if (proposal.questions.length > 0 || proposal.confidence === "needs-input") {
      throw new Error("This proposal needs an answer before it can be approved.");
    }

    let sourcePlanNotes: string | null = null;
    if (!isInitial) {
      const sourceRows = await tx
        .select()
        .from(workoutPlans)
        .where(
          and(eq(workoutPlans.id, record.sourcePlanId!), eq(workoutPlans.userId, record.userId)),
        )
        .limit(1);
      const sourcePlan = sourceRows[0];
      if (!sourcePlan) throw new Error("Source week no longer exists.");
      sourcePlanNotes = sourcePlan.notes;
    }

    const [newPlan] = await tx
      .insert(workoutPlans)
      .values({
        userId: record.userId,
        name: `Week ${proposal.proposedWeekNumber} — Training`,
        weekNumber: proposal.proposedWeekNumber,
        startsOn: proposal.proposedStartsOn,
        status: "active",
        notes: sourcePlanNotes,
      })
      .returning();

    for (const day of proposal.days) {
      const [newDay] = await tx
        .insert(workoutPlanDays)
        .values({
          workoutPlanId: newPlan.id,
          dayNumber: day.dayNumber,
          dayName: day.dayName,
          title: day.title,
        })
        .returning();
      for (const exercise of day.exercises) {
        const decision = options.decisions?.[String(exercise.sourcePlanExerciseId)] ?? "accept";
        await tx.insert(workoutPlanExercises).values({
          workoutPlanDayId: newDay.id,
          exerciseId: exercise.exerciseId,
          position: exercise.position,
          targetSets: exercise.proposed.sets,
          minReps: exercise.proposed.minReps,
          maxReps: exercise.proposed.maxReps,
          targetRpe: exercise.proposed.targetRpe,
          suggestedWeightKg:
            decision === "keep" ? exercise.previous.weightKg : exercise.proposed.weightKg,
          restSeconds: exercise.restSeconds,
          notes: null,
        });
      }
    }

    if (!isInitial && record.sourcePlanId) {
      await tx
        .update(workoutPlans)
        .set({ status: "completed" })
        .where(eq(workoutPlans.id, record.sourcePlanId));
    }
    await tx
      .update(weeklyPlanProposals)
      .set({
        status: "applied",
        appliedPlanId: newPlan.id,
        appliedDecisions: options.decisions ?? {},
        appliedAt: new Date(),
      })
      .where(eq(weeklyPlanProposals.id, record.id));

    return { planId: newPlan.id, weekNumber: newPlan.weekNumber };
  });
}
