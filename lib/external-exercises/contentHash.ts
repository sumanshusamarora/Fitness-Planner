import { createHash } from "node:crypto";
import type { NormalizedExternalExercise } from "./types";

/**
 * A deterministic fingerprint of the fields that matter for detecting change.
 * Two snapshots of the same provider record hash to the same value only when
 * the structured content is identical (media URLs included, so a changed video
 * URL counts as a change). The importer uses this to avoid needless writes.
 */
export function externalExerciseContentHash(
  record: NormalizedExternalExercise,
): string {
  const canonical = JSON.stringify({
    name: record.name,
    primaryMuscles: record.primaryMuscles,
    secondaryMuscles: record.secondaryMuscles,
    equipment: record.equipment,
    difficulty: record.difficulty,
    exerciseType: record.exerciseType,
    instructionsSource: record.instructionsSource,
    sourceUrl: record.sourceUrl,
    mediaUrls: record.mediaUrls,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
