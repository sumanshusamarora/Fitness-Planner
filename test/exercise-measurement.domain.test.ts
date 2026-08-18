import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMeasurementType,
  formatLoggedSetForDisplay,
  measurementTypeFor,
  requiresLoadField,
  requiresWeight,
  usesSeconds,
  validateLoggedSet,
} from "@/lib/exercise-measurement";
import { isWeightedResistance } from "@/lib/progress/strengthEstimate";

test("weighted resistance movements are classified weighted_reps", () => {
  assert.equal(
    classifyMeasurementType({ measurementType: null, category: "strength", equipment: "Machine", name: "Leg Press" }),
    "weighted_reps",
  );
  assert.equal(
    classifyMeasurementType({ measurementType: null, category: "strength", equipment: "Dumbbell", name: "Dumbbell Curl" }),
    "weighted_reps",
  );
});

test("bodyweight reps and timed holds are distinguished", () => {
  assert.equal(
    classifyMeasurementType({ measurementType: null, category: "strength", equipment: "Bodyweight", name: "Glute Bridge" }),
    "bodyweight_reps",
  );
  assert.equal(
    classifyMeasurementType({ measurementType: null, category: "core", equipment: "Bodyweight", name: "Plank" }),
    "timed_hold",
  );
});

test("cardio and mobility map to duration-based types", () => {
  assert.equal(
    classifyMeasurementType({ measurementType: null, category: "cardio", equipment: "Machine", name: "Treadmill" }),
    "distance_duration",
  );
  assert.equal(
    classifyMeasurementType({ measurementType: null, category: "mobility", equipment: "Bodyweight", name: "Mobility" }),
    "duration",
  );
});

test("an explicit measurementType wins over classification", () => {
  assert.equal(measurementTypeFor({ measurementType: "timed_hold", category: "strength", equipment: "Machine", name: "X" }), "timed_hold");
  assert.equal(measurementTypeFor({ measurementType: "assisted_reps", category: "strength", equipment: "Machine", name: "X" }), "assisted_reps");
});

test("requiresWeight and usesSeconds reflect measurement type", () => {
  assert.equal(requiresWeight("weighted_reps"), true);
  assert.equal(requiresWeight("bodyweight_reps"), false);
  assert.equal(requiresLoadField("assisted_reps"), true);
  assert.equal(usesSeconds("timed_hold"), true);
  assert.equal(usesSeconds("weighted_reps"), false);
});

test("validation is measurement-aware", () => {
  assert.equal(validateLoggedSet("weighted_reps", { weightKg: 40, reps: 10, rpe: 6 }).ok, true);
  assert.equal(validateLoggedSet("weighted_reps", { weightKg: 0, reps: 10, rpe: 6 }).ok, false);

  assert.equal(validateLoggedSet("bodyweight_reps", { weightKg: 0, reps: 12, rpe: 6 }).ok, true);
  assert.equal(validateLoggedSet("bodyweight_reps", { weightKg: 0, reps: 0, rpe: 6 }).ok, false);

  assert.equal(validateLoggedSet("timed_hold", { weightKg: 0, reps: 30, rpe: 5 }).ok, true);
  assert.equal(validateLoggedSet("timed_hold", { weightKg: 0, reps: 0, rpe: 5 }).ok, false);

  assert.equal(validateLoggedSet("assisted_reps", { weightKg: 25, reps: 8, rpe: 7 }).ok, true);
  assert.equal(validateLoggedSet("assisted_reps", { weightKg: 0, reps: 8, rpe: 7 }).ok, false);
});

test("set formatting avoids fake weight for non-weighted types", () => {
  assert.equal(
    formatLoggedSetForDisplay("weighted_reps", { weightKg: 40, reps: 10, rpe: 6 }),
    "40 kg x 10 @ RPE 6",
  );
  assert.equal(
    formatLoggedSetForDisplay("bodyweight_reps", { weightKg: 0, reps: 12, rpe: 6 }),
    "12 reps @ RPE 6",
  );
  assert.equal(
    formatLoggedSetForDisplay("timed_hold", { weightKg: 0, reps: 30, rpe: 5 }),
    "30 sec @ RPE 5",
  );
  assert.equal(
    formatLoggedSetForDisplay("assisted_reps", { weightKg: 25, reps: 8, rpe: 7 }),
    "25 kg assistance x 8 @ RPE 7",
  );
});

test("e1RM is only eligible for weighted movements", () => {
  const weighted = { equipment: "Machine", category: "strength", primaryMuscle: "Chest", name: "Machine Chest Press", measurementType: null };
  const plank = { equipment: "Bodyweight", category: "core", primaryMuscle: "Core", name: "Plank", measurementType: null };
  const bridge = { equipment: "Bodyweight", category: "strength", primaryMuscle: "Glutes", name: "Glute Bridge", measurementType: null };
  const treadmill = { equipment: "Machine", category: "cardio", primaryMuscle: "Cardiovascular", name: "Treadmill", measurementType: null };
  assert.equal(isWeightedResistance(weighted), true);
  assert.equal(isWeightedResistance(plank), false);
  assert.equal(isWeightedResistance(bridge), false);
  assert.equal(isWeightedResistance(treadmill), false);
});
