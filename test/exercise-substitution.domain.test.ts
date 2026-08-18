import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateKeepCurrent,
  filterSubstitutionCandidates,
  isValidSubstitutionModelDecision,
  rankSubstitutionCandidate,
  type CandidateFact,
} from "@/lib/exercise-substitution";

function candidate(overrides: Partial<Omit<CandidateFact, "score" | "scoreNotes">> = {}): Omit<CandidateFact, "score" | "scoreNotes"> {
  return {
    exerciseId: 101,
    name: "Machine Chest Press",
    relationship: "very_similar",
    movementPattern: "horizontal_push",
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps"],
    equipmentTypes: ["chest_press_machine"],
    availability: "available",
    usedBefore: true,
    successfulExposures: 4,
    preference: null,
    painHistory: 0,
    equipmentBusyFrequency: 0,
    anchorState: null,
    measurementType: "weighted_reps",
    mechanics: "compound",
    laterality: "bilateral",
    stability: "high",
    skillDemand: "medium",
    progressionSuitability: "high",
    ...overrides,
  };
}

const current = {
  exerciseId: 10,
  movementPattern: "horizontal_push",
  primaryMuscle: "Chest",
  measurementType: "weighted_reps",
  category: "strength",
  equipment: "Machine",
  name: "Incline Chest Press",
  mechanics: "compound",
  laterality: "bilateral",
  stability: "high",
  skillDemand: "medium",
} as const;

test("progressing anchor prefers keep current", () => {
  const result = evaluateKeepCurrent(
    "other",
    {
      userId: 1,
      exerciseId: 10,
      usedBefore: true,
      successfulExposures: 6,
      replacementFrequency: 0,
      equipmentBusyFrequency: 0,
      painDiscomfortFrequency: 0,
      preference: null,
      anchorState: "current",
      knownAvailable: true,
      knownUnavailable: false,
    },
    true,
  );

  assert.equal(result.keep, true);
});

test("one equipment-busy event does not force anchor change", () => {
  const result = evaluateKeepCurrent(
    "equipment_busy",
    {
      userId: 1,
      exerciseId: 10,
      usedBefore: true,
      successfulExposures: 6,
      replacementFrequency: 0,
      equipmentBusyFrequency: 1,
      painDiscomfortFrequency: 0,
      preference: null,
      anchorState: "current",
      knownAvailable: true,
      knownUnavailable: false,
    },
    true,
  );

  assert.equal(result.keep, true);
});

test("explicit unavailable candidate is filtered", () => {
  const kept = filterSubstitutionCandidates(current, "equipment_unavailable", [
    candidate({ availability: "unavailable" }),
  ]);
  assert.equal(kept.length, 0);
});

test("unknown availability stays eligible", () => {
  const kept = filterSubstitutionCandidates(current, "other", [
    candidate({ availability: "unknown" }),
  ]);
  assert.equal(kept.length, 1);
});

test("used successfully candidate ranks above unfamiliar equivalent", () => {
  const familiar = rankSubstitutionCandidate(current, candidate({ usedBefore: true, successfulExposures: 3 }));
  const unfamiliar = rankSubstitutionCandidate(current, candidate({ usedBefore: false, successfulExposures: 0 }));
  assert.ok(familiar.score > unfamiliar.score);
});

test("preferred candidate receives ranking boost", () => {
  const preferred = rankSubstitutionCandidate(current, candidate({ preference: "preferred" }));
  const neutral = rankSubstitutionCandidate(current, candidate({ preference: null }));
  assert.ok(preferred.score > neutral.score);
});

test("pain conflicting candidate is filtered for pain reason", () => {
  const kept = filterSubstitutionCandidates(current, "pain_discomfort", [
    candidate({ painHistory: 2 }),
  ]);
  assert.equal(kept.length, 0);
});

test("candidate IDs must be canonical positive integers", () => {
  const kept = filterSubstitutionCandidates(current, "other", [
    candidate({ exerciseId: 0 }),
    candidate({ exerciseId: -4 }),
    candidate({ exerciseId: 11 }),
  ]);
  assert.deepEqual(kept.map((row) => row.exerciseId), [11]);
});

test("LLM selection outside candidate set is rejected", () => {
  const allowed = new Set([11, 12, 13]);
  const invalid = isValidSubstitutionModelDecision(
    {
      decision: "replace",
      selectedExerciseId: 99,
      replacementScope: "temporary",
      reasonCode: "fallback",
      rationale: ["test"],
    },
    allowed,
  );
  const valid = isValidSubstitutionModelDecision(
    {
      decision: "replace",
      selectedExerciseId: 12,
      replacementScope: "temporary",
      reasonCode: "fallback",
      rationale: ["test"],
    },
    allowed,
  );

  assert.equal(invalid, false);
  assert.equal(valid, true);
});
