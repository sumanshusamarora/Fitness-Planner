import type { RebuildDayContext, RebuildProposedDay } from "./types";

/**
 * Deterministic plan diff. Compares the current modifiable portion of the week
 * against the proposal so the UI and validation never rely on GPT-5's prose to
 * describe what changed.
 */

export interface WeekRebuildDiff {
  sessionsBefore: number;
  sessionsAfter: number;
  sessionsAdded: number;
  sessionsRemoved: number;
  daysMoved: number;
  exercisesAdded: number;
  exercisesRemoved: number;
  setsBefore: number;
  setsAfter: number;
  setVolumeChangePct: number | null;
  loadsChanged: number;
  rpeChanged: number;
  summary: string[];
}

export function computeWeekRebuildDiff(
  currentDays: RebuildDayContext[],
  proposedDays: RebuildProposedDay[],
): WeekRebuildDiff {
  const currentWorkout = currentDays.filter((day) => day.modifiable && day.isWorkout);
  const proposedWorkout = proposedDays.filter((day) => day.status === "workout");

  const currentExercises = currentWorkout.flatMap((day) => day.exercises);
  const proposedExercises = proposedWorkout.flatMap((day) => day.exercises);

  const currentById = new Map(currentExercises.map((exercise) => [exercise.exerciseId, exercise]));
  const proposedById = new Map(proposedExercises.map((exercise) => [exercise.exerciseId, exercise]));

  const currentIds = new Set(currentExercises.map((exercise) => exercise.exerciseId));
  const proposedIds = new Set(proposedExercises.map((exercise) => exercise.exerciseId));

  const exercisesAdded = [...proposedIds].filter((id) => !currentIds.has(id)).length;
  const exercisesRemoved = [...currentIds].filter((id) => !proposedIds.has(id)).length;

  const setsBefore = currentExercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const setsAfter = proposedExercises.reduce((sum, exercise) => sum + exercise.sets, 0);

  let loadsChanged = 0;
  let rpeChanged = 0;
  for (const id of proposedIds) {
    const before = currentById.get(id);
    const after = proposedById.get(id);
    if (!before || !after) continue;
    if ((before.suggestedWeightKg ?? 0) !== (after.suggestedWeightKg ?? 0)) loadsChanged += 1;
    if (before.targetRpe !== after.targetRpe) rpeChanged += 1;
  }

  const currentDayNumbers = new Set(currentWorkout.map((day) => day.dayNumber));
  const proposedDayNumbers = new Set(proposedWorkout.map((day) => day.dayNumber));
  const daysMoved = [...proposedDayNumbers].filter((day) => !currentDayNumbers.has(day)).length;

  const sessionsBefore = currentWorkout.length;
  const sessionsAfter = proposedWorkout.length;
  const sessionsAdded = Math.max(0, sessionsAfter - sessionsBefore);
  const sessionsRemoved = Math.max(0, sessionsBefore - sessionsAfter);

  const setVolumeChangePct =
    setsBefore > 0 ? Math.round(((setsAfter - setsBefore) / setsBefore) * 100) : null;

  const summary: string[] = [];
  if (sessionsRemoved > 0) summary.push(`${sessionsRemoved} remaining session${sessionsRemoved === 1 ? "" : "s"} removed.`);
  if (sessionsAdded > 0) summary.push(`${sessionsAdded} session${sessionsAdded === 1 ? "" : "s"} added.`);
  if (daysMoved > 0) summary.push(`${daysMoved} workout${daysMoved === 1 ? "" : "s"} moved to a new day.`);
  if (exercisesRemoved > 0) summary.push(`${exercisesRemoved} exercise${exercisesRemoved === 1 ? "" : "s"} removed.`);
  if (exercisesAdded > 0) summary.push(`${exercisesAdded} exercise${exercisesAdded === 1 ? "" : "s"} added.`);
  if (setVolumeChangePct != null && setVolumeChangePct !== 0) {
    summary.push(`Estimated set volume ${setVolumeChangePct > 0 ? "+" : ""}${setVolumeChangePct}%.`);
  }
  if (loadsChanged > 0) summary.push(`${loadsChanged} load${loadsChanged === 1 ? "" : "s"} adjusted.`);
  if (rpeChanged > 0) summary.push(`${rpeChanged} target RPE${rpeChanged === 1 ? "" : "s"} adjusted.`);
  if (summary.length === 0) summary.push("No changes to the remaining week.");

  return {
    sessionsBefore,
    sessionsAfter,
    sessionsAdded,
    sessionsRemoved,
    daysMoved,
    exercisesAdded,
    exercisesRemoved,
    setsBefore,
    setsAfter,
    setVolumeChangePct,
    loadsChanged,
    rpeChanged,
    summary,
  };
}
