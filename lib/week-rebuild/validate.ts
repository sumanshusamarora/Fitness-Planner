import type {
  WeekRebuildContext,
  WeekRebuildProposal,
} from "./types";

/**
 * Hard, deterministic validation of a week-rebuild proposal. Protects the
 * write boundary: completed history must be preserved, exercises must exist in
 * the allowed set, and prescription must stay inside safe bounds.
 */
export function validateWeekRebuildProposal(
  proposal: WeekRebuildProposal,
  context: WeekRebuildContext,
): WeekRebuildProposal {
  if (proposal.proposalType !== "week_rebuild") {
    throw new Error("Not a week-rebuild proposal.");
  }
  if (proposal.workoutPlanId !== context.currentWeek.planId) {
    throw new Error("Proposal does not match the current plan.");
  }

  const allowed = new Set(context.constraints.allowedExerciseIds);

  const modifiableDayNumbers = new Set(
    context.currentWeek.days.filter((day) => day.modifiable).map((day) => day.dayNumber),
  );
  const immutableDayNumbers = new Set(
    context.currentWeek.days.filter((day) => !day.modifiable).map((day) => day.dayNumber),
  );

  const proposedNumbers = new Set<number>();
  for (const day of proposal.proposedDays) {
    if (proposedNumbers.has(day.dayNumber)) throw new Error("Proposal repeats a day.");
    proposedNumbers.add(day.dayNumber);
    if (!modifiableDayNumbers.has(day.dayNumber)) {
      throw new Error(`Proposal tries to change immutable day ${day.dayNumber}.`);
    }
    if (day.status === "rest" && day.sessionEffort !== null) {
      throw new Error(`Rest day ${day.dayNumber} must have null session effort.`);
    }
    if (day.rationale.length > 3) {
      throw new Error(`Day ${day.dayNumber} has too many rationale bullets.`);
    }
    for (const exercise of day.exercises) {
      if (!allowed.has(exercise.exerciseId)) {
        throw new Error(`Proposal references an exercise outside the allowed set: ${exercise.exerciseId}.`);
      }
      if (exercise.sets < context.constraints.minSets || exercise.sets > context.constraints.maxSets) {
        throw new Error(`Invalid set count for ${exercise.exerciseName}.`);
      }
      if (exercise.maxReps < exercise.minReps || exercise.maxReps > 30) {
        throw new Error(`Invalid rep range for ${exercise.exerciseName}.`);
      }
      if (exercise.targetRpe < 1 || exercise.targetRpe > context.constraints.maxRpe) {
        throw new Error(`RPE must stay below 10 for ${exercise.exerciseName}.`);
      }
    }
  }

  for (const modifiableNumber of modifiableDayNumbers) {
    if (!proposedNumbers.has(modifiableNumber)) {
      throw new Error(`Proposal is missing the remaining day ${modifiableNumber}.`);
    }
  }

  const preservedIds = new Set(proposal.preservedDays.map((day) => day.dayId));
  for (const day of context.currentWeek.days) {
    if (!day.modifiable && !preservedIds.has(day.dayId)) {
      throw new Error("Proposal dropped a preserved (completed/in-progress) day.");
    }
  }
  for (const preserved of proposal.preservedDays) {
    if (immutableDayNumbers.has(preserved.dayNumber)) continue;
    throw new Error("Proposal marked a modifiable day as preserved.");
  }

  if (proposal.questions.length > 0 && proposal.confidence !== "needs_input") {
    throw new Error("A proposal with questions must require input.");
  }

  return proposal;
}
