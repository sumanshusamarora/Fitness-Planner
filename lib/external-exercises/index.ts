export { externalExerciseContentHash } from "./contentHash";
export {
  matchExternalCandidates,
  scoreMatch,
  type ExternalExerciseForMatch,
} from "./matching";
export {
  canonicalEquipmentGroup,
  canonicalMuscleGroup,
  collapseWhitespace,
  nameKey,
  normalizeLabel,
  normalizeStringList,
  similarity,
  tokenOverlap,
} from "./normalize";
export {
  approveMapping,
  DEFAULT_PROVIDER,
  findExerciseCandidates,
  findExternalExercises,
  getApprovedExternalReferences,
  getCandidatesForExercise,
  getMappedExternalExercise,
  listCanonicalExercisesWithMappings,
  rejectMapping,
  searchExerciseCatalogue,
  upsertSuggestedMapping,
  type CanonicalExerciseWithMappings,
} from "./queries";
export { sanitizeInstructionsHtml } from "./sanitize";
export type * from "./types";
