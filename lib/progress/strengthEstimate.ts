import { measurementTypeFor } from "@/lib/exercise-measurement";
import type { ExerciseMeta, ExposureSet } from "./types";

/**
 * Simple, explicitly documented strength-capacity estimate for weighted
 * resistance movements only.
 *
 * We use the Epley formula: estimated 1RM = weight × (1 + reps / 30).
 *
 * This is a *comparison* helper used to detect load-adjusted progress (and a
 * percentage rate), not a scientific claim about a user's true one-rep max. It
 * must never be applied to bodyweight holds (Plank, Dead Bug, Glute Bridge),
 * cardio (Treadmill, Exercise Bike), or any movement without meaningful
 * external load — those keep raw rep/time trends instead.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Estimated 1RM for the working (heaviest) set of an exposure. */
export function estimateExposureCapacity(sets: ExposureSet[]): number | null {
  if (sets.length === 0) return null;
  let best = 0;
  for (const set of sets) {
    if (set.weightKg <= 0) continue;
    best = Math.max(best, estimateOneRepMax(set.weightKg, set.reps));
  }
  return best > 0 ? best : null;
}

/**
 * Whether a movement carries meaningful external load, i.e. whether an
 * estimated 1RM is appropriate. Bodyweight reps, timed holds (planks), cardio
 * and duration-based movements are excluded.
 */
export function isWeightedResistance(exercise: Pick<ExerciseMeta, "equipment" | "category" | "primaryMuscle" | "name" | "measurementType">): boolean {
  return measurementTypeFor(exercise) === "weighted_reps";
}
