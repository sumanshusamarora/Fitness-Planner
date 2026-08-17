import {
  canonicalEquipmentGroup,
  canonicalMuscleGroup,
  nameKey,
  similarity,
  tokenOverlap,
} from "./normalize";
import type {
  CanonicalExerciseSummary,
  ExerciseMatchCandidate,
} from "./types";

/** Subset of external_exercises columns used for matching. */
export interface ExternalExerciseForMatch {
  id: number;
  provider: string;
  externalId: string;
  name: string;
  sourceUrl: string | null;
  primaryMuscles: string[] | null;
  secondaryMuscles: string[] | null;
  equipment: string[] | null;
  difficulty: string | null;
  exerciseType: string | null;
}

const NAME_WEIGHT = 60;
const MUSCLE_WEIGHT = 25;
const EQUIPMENT_WEIGHT = 15;

interface Signal {
  score: number;
  weight: number;
  reason: string;
}

function nameSignal(canonicalName: string, externalName: string): Signal {
  if (nameKey(canonicalName) === nameKey(externalName)) {
    return { score: NAME_WEIGHT, weight: NAME_WEIGHT, reason: "exact name match" };
  }
  const sim = similarity(canonicalName, externalName);
  const tok = tokenOverlap(canonicalName, externalName);
  const best = Math.max(sim, tok);
  const score = Math.round(NAME_WEIGHT * best);
  if (best >= 0.6) {
    return { score, weight: NAME_WEIGHT, reason: `partial name match (${Math.round(best * 100)}%)` };
  }
  return { score, weight: NAME_WEIGHT, reason: "weak name match" };
}

function muscleSignal(
  canonicalMuscle: string,
  externalPrimary: string[] | null,
  externalSecondary: string[] | null,
): Signal {
  const canonicalGroup = canonicalMuscleGroup(canonicalMuscle);
  const primaryGroups = new Set((externalPrimary ?? []).map(canonicalMuscleGroup));
  const secondaryGroups = new Set((externalSecondary ?? []).map(canonicalMuscleGroup));

  if (canonicalGroup !== "other" && primaryGroups.has(canonicalGroup)) {
    return { score: MUSCLE_WEIGHT, weight: MUSCLE_WEIGHT, reason: `primary muscle matches (${canonicalGroup})` };
  }
  if (canonicalGroup !== "other" && secondaryGroups.has(canonicalGroup)) {
    return { score: Math.round(MUSCLE_WEIGHT * 0.5), weight: MUSCLE_WEIGHT, reason: `muscle matches as secondary (${canonicalGroup})` };
  }
  const ext = [...primaryGroups, ...secondaryGroups].filter((g) => g !== "other");
  const shown = ext.length ? ext[0] : "unknown";
  return { score: 0, weight: MUSCLE_WEIGHT, reason: `muscle differs (${canonicalGroup} vs ${shown})` };
}

function equipmentSignal(
  canonicalEquipment: string,
  externalEquipment: string[] | null,
): Signal {
  const canonicalGroup = canonicalEquipmentGroup(canonicalEquipment);
  const externalGroups = new Set((externalEquipment ?? []).map(canonicalEquipmentGroup));
  if (canonicalGroup !== "other" && externalGroups.has(canonicalGroup)) {
    return { score: EQUIPMENT_WEIGHT, weight: EQUIPMENT_WEIGHT, reason: `equipment matches (${canonicalGroup})` };
  }
  const shown = [...externalGroups].filter((g) => g !== "other")[0] ?? "unknown";
  return { score: 0, weight: EQUIPMENT_WEIGHT, reason: `equipment differs (${canonicalGroup} vs ${shown})` };
}

/**
 * Score one canonical exercise against one external exercise, returning an
 * explainable candidate with confidence (0..100) and reasons.
 */
export function scoreMatch(
  canonical: CanonicalExerciseSummary,
  external: ExternalExerciseForMatch,
): ExerciseMatchCandidate {
  const signals = [
    nameSignal(canonical.name, external.name),
    muscleSignal(canonical.primaryMuscle, external.primaryMuscles, external.secondaryMuscles),
    equipmentSignal(canonical.equipment, external.equipment),
  ];

  const total = signals.reduce((sum, s) => sum + s.score, 0);
  const confidence = Math.min(100, Math.max(0, Math.round(total)));

  return {
    externalExerciseId: external.id,
    externalId: external.externalId,
    provider: external.provider as ExerciseMatchCandidate["provider"],
    name: external.name,
    confidence,
    reasons: signals.map((s) => `${s.score === s.weight && s.weight > 0 ? "✓" : s.score > 0 ? "~" : "×"} ${s.reason}`),
    primaryMuscles: external.primaryMuscles ?? [],
    secondaryMuscles: external.secondaryMuscles ?? [],
    equipment: external.equipment ?? [],
    difficulty: external.difficulty,
    exerciseType: external.exerciseType,
    sourceUrl: external.sourceUrl,
  };
}

/**
 * Rank all external exercises against one canonical exercise. Deterministic:
 * ties break on name similarity, then external id.
 */
export function matchExternalCandidates(
  canonical: CanonicalExerciseSummary,
  externals: ExternalExerciseForMatch[],
  limit = 10,
): ExerciseMatchCandidate[] {
  return externals
    .map((external) => scoreMatch(canonical, external))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const nameDiff = similarity(canonical.name, b.name) - similarity(canonical.name, a.name);
      if (nameDiff !== 0) return nameDiff;
      return a.externalId.localeCompare(b.externalId);
    })
    .slice(0, limit);
}
