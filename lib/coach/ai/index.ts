export { isAICoachAvailable, getOpenAIClient, resetOpenAIClient, COACH_MODEL, DEFAULT_COACH_MODEL } from "./client";
export { buildCoachPrompt, runCoachDecision, REASONING_EFFORT } from "./runCoach";
export type { CoachDecisionResult, CoachDecisionFailure, CoachDecisionRunOptions, CoachPrompt } from "./runCoach";
export { buildRollingCoachContext, assemblePastTraining, computeFutureWindow } from "./context";
export type { RollingCoachContext, PastTrainingSummary, FutureWindowSummary } from "./context";
export {
  CoachDecisionSchemas,
  WeeklyPlanProposalSchema,
  ExtraSessionCoachDecisionSchema,
  RecoveryCoachDecisionSchema,
  SubstitutionCoachDecisionSchema,
  NutritionCoachDecisionSchema,
} from "./schemas";
export type {
  WeeklyPlanProposalAI,
  ExtraSessionCoachDecision,
  RecoveryCoachDecision,
  SubstitutionCoachDecision,
  NutritionCoachDecision,
} from "./schemas";
export {
  validateAIWeeklyProposal,
  validateExtraSessionDecision,
  validateInitialWeekAIConstraints,
  exerciseIsAllowed,
} from "./validation";
export { CoachUnavailableError, CoachInvalidError } from "./types";
export type { CoachMode, CoachReasoningEffort, CoachRunMetadata } from "./types";
