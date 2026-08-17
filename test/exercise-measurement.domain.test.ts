import assert from "node:assert/strict";
import test from "node:test";
import { classifyMeasurementType, measurementTypeFor, requiresWeight, usesSeconds } from "@/lib/exercise-measurement";
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
});

test("requiresWeight and usesSeconds reflect measurement type", () => {
  assert.equal(requiresWeight("weighted_reps"), true);
  assert.equal(requiresWeight("bodyweight_reps"), false);
  assert.equal(usesSeconds("timed_hold"), true);
  assert.equal(usesSeconds("weighted_reps"), false);
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
