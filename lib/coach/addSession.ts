import type { AddWorkoutProposal, AddWorkoutExercise } from "@/lib/schedule";
import { isAICoachAvailable } from "./ai/client";
import { OpenAICoachReasoner } from "./reasoners/openai";
import { proposeRestDayWorkout, type Effort } from "./restDay";

export interface AddSessionInput {
  userId: number;
  workoutPlanId: number;
  dayNumber: number;
  dayId: number;
  requestedEffort: Effort;
}

/**
 * Proposes an ad-hoc session on a rest day. Tries the runtime AI coach first;
 * if it is unavailable or returns an invalid/undecided result, falls back to
 * the deterministic rest-day builder. Returns a persistable add proposal.
 */
export async function proposeAddSession(input: AddSessionInput): Promise<AddWorkoutProposal> {
  const { userId, workoutPlanId, dayNumber, dayId, requestedEffort } = input;

  if (isAICoachAvailable()) {
    try {
      const { decision, metadata } = await new OpenAICoachReasoner().proposeExtraSession({
        userId,
        workoutPlanId,
        dayNumber,
        requestedEffort,
      });
      if (decision.action === "add_session" && decision.session && decision.effectiveEffort) {
        const exercises: AddWorkoutExercise[] = decision.session.exercises.map((exercise, index) => ({
          exerciseId: exercise.exerciseId,
          name: exercise.exerciseName,
          position: index + 1,
          targetSets: exercise.sets,
          minReps: exercise.minReps,
          maxReps: exercise.maxReps,
          targetRpe: exercise.targetRpe,
          suggestedWeightKg: exercise.suggestedWeightKg,
          restSeconds: exercise.restSeconds,
        }));
        return {
          kind: "add",
          dayId,
          effort: decision.effectiveEffort,
          title: decision.session.title,
          reason: decision.reasonSummary,
          note: null,
          exercises,
          aiMetadata: metadata,
          aiRationale: decision.rationale,
          confidence: decision.confidence,
          safetyFlags: decision.safetyFlags,
        };
      }
      // keep_rest_day / needs_input: fall through to the conservative
      // deterministic proposal rather than silently prescribing nothing.
    } catch (error) {
      console.warn("[coach] AI extra-session unavailable; falling back to deterministic.", error);
    }
  }

  const generated = await proposeRestDayWorkout({ userId, workoutPlanId, dayNumber, requestedEffort });
  return {
    kind: "add",
    dayId,
    effort: generated.effort,
    title: generated.title,
    reason: generated.reason,
    note: generated.note,
    exercises: generated.exercises,
  };
}
