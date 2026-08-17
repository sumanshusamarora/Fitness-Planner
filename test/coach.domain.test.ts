import assert from "node:assert/strict";
import test from "node:test";
import { analyseWeek } from "@/lib/coach/analyseWeek";
import { proposeNextWeek } from "@/lib/coach/proposeNextWeek";
import { summariseRecovery } from "@/lib/coach/recovery";
import { recommendNextWeight } from "@/lib/progression";
import type { TrainingContext } from "@/lib/coach/types";

function context(overrides: Partial<TrainingContext> = {}): TrainingContext {
  return {
    user: { id: 1, name: "Test", dateOfBirth: "1990-01-01", heightCm: null },
    sourcePlan: { id: 10, weekNumber: 1, startsOn: "2026-08-17", name: "Week 1", notes: null },
    plannedSessions: 1,
    completedSessions: 1,
    missedDays: [],
    sessionOutcomes: [],
    recovery: summariseRecovery([{ sleep: 7, energy: 7, soreness: 3, jointPain: 1, stress: 4, notes: null }]),
    exercises: [{
      sourcePlanExerciseId: 100,
      sourcePlanDayId: 20,
      dayNumber: 1,
      dayName: "Mon",
      dayTitle: "Full body",
      position: 1,
      exerciseId: 5,
      exerciseName: "Chest Press",
      primaryMuscle: "Chest",
      equipment: "Machine",
      targetSets: 2,
      minReps: 8,
      maxReps: 12,
      targetRpe: 6,
      suggestedWeightKg: 20,
      restSeconds: 90,
      recentExposures: [{
        completedAt: "2026-08-18T10:00:00.000Z",
        weightKg: 20,
        belongsToSourceWeek: true,
        dayNumber: 1,
        sets: [{ weightKg: 20, reps: 12, rpe: 6 }, { weightKg: 20, reps: 12, rpe: 6 }],
      }],
    }],
    ...overrides,
  };
}

test("normal progression increases load at the top of the range", () => {
  const result = recommendNextWeight({
    targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, lastWeightKg: 20,
    lastSets: [{ reps: 12, rpe: 6 }, { reps: 12, rpe: 6 }],
  });
  assert.equal(result.recommendedWeight, 22.5);
  assert.equal(proposeNextWeek(context(), analyseWeek(context())).changes[0].action, "increase_load");
});

test("rep progression holds load inside the range", () => {
  const result = recommendNextWeight({
    targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, lastWeightKg: 20,
    lastSets: [{ reps: 10, rpe: 6 }, { reps: 11, rpe: 6 }],
  });
  assert.equal(result.recommendedWeight, 20);
});

test("excessive effort blocks automatic increase", () => {
  const result = recommendNextWeight({
    targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, lastWeightKg: 20,
    lastSets: [{ reps: 12, rpe: 8 }, { reps: 12, rpe: 8 }],
  });
  assert.equal(result.recommendedWeight, 20);
});

test("meaningful joint pain requires input and blocks progression", () => {
  const painful = context({
    recovery: summariseRecovery([{ sleep: 7, energy: 7, soreness: 3, jointPain: 8, stress: 4, notes: "Shoulder sore" }]),
  });
  const proposal = proposeNextWeek(painful, analyseWeek(painful));
  assert.equal(proposal.confidence, "needs-input");
  assert.equal(proposal.changes[0].action, "needs_input");
  assert.equal(proposal.questions.length, 1);
});

test("poor recovery keeps the proposal conservative", () => {
  const tired = context({
    recovery: summariseRecovery([{ sleep: 3, energy: 3, soreness: 8, jointPain: 1, stress: 8, notes: null }]),
  });
  const proposal = proposeNextWeek(tired, analyseWeek(tired));
  assert.equal(proposal.changes[0].proposed.weightKg, 20);
  assert.equal(proposal.changes[0].confidence, "medium");
});

test("one missed workout is not assumed to be a recovery problem", () => {
  const missed = context({ plannedSessions: 2, completedSessions: 1, missedDays: [{ dayNumber: 2, dayName: "Wed", title: "Full body" }] });
  const proposal = proposeNextWeek(missed, analyseWeek(missed));
  assert.equal(proposal.questions.length, 0);
});

test("missing optional recovery data remains unknown", () => {
  const recovery = summariseRecovery([]);
  assert.equal(recovery.entries, 0);
  assert.equal(recovery.average, null);
  assert.equal(recovery.poorRecovery, false);
});

test("proposal generation is a pure review step and leaves source context unchanged", () => {
  const source = context();
  const before = JSON.stringify(source);
  const proposal = proposeNextWeek(source, analyseWeek(source));
  assert.equal(proposal.proposedWeekNumber, 2);
  assert.equal(JSON.stringify(source), before);
});
