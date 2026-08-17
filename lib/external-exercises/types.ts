/**
 * Domain types for the external exercise catalogue layer.
 *
 * These describe the *normalized* internal representation, not the raw
 * provider payload. Provider-specific records are normalized by a provider
 * normalizer (see `providers/`) and the original payload is retained in
 * `rawMetadata`.
 */

export type ExternalProvider = "musclewiki";

export type MappingStatus = "suggested" | "approved" | "rejected";

/** The raw, unnormalized record read from a JSONL snapshot line. */
export interface RawExternalRecord {
  slug?: string;
  url?: string;
  name?: string;
  description_html?: string;
  exercise_type?: string;
  muscle_group?: string[] | null;
  secondary_muscle_groups?: string[] | null;
  difficulty?: string | null;
  equipment?: string | string[] | null;
  images?: string[];
  videos?: string[];
  gifs?: string[];
  bodymap_images?: string[];
  error?: string;
  [key: string]: unknown;
}

/** The normalized representation persisted to `external_exercises`. */
export interface NormalizedExternalExercise {
  provider: ExternalProvider;
  externalId: string;
  slug: string | null;
  name: string;
  sourceUrl: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: string | null;
  exerciseType: string | null;
  instructionsSource: string | null;
  rawMetadata: Record<string, unknown>;
  /** URL references (videos/GIFs/images) — references only, never re-hosted. */
  mediaUrls: {
    videos: string[];
    gifs: string[];
    images: string[];
    bodymapImages: string[];
  };
}

/** A canonical exercise as the matching layer sees it. */
export interface CanonicalExerciseSummary {
  id: number;
  name: string;
  primaryMuscle: string;
  equipment: string;
  category: string;
}

/** An explainable match between a canonical exercise and an external one. */
export interface ExerciseMatchCandidate {
  externalExerciseId: number;
  externalId: string;
  provider: ExternalProvider;
  name: string;
  confidence: number; // 0..100
  reasons: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: string | null;
  exerciseType: string | null;
  sourceUrl: string | null;
}

export interface ImportStats {
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
  invalid: number;
  skipped: number;
}

export interface CatalogueSearchFilter {
  q?: string;
  muscles?: string[];
  equipment?: string[];
  difficulty?: string[];
  exerciseType?: string;
}

export interface CatalogueSearchResult {
  id: number;
  provider: ExternalProvider;
  externalId: string;
  name: string;
  sourceUrl: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: string | null;
  exerciseType: string | null;
}
