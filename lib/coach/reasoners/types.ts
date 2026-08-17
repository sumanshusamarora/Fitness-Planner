import type { InitialTrainingContext, TrainingContext, WeekAnalysis, WeeklyPlanProposal } from "../types";
import type {
  ExtraSessionCoachDecision,
  NutritionCoachDecision,
  RecoveryCoachDecision,
  SubstitutionCoachDecision,
} from "../ai/schemas";
import type { RollingCoachContext } from "../ai/context";
import type { CoachRunMetadata } from "../ai/types";
import type { WeekRebuildContext, WeekRebuildProposal } from "@/lib/week-rebuild/types";

export type Effort = "light" | "usual" | "heavy";

export interface ExtraSessionReasonerInput {
  userId: number;
  workoutPlanId: number;
  dayNumber: number;
  requestedEffort: Effort;
}

export interface SubstitutionReasonerInput {
  exerciseId: number;
  exerciseName: string;
  primaryMuscle: string;
  equipment: string;
  reason: string;
  candidates: { exerciseId: number; exerciseName: string; primaryMuscle: string; equipment: string }[];
}

export interface NutritionReviewInput {
  userId: number;
  nutritionDataAvailable?: boolean;
}

export interface ExtraSessionReasoningResult {
  decision: ExtraSessionCoachDecision;
  metadata: CoachRunMetadata;
}

/**
 * All runtime LLM coaching goes through this interface. Implementations must
 * never write to the database and must never silently mutate plans — they only
 * reason and propose.
 */
export interface CoachReasoner {
  proposeInitialWeek(context: InitialTrainingContext): Promise<WeeklyPlanProposal>;
  proposeNextWeek(context: TrainingContext, analysis: WeekAnalysis): Promise<WeeklyPlanProposal>;
  proposeExtraSession(input: ExtraSessionReasonerInput): Promise<ExtraSessionReasoningResult>;
  reviewRecovery(userId: number): Promise<RecoveryCoachDecision>;
  proposeSubstitution(input: SubstitutionReasonerInput): Promise<SubstitutionCoachDecision>;
  reviewNutrition(input: NutritionReviewInput): Promise<NutritionCoachDecision>;
  proposeWeekRebuild(context: WeekRebuildContext): Promise<WeekRebuildProposal>;
}

/** Deterministic fallback library — mirrors the reasoner methods without AI. */
export const deterministicCoach = {
  /** Same signature as the AI reasoner but returns a concrete conservative plan. */
  proposeInitialWeek: async (context: InitialTrainingContext): Promise<WeeklyPlanProposal> => {
    const { proposeFirstWeek } = await import("../proposeFirstWeek");
    return proposeFirstWeek(context);
  },
  proposeNextWeek: async (
    context: TrainingContext,
    analysis: WeekAnalysis,
  ): Promise<WeeklyPlanProposal> => {
    const { proposeNextWeek: buildNextWeek } = await import("../proposeNextWeek");
    return buildNextWeek(context, analysis);
  },
  analyseExtraSession: async (context: RollingCoachContext, requestedEffort: Effort) => {
    const { analyseExtraSessionFromRolling } = await import("../restDay");
    return analyseExtraSessionFromRolling(context, requestedEffort);
  },
  proposeWeekRebuild: async (context: WeekRebuildContext): Promise<WeekRebuildProposal> => {
    const { proposeWeekRebuildDeterministic } = await import("@/lib/week-rebuild/deterministic");
    return proposeWeekRebuildDeterministic(context);
  },
};
