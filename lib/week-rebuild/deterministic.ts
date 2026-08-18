import type {
  AddedDayEffortPreference,
  RebuildChange,
  RebuildDayContext,
  RebuildDayExercise,
  RebuildPreservedDay,
  RebuildProposedDay,
  RebuildProposedExercise,
  WeekRebuildContext,
  WeekRebuildProposal,
} from "./types";

/**
 * Conservative deterministic week-rebuild fallback (no GPT-5).
 *
 * It prefers small, safe changes: it never blindly drops every load for "too
 * difficult", never aggressively adds for "too easy", and always preserves
 * completed history. Full contextual reasoning is the runtime coach's job.
 */

const MIN_SETS = 1;
const LIGHT_SESSION_SETS = 1;
const LIGHT_SESSION_RPE = 5;

function addedDayEffortPreference(value: unknown): AddedDayEffortPreference {
  if (value === "light" || value === "normal" || value === "coach_decide") return value;
  return "coach_decide";
}

function toProposedExercise(exercise: RebuildDayExercise): RebuildProposedExercise {
  return {
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.name,
    sets: exercise.sets,
    minReps: exercise.minReps,
    maxReps: exercise.maxReps,
    targetRpe: exercise.targetRpe,
    suggestedWeightKg: exercise.suggestedWeightKg,
    restSeconds: exercise.restSeconds,
  };
}

function snapshotDay(day: RebuildDayContext): RebuildProposedDay {
  return {
    dayNumber: day.dayNumber,
    dateISO: day.dateISO,
    status: day.isWorkout ? "workout" : "rest",
    existingDayId: day.dayId,
    sessionEffort: null,
    title: day.isWorkout ? day.title : null,
    rationale: [],
    exercises: day.isWorkout ? day.exercises.map(toProposedExercise) : [],
  };
}

function withRest(day: RebuildProposedDay): RebuildProposedDay {
  return { ...day, status: "rest", title: null, sessionEffort: null, rationale: [], exercises: [] };
}

function reduceSets(day: RebuildProposedDay): RebuildProposedDay {
  return {
    ...day,
    exercises: day.exercises.map((exercise) => ({
      ...exercise,
      sets: Math.max(MIN_SETS, exercise.sets - 1),
    })),
  };
}

function dropExercise(day: RebuildProposedDay): RebuildProposedDay {
  if (day.exercises.length <= 2) return reduceSets(day);
  return { ...day, exercises: day.exercises.slice(0, -1) };
}

function preservedDays(context: WeekRebuildContext): RebuildPreservedDay[] {
  const preserved: RebuildPreservedDay[] = [];
  for (const day of context.currentWeek.days) {
    if (day.sessionStatus === "completed" || day.sessionStatus === "ended_early" || day.sessionStatus === "skipped") {
      preserved.push({ dayId: day.dayId, dayNumber: day.dayNumber, dateISO: day.dateISO, reason: "completed" });
    } else if (day.sessionStatus === "in_progress") {
      preserved.push({ dayId: day.dayId, dayNumber: day.dayNumber, dateISO: day.dateISO, reason: "in_progress" });
    }
  }
  return preserved;
}

function baseProposedDays(context: WeekRebuildContext): RebuildProposedDay[] {
  return context.currentWeek.days.filter((day) => day.modifiable).map(snapshotDay);
}

function modifiableWorkoutDays(context: WeekRebuildContext): RebuildDayContext[] {
  return context.currentWeek.days.filter((day) => day.modifiable && day.isWorkout);
}

function effectiveFromDate(context: WeekRebuildContext): string {
  const first = context.currentWeek.days.find((day) => day.modifiable);
  return first ? first.dateISO : context.currentWeek.startsOn;
}

export function proposeWeekRebuildDeterministic(context: WeekRebuildContext): WeekRebuildProposal {
  const reason = context.feedback.primaryReason;
  const details = context.feedback.structuredDetails ?? {};
  const remaining = modifiableWorkoutDays(context);
  const changes: RebuildChange[] = [];
  const safetyFlags: string[] = [];
  const questions: WeekRebuildProposal["questions"] = [];

  let proposed = baseProposedDays(context);
  let overallAction: WeekRebuildProposal["overallAction"] =
    context.currentWeek.completedSessions === 0 ? "replace_unstarted_week" : "modify_remaining_week";
  let summary = "The remaining week stays as planned.";

  const noChange = (message: string): WeekRebuildProposal => ({
    proposalType: "week_rebuild",
    workoutPlanId: context.currentWeek.planId,
    effectiveFromDate: effectiveFromDate(context),
    feedback: { primaryReason: reason },
    overallAction: "keep_plan",
    confidence: "medium",
    summary: message,
    rationale: [message],
    preservedDays: preservedDays(context),
    proposedDays: proposed,
    changes,
    questions,
    safetyFlags,
    methodologyVersion: "local-deterministic-rebuild-v1",
  });

  if (reason === "too_easy") {
    const dir = context.progress.adaptation.direction;
    const improving = dir === "improving" || dir === "improving_fast";
    const enough = context.progress.performance.analyzedExercises >= 2;
    if (!improving || !enough || remaining.length === 0) {
      return noChange("There isn't enough evidence to safely make it harder yet. Keep the current plan for another exposure.");
    }
    proposed = proposed.map((day) =>
      day.status === "workout"
        ? { ...day, exercises: day.exercises.map((exercise) => ({ ...exercise, sets: Math.min(context.constraints.maxSets, exercise.sets + 1) })) }
        : day,
    );
    changes.push({ type: "increase_volume", date: proposed.find((d) => d.status === "workout")?.dateISO ?? "", reason: "Clear improving trend with good recovery supports a small volume increase." });
    summary = "A small, evidence-backed increase in training volume.";
  }

  if (reason === "too_difficult") {
    const driver = typeof details.difficulty_driver === "string" ? details.difficulty_driver : null;
    if (driver === "Sessions too long" || driver === "Too many exercises") {
      proposed = proposed.map((day) => (day.status === "workout" ? dropExercise(day) : day));
      changes.push({ type: "shorten_session", date: effectiveFromDate(context), reason: "Reduce session length rather than load." });
      summary = "Shorter remaining sessions; working loads are preserved.";
    } else {
      proposed = proposed.map((day) => (day.status === "workout" ? reduceSets(day) : day));
      changes.push({ type: "reduce_volume", date: effectiveFromDate(context), reason: "Reduce fatigue demand while preserving working loads." });
      summary = "Reduced remaining volume; working loads are preserved.";
    }
  }

  if (reason === "too_many_days") {
    const target = Number(details.target_days);
    const wanted = Number.isInteger(target) && target >= 1 ? target : Math.max(1, remaining.length - 1);
    let workoutCount = 0;
    proposed = proposed.map((day) => {
      if (day.status !== "workout") return day;
      workoutCount += 1;
      if (workoutCount > wanted) {
        changes.push({ type: "remove_session", date: day.dateISO, reason: "Fewer training days as requested." });
        return withRest(day);
      }
      return day;
    });
    summary = `Reduced to ${wanted} remaining session${wanted === 1 ? "" : "s"}.`;
  }

  if (reason === "too_few_days") {
    const desiredRaw = Number(details.desired_total_days ?? details.additional_days ?? "4");
    const desiredTotal = Number.isFinite(desiredRaw) && desiredRaw >= 1 ? Math.max(1, Math.round(desiredRaw)) : 4;
    const effortPref = addedDayEffortPreference(details.added_day_effort);
    const source = context.currentWeek.days.find((day) => day.isWorkout && day.origin !== "extra");
    const totalWorkoutCount = context.currentWeek.days.filter((day) => day.isWorkout).length;
    const totalNeed = Math.max(0, desiredTotal - totalWorkoutCount);

    if (source && context.recovery.poorRecovery) {
      summary = "Recovery is low right now, so no extra sessions were added.";
      safetyFlags.push("Poor recovery prevented additional training days.");
    } else if (source) {
      const lightExercises = source.exercises.slice(0, 2).map((exercise) => ({
        ...toProposedExercise(exercise),
        sets: LIGHT_SESSION_SETS,
        targetRpe: LIGHT_SESSION_RPE,
        suggestedWeightKg: exercise.suggestedWeightKg,
      }));
      const normalExercises = source.exercises.slice(0, 3).map((exercise) => ({
        ...toProposedExercise(exercise),
        sets: Math.max(1, Math.min(3, exercise.sets)),
        targetRpe: Math.min(7, exercise.targetRpe),
      }));
      const workoutDayNumbers = new Set(
        proposed.filter((day) => day.status === "workout").map((day) => day.dayNumber),
      );

      const chooseEffortForDay = (dayNumber: number, priorAddedCount: number): "light" | "normal" => {
        const adjacent = workoutDayNumbers.has(dayNumber - 1) || workoutDayNumbers.has(dayNumber + 1);
        if (effortPref === "light") return "light";
        if (effortPref === "normal") return adjacent ? "light" : "normal";
        if (adjacent) return "light";
        if (priorAddedCount % 2 === 0) return "normal";
        return "light";
      };

      const spacingScore = (dayNumber: number): number => {
        if (workoutDayNumbers.size === 0) return 7;
        let min = 7;
        for (const workoutDay of workoutDayNumbers) {
          min = Math.min(min, Math.abs(workoutDay - dayNumber));
        }
        return min;
      };

      const selectedDayNumbers = new Set(
        proposed
          .filter((day) => day.status === "rest")
          .slice()
          .sort((a, b) => spacingScore(b.dayNumber) - spacingScore(a.dayNumber) || a.dayNumber - b.dayNumber)
          .slice(0, totalNeed)
          .map((day) => day.dayNumber),
      );

      let added = 0;
      proposed = proposed.map((day) => {
        if (day.status !== "rest" || !selectedDayNumbers.has(day.dayNumber)) return day;
        added += 1;
        const effort = chooseEffortForDay(day.dayNumber, added - 1);
        workoutDayNumbers.add(day.dayNumber);
        const rationale =
          effort === "light"
            ? [
                "Low-fatigue addition beside nearby training.",
                "Prefers recoverable work over total stress.",
              ]
            : [
                "Larger recovery window supports a normal session.",
                "No close overlap that would force a lighter day.",
              ];
        changes.push({
          type: "add_session",
          date: day.dateISO,
          reason:
            effort === "light"
              ? "Added a light session that protects recovery."
              : "Added a normal session where recovery space allows.",
        });
        return {
          ...day,
          status: "workout" as const,
          sessionEffort: effort,
          title: effort === "light" ? "Light Session" : "Normal Session",
          rationale,
          exercises: effort === "light" ? lightExercises : normalExercises,
        };
      });
      summary = `Desired total: ${desiredTotal}. Added ${added} session${added === 1 ? "" : "s"} with recoverability-aware effort.`;
    }
  }

  if (reason === "sessions_too_long") {
    proposed = proposed.map((day) => (day.status === "workout" ? dropExercise(day) : day));
    changes.push({ type: "shorten_session", date: effectiveFromDate(context), reason: "Shorter sessions." });
    summary = "Remaining sessions shortened.";
  }

  if (reason === "schedule_changed") {
    const available = details.available_days;
    if (Array.isArray(available) && available.length > 0) {
      const availableDays = available.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
      const workouts = proposed.filter((day) => day.status === "workout");
      const rests = proposed.filter((day) => day.status !== "workout");
      const reassigned: RebuildProposedDay[] = [];
      let idx = 0;
      for (const day of proposed) {
        if (availableDays.includes(day.dayNumber)) {
          if (idx < workouts.length) {
            const moved = workouts[idx];
            reassigned.push({ ...moved, dayNumber: day.dayNumber, dateISO: day.dateISO, existingDayId: day.existingDayId });
            if (moved.dayNumber !== day.dayNumber) changes.push({ type: "move_day", date: day.dateISO, reason: "Moved onto an available day." });
            idx += 1;
          } else {
            reassigned.push(withRest(day));
          }
        } else {
          reassigned.push(withRest(day));
        }
      }
      proposed = reassigned;
      summary = "Remaining training moved onto the days you selected.";
      void rests;
    }
  }

  if (reason === "poor_recovery") {
    proposed = proposed
      .filter((day) => {
        const source = context.currentWeek.days.find((d) => d.dayId === day.existingDayId);
        if (day.status === "workout" && source && (source.origin === "extra" || source.origin === "moved")) {
          changes.push({ type: "remove_session", date: day.dateISO, reason: "Removed an optional session to support recovery." });
          return false;
        }
        return true;
      })
      .map((day) => (day.status === "workout" ? reduceSets(day) : day));
    changes.push({ type: "reduce_volume", date: effectiveFromDate(context), reason: "Lower recovery: reduce volume, preserve loads." });
    summary = "A lighter, more recoverable remainder of the week.";
  }

  if (reason === "pain") {
    safetyFlags.push("Pain reported — keep the week conservative and stop anything that hurts.");
    const stillPresent = details.pain_current === "Yes";
    proposed = proposed.map((day) => (day.status === "workout" ? reduceSets(day) : day));
    changes.push({ type: "reduce_volume", date: effectiveFromDate(context), reason: "Hold progression and reduce stress while pain is present." });
    if (stillPresent) {
      overallAction = "needs_input";
      questions.push({
        id: "pain-location",
        question: "Where is the discomfort?",
        options: ["Shoulder", "Elbow", "Back", "Hip", "Knee", "Other"],
      });
      summary = "Pain needs one answer before the remaining week can be finalised.";
    } else {
      summary = "A conservative remainder of the week while pain settles.";
    }
  }

  if (reason === "exercise_preference") {
    const disliked = details.disliked_exercise;
    if (typeof disliked === "string" && disliked.length > 0) {
      proposed = proposed.map((day) => ({
        ...day,
        exercises: day.exercises.filter((exercise) => exercise.exerciseName !== disliked),
      }));
      changes.push({ type: "change_exercise", date: effectiveFromDate(context), reason: `Removed ${disliked} from remaining sessions.` });
      summary = `Removed ${disliked} from the remaining week.`;
    }
  }

  if (reason === "equipment_problem") {
    safetyFlags.push("Equipment problem reported — kept loads conservative.");
    proposed = proposed.map((day) => (day.status === "workout" ? reduceSets(day) : day));
    summary = "Kept the remainder conservative until the equipment issue is resolved.";
  }

  if (reason === "other") {
    overallAction = "needs_input";
    questions.push({ id: "other-detail", question: "What would you like to change?", options: ["Fewer days", "Shorter sessions", "Lighter loads", "Other"] });
    summary = "Tell us a little more so we can adjust the week safely.";
  }

  return {
    proposalType: "week_rebuild",
    workoutPlanId: context.currentWeek.planId,
    effectiveFromDate: effectiveFromDate(context),
    feedback: { primaryReason: reason },
    overallAction,
    confidence: questions.length ? "needs_input" : "medium",
    summary,
    rationale: [summary],
    preservedDays: preservedDays(context),
    proposedDays: proposed,
    changes,
    questions,
    safetyFlags,
    methodologyVersion: "local-deterministic-rebuild-v1",
  };
}
