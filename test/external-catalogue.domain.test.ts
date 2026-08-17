import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalEquipmentGroup,
  canonicalMuscleGroup,
  normalizeStringList,
  similarity,
} from "@/lib/external-exercises/normalize";
import { matchExternalCandidates, scoreMatch } from "@/lib/external-exercises/matching";
import { sanitizeInstructionsHtml } from "@/lib/external-exercises/sanitize";
import { externalExerciseContentHash } from "@/lib/external-exercises/contentHash";
import type {
  CanonicalExerciseSummary,
  ExternalExerciseForMatch,
} from "@/lib/external-exercises";

const chestPress: CanonicalExerciseSummary = {
  id: 1,
  name: "Machine Chest Press",
  primaryMuscle: "Chest",
  equipment: "Machine",
  category: "strength",
};

function external(
  overrides: Partial<ExternalExerciseForMatch> & { id: number; name: string },
): ExternalExerciseForMatch {
  return {
    provider: "musclewiki",
    externalId: `slug-${overrides.id}`,
    sourceUrl: null,
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    difficulty: null,
    exerciseType: null,
    ...overrides,
  };
}

// --- normalization ---

test("normalizeStringList collapses whitespace and de-duplicates", () => {
  assert.deepEqual(normalizeStringList(["  Chest ", "Chest", "Back / Lats"]), [
    "Chest",
    "Back",
    "Lats",
  ]);
});

test("muscle and equipment group canonicalization", () => {
  assert.equal(canonicalMuscleGroup("Quads"), "quads");
  assert.equal(canonicalMuscleGroup("Quadriceps"), "quads");
  assert.equal(canonicalMuscleGroup("Lateral Head Triceps"), "triceps");
  assert.equal(canonicalEquipmentGroup("Machine"), "machine");
  assert.equal(canonicalEquipmentGroup("Dumbbells"), "dumbbell");
});

test("similarity is high for near-identical names and low for unrelated", () => {
  assert.ok(similarity("Seated Leg Curl", "Seated Leg Curl") === 1);
  assert.ok(similarity("Seated Leg Curl", "Seated Leg Curls") > 0.9);
  assert.ok(similarity("Seated Leg Curl", "Barbell Bench Press") < 0.4);
});

// --- matching ---

test("exact normalized name + muscle + equipment ranks highest", () => {
  const candidates = matchExternalCandidates(chestPress, [
    external({ id: 1, name: "Machine Chest Press", primaryMuscles: ["Chest"], equipment: ["Machine"] }),
    external({ id: 2, name: "Incline Chest Press", primaryMuscles: ["Chest"], equipment: ["Machine"] }),
  ]);
  assert.equal(candidates[0].externalId, "slug-1");
  assert.equal(candidates[0].confidence, 100);
});

test("equipment mismatch lowers confidence", () => {
  const match = scoreMatch(chestPress, external({ id: 1, name: "Machine Chest Press", primaryMuscles: ["Chest"], equipment: ["Dumbbell"] }));
  const exact = scoreMatch(chestPress, external({ id: 2, name: "Machine Chest Press", primaryMuscles: ["Chest"], equipment: ["Machine"] }));
  assert.ok(match.confidence < exact.confidence);
  assert.ok(match.reasons.some((r) => r.includes("equipment differs")));
});

test("muscle agreement improves confidence", () => {
  const rightMuscle = scoreMatch(chestPress, external({ id: 1, name: "Chest Press", primaryMuscles: ["Chest"], equipment: ["Machine"] }));
  const wrongMuscle = scoreMatch(chestPress, external({ id: 2, name: "Chest Press", primaryMuscles: ["Back"], equipment: ["Machine"] }));
  assert.ok(rightMuscle.confidence > wrongMuscle.confidence);
});

test("obviously unrelated exercise ranks poorly", () => {
  const unrelated = scoreMatch(chestPress, external({ id: 1, name: "Treadmill Sprint", primaryMuscles: ["Cardiovascular"], equipment: ["Machine"] }));
  assert.ok(unrelated.confidence < 50);
});

test("secondary muscle match gives partial credit", () => {
  const full = scoreMatch(chestPress, external({ id: 1, name: "Chest Press", primaryMuscles: ["Chest"], equipment: ["Machine"] }));
  const secondary = scoreMatch(chestPress, external({ id: 2, name: "Chest Press", primaryMuscles: [], secondaryMuscles: ["Chest"], equipment: ["Machine"] }));
  assert.ok(secondary.confidence < full.confidence);
  assert.ok(secondary.confidence > 0);
});

test("confidence is explainable via reasons", () => {
  const match = scoreMatch(chestPress, external({ id: 1, name: "Machine Chest Press", primaryMuscles: ["Chest"], equipment: ["Machine"] }));
  assert.equal(match.reasons.length, 3);
  assert.ok(match.reasons.every((r) => r.length > 0));
});

// --- sanitize ---

test("sanitize strips scripts, styles and event handlers", () => {
  const input = `<p>Hello <script>alert(1)</script><b onclick="x()">world</b><img src="javascript:alert(1)"></p>`;
  const out = sanitizeInstructionsHtml(input);
  assert.ok(!out.includes("script"));
  assert.ok(!out.includes("onclick"));
  assert.ok(!out.includes("javascript:"));
  assert.ok(out.includes("<p>"));
});

test("sanitize preserves basic formatting tags", () => {
  const out = sanitizeInstructionsHtml("<h2>Setup</h2><ul><li>One</li><li>Two</li></ul><p>Tip</p>");
  assert.ok(out.includes("<h2>Setup</h2>"));
  assert.ok(out.includes("<li>One</li>"));
  assert.ok(out.includes("<p>Tip</p>"));
});

test("sanitize escapes plain text with special characters", () => {
  const out = sanitizeInstructionsHtml("a < b && c > d");
  assert.ok(out.includes("&lt;"));
  assert.ok(out.includes("&gt;"));
});

// --- content hash ---

test("content hash is stable for identical content and changes with content", () => {
  const base = {
    provider: "musclewiki" as const,
    externalId: "x",
    slug: "x",
    name: "X",
    sourceUrl: null,
    primaryMuscles: ["Chest"],
    secondaryMuscles: [],
    equipment: ["Machine"],
    difficulty: "Beginner",
    exerciseType: null,
    instructionsSource: "<p>hi</p>",
    rawMetadata: {},
    mediaUrls: { videos: [], gifs: [], images: [], bodymapImages: [] },
  };
  const same = externalExerciseContentHash(base);
  const changed = externalExerciseContentHash({ ...base, name: "Y" });
  assert.equal(externalExerciseContentHash(base), same);
  assert.notEqual(same, changed);
});
