import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeExercise,
  analyzeTolerance,
  assembleProgressAnalytics,
  assessPlateau,
  classifyTrainingStage,
  estimateOneRepMax,
  isWeightedResistance,
  summarizeAdaptation,
} from "@/lib/progress";
import type {
  ExerciseExposure,
  ExerciseMeta,
  ProgressAnalyticsInput,
  RecoveryRecord,
  SessionRecord,
} from "@/lib/progress";

const chest: ExerciseMeta = { exerciseId: 1, name: "Machine Chest Press", equipment: "Machine", category: "strength", primaryMuscle: "Chest", measurementType: null };
const plank: ExerciseMeta = { exerciseId: 2, name: "Plank", equipment: "Bodyweight", category: "core", primaryMuscle: "Core", measurementType: null };
const assistedPullup: ExerciseMeta = { exerciseId: 3, name: "Assisted Pull-Up", equipment: "Assisted Machine", category: "strength", primaryMuscle: "Back", measurementType: "assisted_reps" };

function exp(sessionId: number, dateISO: string, sets: { weightKg: number; reps: number; rpe: number | null }[]): ExerciseExposure {
  return { sessionId, completedAt: dateISO, outcome: "attempted", skipReason: null, sets };
}

function session(id: number, status: SessionRecord["status"] = "completed", endReason: string | null = null): SessionRecord {
  return {
    sessionId: id,
    status,
    startedAt: `2026-08-${String(id).padStart(2, "0")}T10:00:00.000Z`,
    completedAt: `2026-08-${String(id).padStart(2, "0")}T11:00:00.000Z`,
    endReason,
    overallRpe: null,
    energyRating: null,
  };
}

function recovery(dateISO: string, overrides: Partial<RecoveryRecord> = {}): RecoveryRecord {
  return { logDate: dateISO, sleep: 7, energy: 7, soreness: 2, jointPain: 0, stress: 3, ...overrides };
}

function input(partial: Partial<ProgressAnalyticsInput> = {}): ProgressAnalyticsInput {
  return {
    userId: 1,
    anchorDateISO: "2026-08-30",
    profile: { experienceLevel: "beginner", yearsSinceTraining: null, desiredDaysPerWeek: 3 },
    exercises: [chest],
    exposures: [],
    sessions: [],
    recovery: [],
    plannedSessions: null,
    ...partial,
  };
}

const improvingFamily = ["improving_fast", "improving", "improving_slowly"];

test("insufficient data: one exposure yields insufficient_data and no plateau", () => {
  const result = analyzeExercise(chest, [exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }])]);
  assert.equal(result.direction, "insufficient_data");
  assert.equal(result.exposureCount, 1);

  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures: [exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }])] }],
  }));
  assert.equal(analytics.performance.overallDirection, "insufficient_data");
  assert.equal(analytics.plateau.status, "insufficient_data");
});

test("clear improvement: same load, more reps, lower RPE", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 8, rpe: 8 }]),
    exp(2, "2026-08-08", [{ weightKg: 20, reps: 9, rpe: 7 }]),
    exp(3, "2026-08-15", [{ weightKg: 20, reps: 10, rpe: 6.5 }]),
    exp(4, "2026-08-22", [{ weightKg: 20, reps: 11, rpe: 6 }]),
  ];
  const result = analyzeExercise(chest, exposures);
  assert.equal(result.loadTrend, "stable");
  assert.equal(result.repTrend, "increasing");
  assert.equal(result.rpeTrend, "decreasing");
  assert.ok(improvingFamily.includes(result.direction), `expected improving, got ${result.direction}`);
});

test("load improvement: load increases while reps and RPE stay comparable", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 22.5, reps: 10, rpe: 6 }]),
    exp(3, "2026-08-15", [{ weightKg: 25, reps: 10, rpe: 6 }]),
    exp(4, "2026-08-22", [{ weightKg: 27.5, reps: 10, rpe: 6 }]),
  ];
  const result = analyzeExercise(chest, exposures);
  assert.equal(result.loadTrend, "increasing");
  assert.ok(improvingFamily.includes(result.direction), `expected improving, got ${result.direction}`);
});

test("one bad session after four improving exposures is not a plateau or decline", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 8, rpe: 7 }]),
    exp(2, "2026-08-08", [{ weightKg: 20, reps: 9, rpe: 6.5 }]),
    exp(3, "2026-08-15", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(4, "2026-08-22", [{ weightKg: 20, reps: 11, rpe: 6 }]),
    exp(5, "2026-08-29", [{ weightKg: 20, reps: 8, rpe: 9 }]),
  ];
  const result = analyzeExercise(chest, exposures);
  assert.notEqual(result.direction, "declining");
  assert.equal(result.isolatedDip, true);

  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures }],
    sessions: [session(1), session(2), session(3), session(4), session(5)],
    recovery: [recovery("2026-08-01"), recovery("2026-08-15"), recovery("2026-08-29")],
    plannedSessions: 5,
  }));
  assert.notEqual(analytics.plateau.status, "likely");
  assert.notEqual(analytics.plateau.status, "possible");
  assert.ok(analytics.plateau.confounders.some((c) => c.type === "single_anomalous_session"));
});

test("normal slowing: strong early rate then smaller positive rate is not a plateau", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 22, reps: 10, rpe: 6 }]),
    exp(3, "2026-08-15", [{ weightKg: 23.5, reps: 10, rpe: 6 }]),
    exp(4, "2026-08-22", [{ weightKg: 24.5, reps: 10, rpe: 6 }]),
    exp(5, "2026-08-29", [{ weightKg: 25, reps: 10, rpe: 6 }]),
    exp(6, "2026-09-05", [{ weightKg: 25.25, reps: 10, rpe: 6 }]),
  ];
  const adaptation = summarizeAdaptation([analyzeExercise(chest, exposures)]);
  assert.ok(improvingFamily.includes(adaptation.direction), `expected improving, got ${adaptation.direction}`);
  assert.equal(adaptation.trend, "slowing");
  assert.equal(adaptation.interpretation, "normal_flattening");

  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures }],
    sessions: [session(1), session(2), session(3), session(4), session(5), session(6)],
    plannedSessions: 6,
  }));
  assert.notEqual(analytics.plateau.status, "likely");
});

test("likely plateau: flat load, flat reps, rising RPE with good adherence and recovery", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 20, reps: 10, rpe: 6.5 }]),
    exp(3, "2026-08-15", [{ weightKg: 20, reps: 10, rpe: 7 }]),
    exp(4, "2026-08-22", [{ weightKg: 20, reps: 10, rpe: 7.5 }]),
    exp(5, "2026-08-29", [{ weightKg: 20, reps: 10, rpe: 8 }]),
    exp(6, "2026-09-05", [{ weightKg: 20, reps: 10, rpe: 8 }]),
  ];
  const result = analyzeExercise(chest, exposures);
  assert.equal(result.direction, "flat");

  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures }],
    sessions: [session(1), session(2), session(3), session(4), session(5), session(6)],
    recovery: [recovery("2026-08-01"), recovery("2026-08-15"), recovery("2026-08-29")],
    plannedSessions: 6,
  }));
  assert.ok(analytics.plateau.status === "likely" || analytics.plateau.status === "possible");
});

test("poor recovery confounder reduces plateau confidence", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(3, "2026-08-15", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(4, "2026-08-22", [{ weightKg: 20, reps: 10, rpe: 6 }]),
  ];
  const decliningRecovery = [
    recovery("2026-08-01", { sleep: 7, energy: 7, soreness: 2, stress: 2 }),
    recovery("2026-08-15", { sleep: 5, energy: 5, soreness: 5, stress: 5 }),
    recovery("2026-08-29", { sleep: 3, energy: 3, soreness: 8, stress: 8 }),
  ];
  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures }],
    sessions: [session(1), session(2), session(3), session(4)],
    recovery: decliningRecovery,
    plannedSessions: 4,
  }));
  assert.notEqual(analytics.plateau.status, "likely");
  assert.ok(analytics.plateau.confounders.some((c) => c.type === "poor_recovery"));
});

test("work/family skips are scheduling confounders, not poor physiological tolerance", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(3, "2026-08-15", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(4, "2026-08-22", [{ weightKg: 20, reps: 10, rpe: 6 }]),
  ];
  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures }],
    sessions: [session(1), session(2), session(3), session(4), session(5, "skipped", "work"), session(6, "skipped", "family")],
    recovery: [recovery("2026-08-01"), recovery("2026-08-15"), recovery("2026-08-29")],
    plannedSessions: 6,
  }));
  assert.notEqual(analytics.tolerance.trend, "worsening");
  assert.ok(analytics.tolerance.scheduleRelatedEndedEarly >= 2);
  assert.equal(analytics.tolerance.fatigueRelatedEndedEarly, 0);
  assert.notEqual(analytics.plateau.status, "likely");
  assert.ok(analytics.plateau.confounders.some((c) => c.type === "scheduling"));
});

test("pain flags tolerance and adds a plateau confounder", () => {
  const exposures = [
    exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(3, "2026-08-15", [{ weightKg: 20, reps: 10, rpe: 6 }]),
    exp(4, "2026-08-22", [{ weightKg: 20, reps: 10, rpe: 6 }]),
  ];
  const analytics = assembleProgressAnalytics(input({
    exposures: [{ exerciseId: 1, exposures }],
    sessions: [session(1), session(2), session(3), session(4)],
    recovery: [recovery("2026-08-22", { jointPain: 8 })],
    plannedSessions: 4,
  }));
  assert.equal(analytics.tolerance.meaningfulJointPain, true);
  assert.ok(analytics.plateau.confounders.some((c) => c.type === "pain"));
});

test("training tolerance improves when completed work increases with stable recovery and RPE", () => {
  const tolerance = analyzeTolerance({
    plannedSessions: 4,
    sessions: [session(1), session(2), session(3), session(4)],
    sets: [
      { sessionId: 1, rpe: 6 },
      { sessionId: 2, rpe: 6 },
      { sessionId: 2, rpe: 6 },
      { sessionId: 3, rpe: 6 },
      { sessionId: 3, rpe: 6 },
      { sessionId: 3, rpe: 6 },
      { sessionId: 4, rpe: 6 },
      { sessionId: 4, rpe: 6 },
      { sessionId: 4, rpe: 6 },
      { sessionId: 4, rpe: 6 },
    ],
    recovery: [recovery("2026-08-01"), recovery("2026-08-15"), recovery("2026-08-29")],
  });
  assert.equal(tolerance.completedSetsTrend, "increasing");
  assert.equal(tolerance.trend, "improving");
});

test("bodyweight movements never produce an estimated 1RM", () => {
  assert.equal(isWeightedResistance(plank), false);
  assert.ok(Math.abs(estimateOneRepMax(20, 10) - 26.666666666666668) < 1e-9);
  assert.equal(estimateOneRepMax(0, 30), 0);

  const result = analyzeExercise(plank, [
    exp(1, "2026-08-01", [{ weightKg: 0, reps: 30, rpe: 6 }]),
    exp(2, "2026-08-08", [{ weightKg: 0, reps: 35, rpe: 6 }]),
    exp(3, "2026-08-15", [{ weightKg: 0, reps: 40, rpe: 6 }]),
  ]);
  assert.equal(result.supportsCapacityEstimate, false);
  assert.equal(result.capacityTrend, "unsupported");
  assert.ok(improvingFamily.includes(result.direction), `expected improving, got ${result.direction}`);
});

test("assisted reps treat lower assistance as improved performance", () => {
  const result = analyzeExercise(assistedPullup, [
    exp(1, "2026-08-01", [{ weightKg: 35, reps: 8, rpe: 7 }]),
    exp(2, "2026-08-08", [{ weightKg: 30, reps: 8, rpe: 7 }]),
    exp(3, "2026-08-15", [{ weightKg: 25, reps: 8, rpe: 7 }]),
  ]);
  assert.equal(result.loadTrend, "increasing");
  assert.equal(result.supportsCapacityEstimate, false);
  assert.equal(result.capacityTrend, "unsupported");
  assert.ok(improvingFamily.includes(result.direction), `expected improving, got ${result.direction}`);
});

test("training stage is conservative and uses profile plus exposures, not account age", () => {
  assert.equal(classifyTrainingStage({ experienceLevel: "beginner", yearsSinceTraining: null, desiredDaysPerWeek: 3 }, 0, "insufficient_data"), "novice");
  assert.equal(classifyTrainingStage({ experienceLevel: "returning", yearsSinceTraining: 3, desiredDaysPerWeek: 3 }, 5, "insufficient_data"), "returning");
  assert.equal(classifyTrainingStage({ experienceLevel: "intermediate", yearsSinceTraining: null, desiredDaysPerWeek: 3 }, 5, "insufficient_data"), "intermediate");
  assert.equal(classifyTrainingStage({ experienceLevel: null, yearsSinceTraining: null, desiredDaysPerWeek: null }, 0, "insufficient_data"), "unknown");
  assert.equal(classifyTrainingStage({ experienceLevel: "beginner", yearsSinceTraining: null, desiredDaysPerWeek: 3 }, 40, "improving"), "developing");
});

test("assembleProgressAnalytics is user-scoped and preserves the given userId", () => {
  const a = assembleProgressAnalytics(input({ userId: 7 }));
  const b = assembleProgressAnalytics(input({ userId: 8, exercises: [plank] }));
  assert.equal(a.userId, 7);
  assert.equal(b.userId, 8);
  assert.equal(a.exercises[0].name, "Machine Chest Press");
  assert.equal(b.exercises[0].name, "Plank");
});

test("assessPlateau returns insufficient_data below the exposure threshold", () => {
  const result = assessPlateau({
    exercises: [analyzeExercise(chest, [exp(1, "2026-08-01", [{ weightKg: 20, reps: 10, rpe: 6 }])])],
    adherenceRate: 1,
    completedSessions: 1,
    plannedSessions: 1,
    recoveryTrend: "stable",
    meaningfulJointPain: false,
    scheduleConfounders: 0,
    totalAttemptedExposures: 1,
  });
  assert.equal(result.status, "insufficient_data");
});
