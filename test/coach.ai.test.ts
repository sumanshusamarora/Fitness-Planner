import assert from "node:assert/strict";
import test from "node:test";
import { runCoachDecision } from "@/lib/coach/ai/runCoach";
import { ExtraSessionCoachDecisionSchema, type ExtraSessionCoachDecision } from "@/lib/coach/ai/schemas";
import { CoachInvalidError } from "@/lib/coach/ai/types";
import { validateExtraSessionDecision, validateInitialWeekAIConstraints } from "@/lib/coach/ai/validation";
import { allowedEffortsFor, analyseExtraSessionFromRolling } from "@/lib/coach/restDay";
import type { RollingCoachContext } from "@/lib/coach/ai/context";
import type { WeeklyPlanProposal } from "@/lib/coach/types";

function decision(overrides: Partial<ExtraSessionCoachDecision> = {}): ExtraSessionCoachDecision {
  return {
    mode: "extra_session",
    recommendation: "Add a light session.",
    confidence: "high",
    rationale: ["Recovery looks fine."],
    evidence: [],
    questions: [],
    safetyFlags: [],
    researchUsed: false,
    action: "add_session",
    requestedEffort: "light",
    effectiveEffort: "light",
    reasonSummary: "A light extra session fits today.",
    relevantRecentTraining: [],
    relevantUpcomingTraining: [],
    session: {
      title: "Light Session",
      estimatedMinutes: 30,
      exercises: [
        { exerciseId: 1, exerciseName: "Plank", sets: 1, minReps: 8, maxReps: 12, targetRpe: 5, suggestedWeightKg: null, restSeconds: 60, reason: "Core work." },
      ],
    },
    ...overrides,
  };
}

test("requested effort is a maximum that the model may never exceed", () => {
  assert.deepEqual(allowedEffortsFor("light"), [null, "light"]);
  assert.deepEqual(allowedEffortsFor("usual"), [null, "light", "usual"]);
  assert.deepEqual(allowedEffortsFor("heavy"), [null, "light", "usual", "heavy"]);
});

test("extra-session decision may not upgrade beyond the requested effort", () => {
  assert.throws(
    () => validateExtraSessionDecision(decision({ effectiveEffort: "usual" }), { requestedEffort: "light" }),
    CoachInvalidError,
  );
});

test("extra-session decision may not prescribe RPE 10", () => {
  const d = decision();
  d.session!.exercises[0].targetRpe = 10;
  assert.throws(() => validateExtraSessionDecision(d, { requestedEffort: "light" }), CoachInvalidError);
});

test("extra-session decision may not invent exercises outside the allowed set", () => {
  assert.throws(
    () => validateExtraSessionDecision(decision(), { requestedEffort: "light", allowedExerciseIds: [999] }),
    CoachInvalidError,
  );
});

test("keep_rest_day is valid with no session", () => {
  const result = validateExtraSessionDecision(decision({ action: "keep_rest_day", effectiveEffort: null, session: null }), {
    requestedEffort: "heavy",
  });
  assert.equal(result.action, "keep_rest_day");
  assert.equal(result.session, null);
});

test("needs_input requires at least one question", () => {
  assert.throws(
    () => validateExtraSessionDecision(decision({ action: "needs_input", effectiveEffort: null, session: null }), { requestedEffort: "light" }),
    CoachInvalidError,
  );
});

test("deterministic extra-session analysis downgrades heavy on joint pain", () => {
  const ctx = {
    today: {
      latestRecovery: { sleep: 7, energy: 7, soreness: 3, jointPain: 8, stress: 4 },
      plan: { weekNumber: 4 },
      adjacentMuscles: [],
    },
  } as unknown as RollingCoachContext;
  const result = analyseExtraSessionFromRolling(ctx, "heavy");
  assert.equal(result.effort, "light");
});

test("deterministic extra-session analysis allows heavy when healthy", () => {
  const ctx = {
    today: {
      latestRecovery: { sleep: 7, energy: 7, soreness: 2, jointPain: 1, stress: 3 },
      plan: { weekNumber: 4 },
      adjacentMuscles: [],
    },
  } as unknown as RollingCoachContext;
  const result = analyseExtraSessionFromRolling(ctx, "heavy");
  assert.equal(result.effort, "heavy");
  assert.deepEqual(result.allowedEfforts, [null, "light", "usual", "heavy"]);
});

test("initial-week AI proposal must respect deterministic resistance-day caps", () => {
  const proposal = {
    days: [
      { dayNumber: 1, dayName: "Monday", title: "Full Body", exercises: [{ exerciseId: 1 }] },
      { dayNumber: 2, dayName: "Tuesday", title: "Rest", exercises: [] },
    ],
  } as unknown as WeeklyPlanProposal;
  assert.throws(
    () => validateInitialWeekAIConstraints(proposal, { resistanceDays: [1, 3, 5], maxExercisesPerDay: 6 }),
    CoachInvalidError,
  );
});

test("without OPEN_API_KEY the coach reports unavailable without a network call", async () => {
  const result = await runCoachDecision<ExtraSessionCoachDecision>({
    mode: "extra_session",
    schema: ExtraSessionCoachDecisionSchema,
    context: { requestedEffort: "light" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unavailable");
});
