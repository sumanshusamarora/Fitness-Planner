import { parseWeeklyPlanProposal } from "./schemas";
import type { TrainingContext, WeeklyPlanProposal } from "./types";

/** Business validation beyond JSON shape. It protects the write boundary. */
export function validateProposal(
  proposalInput: unknown,
  context?: TrainingContext,
): WeeklyPlanProposal {
  const proposal = parseWeeklyPlanProposal(proposalInput);
  if (proposal.days.length === 0 || proposal.changes.length === 0) {
    throw new Error("A weekly proposal needs at least one planned exercise.");
  }
  if (proposal.questions.length > 0 && proposal.confidence !== "needs-input") {
    throw new Error("A proposal with material questions must require input.");
  }
  const seen = new Set<number>();
  for (const change of proposal.changes) {
    if (seen.has(change.sourcePlanExerciseId)) throw new Error("Proposal repeats an exercise.");
    seen.add(change.sourcePlanExerciseId);
    if (change.proposed.sets < 1 || change.proposed.minReps < 1 || change.proposed.maxReps < change.proposed.minReps) {
      throw new Error(`Invalid prescription for ${change.exerciseName}.`);
    }
    if (change.proposed.targetRpe < 1 || change.proposed.targetRpe > 10) {
      throw new Error(`Invalid target RPE for ${change.exerciseName}.`);
    }
  }
  if (context) {
    if (proposal.sourceWeekId !== context.sourcePlan.id) throw new Error("Proposal source does not match its context.");
    if (proposal.proposedWeekNumber !== context.sourcePlan.weekNumber + 1) {
      throw new Error("Proposal week number is not the next week.");
    }
    const expected = new Set(context.exercises.map((exercise) => exercise.sourcePlanExerciseId));
    if (seen.size !== expected.size || [...seen].some((id) => !expected.has(id))) {
      throw new Error("Proposal exercises do not match the source plan.");
    }
  }
  return proposal;
}
