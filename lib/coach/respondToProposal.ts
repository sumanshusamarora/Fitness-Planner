import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { weeklyPlanProposals } from "@/db/schema";
import { parseWeeklyPlanProposal } from "./schemas";
import type { WeeklyPlanProposal } from "./types";

/** Records a material answer and turns a blocked recommendation into a conservative hold. */
export async function respondToProposal(
  userId: number,
  proposalId: number,
  questionId: string,
  answer: string,
): Promise<WeeklyPlanProposal> {
  const rows = await db
    .select()
    .from(weeklyPlanProposals)
    .where(and(eq(weeklyPlanProposals.id, proposalId), eq(weeklyPlanProposals.userId, userId)))
    .limit(1);
  const record = rows[0];
  if (!record) throw new Error("Proposal not found.");
  if (record.status === "applied") throw new Error("Applied proposals cannot be changed.");
  const proposal = parseWeeklyPlanProposal(record.proposal);
  const question = proposal.questions.find((item) => item.id === questionId);
  if (!question || !question.options.includes(answer)) throw new Error("That answer is not valid for this proposal.");
  const questions = proposal.questions.filter((item) => item.id !== questionId);
  const answeredPain = questionId === "joint-pain-current";
  const updated: WeeklyPlanProposal = {
    ...proposal,
    questions,
    confidence: questions.length ? "needs-input" : "medium",
    summary: {
      ...proposal.summary,
      overallRecommendation: answeredPain
        ? "Pain was acknowledged. Keep all loads conservative and seek assessment if it persists or worsens."
        : "The missed-session context was recorded. Keep the next week conservative and consistent.",
    },
    changes: proposal.changes.map((change) =>
      change.action === "needs_input"
        ? {
            ...change,
            action: "maintain",
            confidence: "medium",
            proposed: { ...change.proposed, weightKg: change.previous.weightKg },
            reason: `${change.reason} Your response is recorded; this exercise will stay at its current load.`,
          }
        : change,
    ),
  };
  const changesById = new Map(updated.changes.map((change) => [change.sourcePlanExerciseId, change]));
  updated.days = updated.days.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise) => ({
      ...exercise,
      ...changesById.get(exercise.sourcePlanExerciseId)!,
      position: exercise.position,
      restSeconds: exercise.restSeconds,
    })),
  }));
  await db
    .update(weeklyPlanProposals)
    .set({
      proposal: updated,
      inputResponses: { ...(record.inputResponses as Record<string, string> | null ?? {}), [questionId]: answer },
      status: questions.length ? "awaiting_input" : "draft",
    })
    .where(eq(weeklyPlanProposals.id, proposalId));
  return updated;
}
