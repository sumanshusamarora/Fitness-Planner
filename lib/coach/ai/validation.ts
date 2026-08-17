import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { allowedEffortsFor, type Effort } from "../restDay";
import { CoachInvalidError } from "./types";
import type { ExtraSessionCoachDecision } from "./schemas";
import { validateInitialWeekProposal, validateProposal } from "../validateProposal";
import type { TrainingContext, WeeklyPlanProposal } from "../types";

export interface ExtraSessionValidationContext {
  requestedEffort: Effort;
  /** Exercise IDs the model was allowed to pick from. Enforced when provided. */
  allowedExerciseIds?: number[];
}

/**
 * Validates an extra-session decision beyond structured-output shape.
 * Rejects any attempt to silently exceed the requested effort, prescribe
 * RPE 10/failure, invent exercises, or return an inconsistent object.
 */
export function validateExtraSessionDecision(
  decision: ExtraSessionCoachDecision,
  ctx: ExtraSessionValidationContext,
): ExtraSessionCoachDecision {
  if (!decision.rationale.length) {
    throw new CoachInvalidError("Extra-session decision needs a rationale.");
  }

  const allowed = allowedEffortsFor(ctx.requestedEffort);
  if (decision.action === "add_session") {
    if (!allowed.includes(decision.effectiveEffort)) {
      throw new CoachInvalidError(
        `Effective effort "${decision.effectiveEffort}" exceeds the requested maximum "${ctx.requestedEffort}".`,
      );
    }
    if (decision.effectiveEffort == null || !decision.session) {
      throw new CoachInvalidError("An add_session decision needs an effective effort and a session.");
    }
    validateExtraSession(decision.session, ctx);
    return decision;
  }

  if (decision.action === "keep_rest_day") {
    if (decision.effectiveEffort != null || decision.session != null) {
      throw new CoachInvalidError("keep_rest_day must not include a session or effective effort.");
    }
    return decision;
  }

  if (decision.action === "needs_input") {
    if (decision.questions.length === 0) {
      throw new CoachInvalidError("needs_input requires at least one question.");
    }
    return decision;
  }

  return decision;
}

function validateExtraSession(
  session: NonNullable<ExtraSessionCoachDecision["session"]>,
  ctx: ExtraSessionValidationContext,
) {
  for (const exercise of session.exercises) {
    if (exercise.sets < 1 || exercise.sets > 6) {
      throw new CoachInvalidError(`Invalid set count for ${exercise.exerciseName}.`);
    }
    if (exercise.minReps < 1 || exercise.maxReps < exercise.minReps || exercise.maxReps > 30) {
      throw new CoachInvalidError(`Invalid rep range for ${exercise.exerciseName}.`);
    }
    if (exercise.targetRpe < 1 || exercise.targetRpe > 9) {
      throw new CoachInvalidError(`RPE must stay below 10 for ${exercise.exerciseName}.`);
    }
    if (ctx.allowedExerciseIds && !ctx.allowedExerciseIds.includes(exercise.exerciseId)) {
      throw new CoachInvalidError(`Exercise ${exercise.exerciseId} is not in the allowed candidate set.`);
    }
  }
}

/**
 * Validates an AI weekly proposal. Runs the existing deterministic business
 * validation, then applies AI-specific safety caps and verifies every exercise
 * exists and is active (no hallucinated IDs).
 */
export async function validateAIWeeklyProposal(
  proposalInput: WeeklyPlanProposal,
  context?: TrainingContext,
): Promise<WeeklyPlanProposal> {
  const proposal =
    proposalInput.proposalType === "initial_week"
      ? validateInitialWeekProposal(proposalInput)
      : validateProposal(proposalInput, context);

  const exerciseIds = new Set<number>();
  for (const change of proposal.changes) {
    exerciseIds.add(change.exerciseId);
    const target = change.proposed;
    if (target.sets < 1 || target.sets > 6) {
      throw new CoachInvalidError(`Invalid set count for ${change.exerciseName}.`);
    }
    if (target.minReps < 1 || target.maxReps < target.minReps || target.maxReps > 30) {
      throw new CoachInvalidError(`Invalid rep range for ${change.exerciseName}.`);
    }
    if (target.targetRpe < 1 || target.targetRpe > 9) {
      throw new CoachInvalidError(`RPE must stay below 10 for ${change.exerciseName}.`);
    }
    if (target.weightKg != null && target.weightKg < 0) {
      throw new CoachInvalidError(`Invalid load for ${change.exerciseName}.`);
    }
  }

  const ids = [...exerciseIds];
  if (ids.length) {
    const rows = await db
      .select({ id: exercises.id, active: exercises.active })
      .from(exercises)
      .where(inArray(exercises.id, ids));
    const valid = new Set(rows.filter((row) => row.active).map((row) => row.id));
    const unknown = ids.filter((id) => !valid.has(id));
    if (unknown.length > 0) {
      throw new CoachInvalidError(`Proposal references unknown or inactive exercises: ${unknown.join(", ")}.`);
    }
  }

  return proposal;
}

/**
 * First-week constraint check: the model must stay inside the deterministic
 * caps (resistance days and per-day exercise count).
 */
export function validateInitialWeekAIConstraints(
  proposal: WeeklyPlanProposal,
  constraints: { resistanceDays: number[]; maxExercisesPerDay: number },
): WeeklyPlanProposal {
  const workoutDays = proposal.days.filter((day) => day.exercises.length > 0);
  const actualDays = workoutDays.map((day) => day.dayNumber).sort((a, b) => a - b);
  const expectedDays = [...constraints.resistanceDays].sort((a, b) => a - b);
  if (JSON.stringify(actualDays) !== JSON.stringify(expectedDays)) {
    throw new CoachInvalidError(
      `Resistance days ${actualDays.join(",")} do not match the deterministic caps ${expectedDays.join(",")}.`,
    );
  }
  for (const day of workoutDays) {
    if (day.exercises.length > constraints.maxExercisesPerDay) {
      throw new CoachInvalidError(
        `${day.dayName} has ${day.exercises.length} exercises, above the ${constraints.maxExercisesPerDay} cap.`,
      );
    }
  }
  return proposal;
}

/** Cheap check that a candidate exercise ID is real and active (single row). */
export async function exerciseIsAllowed(exerciseId: number): Promise<boolean> {
  const rows = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, exerciseId)).limit(1);
  return rows.length > 0;
}
