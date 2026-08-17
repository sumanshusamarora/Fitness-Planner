import {
  collapseWhitespace,
  normalizeLabel,
  normalizeStringList,
} from "../normalize";
import type { NormalizedExternalExercise, RawExternalRecord } from "../types";

export const PROVIDER = "musclewiki" as const;

/**
 * Normalize a raw MuscleWiki JSONL record into the internal representation.
 *
 * - `externalId` is the stable provider slug (the site has no numeric id in the
 *   JSON-LD we scrape).
 * - `primaryMuscles` / `secondaryMuscles` come from the `muscleGroup` /
 *   `secondaryMuscleGroups` arrays.
 * - MuscleWiki's JSON-LD `equipment` field is always "Bodyweight" (a provider
 *   data quirk); the real equipment is in `exerciseType` (Machine, Dumbbells,
 *   Cables, …), so we derive `equipment` from it.
 * - `instructionsSource` keeps the raw HTML; rendering sanitizes it separately.
 * - The full original record is retained in `rawMetadata` verbatim.
 */
export function normalizeMuscleWikiRecord(
  raw: RawExternalRecord,
): NormalizedExternalExercise {
  const slug = raw.slug ? collapseWhitespace(raw.slug) : null;
  const name = raw.name ? collapseWhitespace(raw.name) : null;

  const equipment = normalizeStringList(raw.exercise_type);
  if (equipment.length === 0) {
    equipment.push(...normalizeStringList(raw.equipment));
  }

  return {
    provider: PROVIDER,
    externalId: slug ?? name ?? "",
    slug,
    name: name ?? "",
    sourceUrl: raw.url ? collapseWhitespace(raw.url) : null,
    primaryMuscles: normalizeStringList(raw.muscle_group),
    secondaryMuscles: normalizeStringList(raw.secondary_muscle_groups),
    equipment,
    difficulty: normalizeLabel(raw.difficulty),
    exerciseType: null,
    instructionsSource:
      typeof raw.description_html === "string" ? raw.description_html : null,
    rawMetadata: raw as unknown as Record<string, unknown>,
    mediaUrls: {
      videos: normalizeStringList(raw.videos),
      gifs: normalizeStringList(raw.gifs),
      images: normalizeStringList(raw.images),
      bodymapImages: normalizeStringList(raw.bodymap_images),
    },
  };
}

/**
 * Validate a normalized record. A record is importable only if it has both an
 * external id and a non-empty name. Records carrying a scraper `error` marker
 * are treated as invalid.
 */
export function isValidMuscleWikiRecord(
  raw: RawExternalRecord,
  normalized: NormalizedExternalExercise,
): { valid: boolean; reason?: string } {
  if (raw.error) return { valid: false, reason: `scraper error: ${raw.error}` };
  if (!normalized.externalId) return { valid: false, reason: "missing external id/slug" };
  if (!normalized.name) return { valid: false, reason: "missing name" };
  return { valid: true };
}
