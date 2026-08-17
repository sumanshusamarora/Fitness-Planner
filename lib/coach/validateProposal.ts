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
  validateChanges(proposal);
  if (context) {
    if (proposal.sourceWeekId !== context.sourcePlan.id) throw new Error("Proposal source does not match its context.");
    if (proposal.proposedWeekNumber !== context.sourcePlan.weekNumber + 1) {
      throw new Error("Proposal week number is not the next week.");
    }
    const expected = new Set(context.exercises.map((exercise) => exercise.sourcePlanExerciseId));
    if (proposal.changes.length !== expected.size || proposal.changes.some((change) => !expected.has(change.sourcePlanExerciseId))) {
      throw new Error("Proposal exercises do not match the source plan.");
    }
  }
  return proposal;
}

/** Validation for a first-week proposal that has no source plan or history. */
export function validateInitialWeekProposal(proposalInput: unknown): WeeklyPlanProposal {
  const proposal = parseWeeklyPlanProposal(proposalInput);
  if (proposal.proposalType !== "initial_week") throw new Error("Not an initial-week proposal.");
  if (proposal.sourceWeekId !== null) throw new Error("An initial-week proposal has no source plan.");
  if (proposal.proposedWeekNumber !== 1) throw new Error("An initial-week proposal must be Week 1.");
  if (proposal.days.length === 0 || proposal.changes.length === 0) {
    throw new Error("A weekly proposal needs at least one planned exercise.");
  }
  validateChanges(proposal);
  return proposal;
}

function validateChanges(proposal: WeeklyPlanProposal) {
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
}
