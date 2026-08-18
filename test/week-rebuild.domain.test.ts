import assert from "node:assert/strict";
import test from "node:test";
import { assembleProgressAnalytics } from "@/lib/progress";
import {
  computeRebuildConstraints,
  computeWeekRebuildDiff,
  proposeWeekRebuildDeterministic,
  validateWeekRebuildProposal,
} from "@/lib/week-rebuild";
import type {
  RebuildDayContext,
  RebuildDayExercise,
  WeekFeedbackInput,
  WeekRebuildContext,
  WeekRebuildProposal,
} from "@/lib/week-rebuild";

function exercise(overrides: Partial<RebuildDayExercise> = {}): RebuildDayExercise {
  return {
    exerciseId: 1,
    name: "Machine Chest Press",
    primaryMuscle: "Chest",
    equipment: "Machine",
    sets: 3,
    minReps: 8,
    maxReps: 12,
    targetRpe: 6,
    suggestedWeightKg: 20,
    restSeconds: 90,
    ...overrides,
  };
}

function day(overrides: Partial<RebuildDayContext> = {}): RebuildDayContext {
  return {
    dayId: 1,
    dayNumber: 1,
    dayName: "Monday",
    dateISO: "2026-08-17",
    title: "Full Body A",
    origin: null,
    exercises: [exercise()],
    sessionStatus: "none",
    sessionId: null,
    endReason: null,
    modifiable: true,
    isWorkout: true,
    ...overrides,
  };
}

function proposedExercise(exerciseId: number, sets = 3): WeekRebuildProposal["proposedDays"][number]["exercises"][number] {
  return {
    exerciseId,
    exerciseName: "Machine Chest Press",
    sets,
    minReps: 8,
    maxReps: 12,
    targetRpe: 6,
    suggestedWeightKg: 20,
    restSeconds: 90,
  };
}

function emptyProgress() {
  return assembleProgressAnalytics({
    userId: 1,
    anchorDateISO: "2026-08-20",
    profile: { experienceLevel: "beginner", yearsSinceTraining: null, desiredDaysPerWeek: 3 },
    exercises: [],
    exposures: [],
    sessions: [],
    recovery: [],
    plannedSessions: null,
  });
}

function improvingProgress() {
  return assembleProgressAnalytics({
    userId: 1,
    anchorDateISO: "2026-08-20",
    profile: { experienceLevel: "beginner", yearsSinceTraining: null, desiredDaysPerWeek: 3 },
    exercises: [
      { exerciseId: 1, name: "Machine Chest Press", equipment: "Machine", category: "strength", primaryMuscle: "Chest", measurementType: null },
      { exerciseId: 2, name: "Leg Press", equipment: "Machine", category: "strength", primaryMuscle: "Quads", measurementType: null },
    ],
    exposures: [
      {
        exerciseId: 1,
        exposures: [1, 2, 3, 4].map((s) => ({
          sessionId: s,
          completedAt: `2026-08-0${s}`,
          outcome: "attempted" as const,
          skipReason: null,
          sets: [{ weightKg: 20, reps: 8 + s, rpe: 6 }],
        })),
      },
      {
        exerciseId: 2,
        exposures: [1, 2, 3, 4].map((s) => ({
          sessionId: s + 10,
          completedAt: `2026-08-0${s}`,
          outcome: "attempted" as const,
          skipReason: null,
          sets: [{ weightKg: 40, reps: 8 + s, rpe: 6 }],
        })),
      },
    ],
    sessions: [],
    recovery: [],
    plannedSessions: null,
  });
}

function context(overrides: Partial<WeekRebuildContext> = {}): WeekRebuildContext {
  const days = overrides.currentWeek?.days ?? [day()];
  const feedback = overrides.feedback ?? { primaryReason: "other", secondaryReasons: [], structuredDetails: null, freeText: null };
  const base: WeekRebuildContext = {
    user: { id: 1 },
    profile: {
      primaryGoal: null,
      experienceLevel: "beginner",
      yearsSinceTraining: null,
      desiredDaysPerWeek: 3,
      sessionMinutes: "45",
      trainingEnvironment: null,
      limitationsNotes: null,
    },
    currentWeek: {
      planId: 10,
      weekNumber: 4,
      startsOn: "2026-08-17",
      plannedSessions: days.filter((d) => d.isWorkout && d.origin !== "extra").length,
      prescribedSessions: days.filter((d) => d.isWorkout && d.origin !== "extra").length,
      extraSessions: days.filter((d) => d.isWorkout && d.origin === "extra").length,
      completedSessions: days.filter((d) => d.sessionStatus === "completed").length,
      days,
    },
    feedback,
    recovery: {
      latest: { sleep: 7, energy: 7, soreness: 2, jointPain: 1, stress: 3 },
      poorRecovery: false,
      meaningfulJointPain: false,
      trend: "stable",
    },
    progress: emptyProgress(),
    actual: {
      warmupMinutes: 0,
      cardioMinutes: 0,
      mobilityMinutes: 0,
      cooldownMinutes: 0,
      extraWorkingSets: 0,
      replacementWorkingSets: 0,
      addedExercises: 0,
      replacements: [],
    },
    future: { nextWeekKnown: false, remainingDays: [] },
    constraints: computeRebuildConstraints(days, feedback, {
      futureWeekExists: false,
      maxExercisesPerDay: 6,
      minSets: 1,
      maxSets: 6,
      maxRpe: 9,
      allowedExerciseIds: [1, 2],
      recentMuscles: ["Chest"],
    }),
  };
  const merged = {
    ...base,
    ...overrides,
    currentWeek: {
      ...base.currentWeek,
      ...(overrides.currentWeek ?? {}),
      days: overrides.currentWeek?.days ?? days,
    },
  };
  return merged;
}

const feedback = (primaryReason: WeekFeedbackInput["primaryReason"], structuredDetails: Record<string, unknown> | null = null): WeekFeedbackInput => ({
  primaryReason,
  secondaryReasons: [],
  structuredDetails,
  freeText: null,
});

test("constraints mark completed days immutable and future days modifiable", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, sessionStatus: "completed", modifiable: false }),
    day({ dayId: 2, dayNumber: 2, isWorkout: false, exercises: [] }),
    day({ dayId: 3, dayNumber: 3, dateISO: "2026-08-19" }),
  ];
  const constraints = computeRebuildConstraints(days, feedback("too_many_days"), {
    futureWeekExists: false,
    maxExercisesPerDay: 6,
    minSets: 1,
    maxSets: 6,
    maxRpe: 9,
    allowedExerciseIds: [1],
    recentMuscles: [],
  });
  assert.deepEqual(constraints.immutableDayIds, [1]);
  assert.deepEqual(constraints.modifiableDayIds.sort(), [2, 3]);
});

test("too easy with insufficient evidence keeps the plan", () => {
  const proposal = proposeWeekRebuildDeterministic(context({ feedback: feedback("too_easy"), progress: emptyProgress() }));
  assert.equal(proposal.overallAction, "keep_plan");
});

test("too easy with clear improving evidence increases volume conservatively", () => {
  const proposal = proposeWeekRebuildDeterministic(context({ feedback: feedback("too_easy"), progress: improvingProgress() }));
  assert.equal(proposal.overallAction, "replace_unstarted_week");
  assert.ok(proposal.changes.some((c) => c.type === "increase_volume"));
});

test("too difficult reduces sets but preserves working loads", () => {
  const proposal = proposeWeekRebuildDeterministic(context({ feedback: feedback("too_difficult") }));
  const before = context({ feedback: feedback("too_difficult") }).currentWeek.days[0].exercises[0];
  const proposedExercise = proposal.proposedDays[0].exercises[0];
  assert.ok(proposedExercise.sets < before.sets);
  assert.equal(proposedExercise.suggestedWeightKg, before.suggestedWeightKg);
});

test("too many days reduces the remaining session count", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, sessionStatus: "completed", modifiable: false }),
    day({ dayId: 3, dayNumber: 3 }),
    day({ dayId: 5, dayNumber: 5 }),
    day({ dayId: 6, dayNumber: 6 }),
  ];
  const ctx = context({ feedback: feedback("too_many_days", { target_days: "2" }), currentWeek: { days } as WeekRebuildContext["currentWeek"] });
  const proposal = proposeWeekRebuildDeterministic(ctx);
  const workouts = proposal.proposedDays.filter((d) => d.status === "workout");
  assert.equal(workouts.length, 2);
});

test("schedule changed redistributes onto selected available days", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, sessionStatus: "completed", modifiable: false }),
    day({ dayId: 3, dayNumber: 3, dateISO: "2026-08-19" }),
    day({ dayId: 5, dayNumber: 5, dateISO: "2026-08-21" }),
    day({ dayId: 6, dayNumber: 6, dateISO: "2026-08-22", isWorkout: false, exercises: [] }),
    day({ dayId: 7, dayNumber: 7, dateISO: "2026-08-23", isWorkout: false, exercises: [] }),
  ];
  const ctx = context({ feedback: feedback("schedule_changed", { available_days: [6, 7] }), currentWeek: { days } as WeekRebuildContext["currentWeek"] });
  const proposal = proposeWeekRebuildDeterministic(ctx);
  const workoutDays = proposal.proposedDays.filter((d) => d.status === "workout").map((d) => d.dayNumber);
  assert.deepEqual(workoutDays.sort(), [6, 7]);
});

test("pain feedback flags safety and asks for input when still present", () => {
  const proposal = proposeWeekRebuildDeterministic(context({ feedback: feedback("pain", { pain_current: "Yes" }) }));
  assert.equal(proposal.overallAction, "needs_input");
  assert.ok(proposal.safetyFlags.length > 0);
  assert.ok(proposal.questions.length > 0);
});

test("poor recovery reduces volume", () => {
  const proposal = proposeWeekRebuildDeterministic(context({ feedback: feedback("poor_recovery") }));
  assert.ok(proposal.changes.some((c) => c.type === "reduce_volume"));
});

test("diff reports removed sessions and set-volume change", () => {
  const currentDays = [day({ dayId: 3, dayNumber: 3 }), day({ dayId: 5, dayNumber: 5 })];
  const proposedDays: WeekRebuildProposal["proposedDays"] = [
    { dayNumber: 3, dateISO: "2026-08-19", status: "workout", existingDayId: 3, sessionEffort: null, title: "Full Body A", rationale: [], exercises: [proposedExercise(1)] },
    { dayNumber: 5, dateISO: "2026-08-21", status: "rest", existingDayId: 5, sessionEffort: null, title: null, rationale: [], exercises: [] },
  ];
  const diff = computeWeekRebuildDiff(currentDays, proposedDays);
  assert.equal(diff.sessionsBefore, 2);
  assert.equal(diff.sessionsAfter, 1);
  assert.equal(diff.sessionsRemoved, 1);
  assert.ok(diff.summary.length > 0);
});

test("validation rejects proposals that modify completed history", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, sessionStatus: "completed", modifiable: false }),
    day({ dayId: 3, dayNumber: 3 }),
  ];
  const ctx = context({ currentWeek: { days } as WeekRebuildContext["currentWeek"] });
  const proposal: WeekRebuildProposal = {
    proposalType: "week_rebuild",
    workoutPlanId: 10,
    effectiveFromDate: "2026-08-19",
    feedback: { primaryReason: "too_difficult" },
    overallAction: "modify_remaining_week",
    confidence: "medium",
    summary: "x",
    rationale: [],
    preservedDays: [{ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", reason: "completed" }],
    proposedDays: [
      { dayNumber: 1, dateISO: "2026-08-17", status: "rest", existingDayId: 1, sessionEffort: null, title: null, rationale: [], exercises: [] },
      { dayNumber: 3, dateISO: "2026-08-19", status: "workout", existingDayId: 3, sessionEffort: null, title: "Full Body A", rationale: [], exercises: [proposedExercise(1)] },
    ],
    changes: [],
    questions: [],
    safetyFlags: [],
    methodologyVersion: "test",
  };
  assert.throws(() => validateWeekRebuildProposal(proposal, ctx), /immutable day/);
});

test("desired total training days targets the absolute prescribed count", () => {
  const baseDays = [
    day({ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", isWorkout: true }),
    day({ dayId: 2, dayNumber: 2, dateISO: "2026-08-18", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 4, dayNumber: 4, dateISO: "2026-08-20", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 6, dayNumber: 6, dateISO: "2026-08-22", isWorkout: false, exercises: [], title: "Rest" }),
  ];

  const ctx = context({
    feedback: feedback("too_few_days", { desired_total_days: 4, added_day_effort: "normal" }),
    currentWeek: { days: baseDays } as WeekRebuildContext["currentWeek"],
  });

  const proposal = proposeWeekRebuildDeterministic(ctx);
  const workouts = proposal.proposedDays.filter((d) => d.status === "workout");
  assert.equal(workouts.length, 4);
});

test("existing extras do not inflate prescribed-day target", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", isWorkout: true, origin: "extra" }),
    day({ dayId: 2, dayNumber: 2, dateISO: "2026-08-18", isWorkout: true, title: "Full Body B" }),
    day({ dayId: 4, dayNumber: 4, dateISO: "2026-08-20", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 6, dayNumber: 6, dateISO: "2026-08-22", isWorkout: false, exercises: [], title: "Rest" }),
  ];

  const proposal = proposeWeekRebuildDeterministic(
    context({
      feedback: feedback("too_few_days", { desired_total_days: 2, added_day_effort: "light" }),
      currentWeek: { days } as WeekRebuildContext["currentWeek"],
    }),
  );

  assert.equal(proposal.proposedDays.filter((d) => d.status === "workout").length, 2);
});

test("week rebuild accepts added day effort preferences coach_decide/light/normal", () => {
  const baseDays = [
    day({ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", isWorkout: true }),
    day({ dayId: 2, dayNumber: 2, dateISO: "2026-08-18", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 4, dayNumber: 4, dateISO: "2026-08-20", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 6, dayNumber: 6, dateISO: "2026-08-22", isWorkout: false, exercises: [], title: "Rest" }),
  ];

  for (const added_day_effort of ["coach_decide", "light", "normal"]) {
    const ctx = context({
      feedback: feedback("too_few_days", { desired_total_days: 3, added_day_effort }),
      currentWeek: { days: baseDays } as WeekRebuildContext["currentWeek"],
    });
    const proposal = proposeWeekRebuildDeterministic(ctx);
    const added = proposal.proposedDays.filter((d) => d.status === "workout" && d.existingDayId !== 1);
    assert.ok(added.length >= 1);
  }
});

test("light effort request cannot be upgraded to normal", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", isWorkout: true }),
    day({ dayId: 2, dayNumber: 2, dateISO: "2026-08-18", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 5, dayNumber: 5, dateISO: "2026-08-21", isWorkout: false, exercises: [], title: "Rest" }),
  ];
  const proposal = proposeWeekRebuildDeterministic(
    context({
      feedback: feedback("too_few_days", { desired_total_days: 3, added_day_effort: "light" }),
      currentWeek: { days } as WeekRebuildContext["currentWeek"],
    }),
  );
  const addedEfforts = proposal.proposedDays
    .filter((d) => d.status === "workout" && d.existingDayId !== 1)
    .map((d) => d.sessionEffort);
  assert.ok(addedEfforts.every((effort) => effort === "light"));
});

test("normal request may downgrade to light based on adjacency", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", isWorkout: true }),
    day({ dayId: 2, dayNumber: 2, dateISO: "2026-08-18", isWorkout: false, exercises: [], title: "Rest" }),
  ];
  const proposal = proposeWeekRebuildDeterministic(
    context({
      feedback: feedback("too_few_days", { desired_total_days: 2, added_day_effort: "normal" }),
      currentWeek: { days } as WeekRebuildContext["currentWeek"],
    }),
  );
  const added = proposal.proposedDays.find((d) => d.status === "workout" && d.existingDayId !== 1);
  assert.equal(added?.sessionEffort, "light");
});

test("coach_decide may choose different effort levels per added day", () => {
  const days = [
    day({ dayId: 1, dayNumber: 1, dateISO: "2026-08-17", isWorkout: true }),
    day({ dayId: 2, dayNumber: 2, dateISO: "2026-08-18", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 4, dayNumber: 4, dateISO: "2026-08-20", isWorkout: false, exercises: [], title: "Rest" }),
    day({ dayId: 6, dayNumber: 6, dateISO: "2026-08-22", isWorkout: false, exercises: [], title: "Rest" }),
  ];
  const proposal = proposeWeekRebuildDeterministic(
    context({
      feedback: feedback("too_few_days", { desired_total_days: 4, added_day_effort: "coach_decide" }),
      currentWeek: { days } as WeekRebuildContext["currentWeek"],
    }),
  );
  const efforts = new Set(
    proposal.proposedDays
      .filter((d) => d.status === "workout" && d.existingDayId !== 1)
      .map((d) => d.sessionEffort),
  );
  assert.ok(efforts.has("light"));
  assert.ok(efforts.has("normal"));
});

test("rest days always carry null sessionEffort", () => {
  const proposal = proposeWeekRebuildDeterministic(context({ feedback: feedback("too_many_days", { target_days: "1" }) }));
  for (const day of proposal.proposedDays) {
    if (day.status === "rest") assert.equal(day.sessionEffort, null);
  }
});
