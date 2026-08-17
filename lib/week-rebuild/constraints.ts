import type {
  RebuildConstraints,
  RebuildDayContext,
  WeekFeedbackInput,
} from "./types";

/**
 * Deterministic rebuild constraints: what is legally/structurally modifiable
 * and what hard caps apply. The model never has to infer these from dates.
 *
 * Completed / ended-early / skipped / in-progress days are immutable. Only
 * legal current/future days with no recorded outcome may change.
 */

export interface RebuildConstraintsOptions {
  futureWeekExists: boolean;
  maxExercisesPerDay: number;
  minSets: number;
  maxSets: number;
  maxRpe: number;
  allowedExerciseIds: number[];
  recentMuscles: string[];
}

function requestedAvailability(feedback: WeekFeedbackInput): number[] | null {
  const details = feedback.structuredDetails;
  const available = details?.available_days;
  if (Array.isArray(available)) {
    const days = available
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (days.length > 0) return days;
  }
  return null;
}

export function computeRebuildConstraints(
  days: RebuildDayContext[],
  feedback: WeekFeedbackInput,
  options: RebuildConstraintsOptions,
): RebuildConstraints {
  const immutableDayIds: number[] = [];
  const inProgressDayIds: number[] = [];
  const modifiableDayIds: number[] = [];
  const modifiableWorkoutDayIds: number[] = [];
  const modifiableRestDayIds: number[] = [];

  for (const day of days) {
    if (day.modifiable) {
      modifiableDayIds.push(day.dayId);
      if (day.isWorkout) modifiableWorkoutDayIds.push(day.dayId);
      else modifiableRestDayIds.push(day.dayId);
    } else if (day.sessionStatus === "in_progress") {
      inProgressDayIds.push(day.dayId);
    } else {
      immutableDayIds.push(day.dayId);
    }
  }

  const requested = requestedAvailability(feedback);
  const remainingAvailableDayNumbers = requested ?? modifiableDayIds.map((id) => {
    const day = days.find((d) => d.dayId === id)!;
    return day.dayNumber;
  });

  return {
    immutableDayIds,
    inProgressDayIds,
    modifiableDayIds,
    modifiableWorkoutDayIds,
    modifiableRestDayIds,
    remainingAvailableDayNumbers,
    futureWeekExists: options.futureWeekExists,
    maxExercisesPerDay: options.maxExercisesPerDay,
    minSets: options.minSets,
    maxSets: options.maxSets,
    maxRpe: options.maxRpe,
    allowedExerciseIds: options.allowedExerciseIds,
    recentMuscles: options.recentMuscles,
  };
}
