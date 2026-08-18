import { z } from "zod";

/**
 * Zod schemas for the runtime LLM reasoner's structured outputs.
 *
 * These are server-side only. Every schema is deliberately mode-specific and
 * mirrors the existing deterministic domain types so a validated AI proposal
 * can flow through the existing `WeeklyPlanProposal` review/apply pipeline.
 */

export const CoachQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  prompt: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(1).max(6),
});

export type CoachQuestion = z.infer<typeof CoachQuestionSchema>;

const CoachDecisionBaseSchema = z.object({
  mode: z.string().min(1).max(40),
  recommendation: z.string().min(1).max(240),
  confidence: z.enum(["high", "medium", "needs_input"]),
  rationale: z.array(z.string().min(1).max(320)).min(1).max(5),
  evidence: z.array(z.string().min(1).max(320)).max(8),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        question: z.string().min(1).max(320),
        reason: z.string().min(1).max(320),
        options: z.array(z.string().min(1).max(120)).min(1).max(6),
        required: z.boolean(),
      }),
    )
    .max(3),
  safetyFlags: z.array(z.string().min(1).max(320)).max(5),
  researchUsed: z.boolean(),
});

export const ExtraSessionExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  exerciseName: z.string().min(1).max(120),
  sets: z.number().int().min(1).max(6),
  minReps: z.number().int().min(1).max(30),
  maxReps: z.number().int().min(1).max(30),
  targetRpe: z.number().int().min(1).max(10),
  suggestedWeightKg: z.number().min(0).nullable(),
  restSeconds: z.number().int().min(30).max(600),
  reason: z.string().min(1).max(320),
});

export type ExtraSessionExercise = z.infer<typeof ExtraSessionExerciseSchema>;

export const ExtraSessionCoachDecisionSchema = CoachDecisionBaseSchema.extend({
  action: z.enum(["keep_rest_day", "add_session", "needs_input"]),
  requestedEffort: z.enum(["light", "usual", "heavy"]),
  effectiveEffort: z.enum(["light", "usual", "heavy"]).nullable(),
  reasonSummary: z.string().min(1).max(240),
  relevantRecentTraining: z.array(z.string().min(1).max(320)).max(8),
  relevantUpcomingTraining: z.array(z.string().min(1).max(320)).max(8),
  session: z
    .object({
      title: z.string().min(1).max(120),
      estimatedMinutes: z.number().int().min(5).max(240),
      exercises: z.array(ExtraSessionExerciseSchema).min(1).max(6),
    })
    .nullable(),
});

export type ExtraSessionCoachDecision = z.infer<typeof ExtraSessionCoachDecisionSchema>;

const WeeklyChangeSchema = z.object({
  sourcePlanExerciseId: z.number().int(),
  exerciseId: z.number().int().positive(),
  exerciseName: z.string().min(1).max(120),
  previous: z.object({
    weightKg: z.number().min(0).nullable(),
    sets: z.number().int().min(1).max(10),
    minReps: z.number().int().min(1).max(30),
    maxReps: z.number().int().min(1).max(30),
    targetRpe: z.number().int().min(1).max(10),
  }),
  proposed: z.object({
    weightKg: z.number().min(0).nullable(),
    sets: z.number().int().min(1).max(10),
    minReps: z.number().int().min(1).max(30),
    maxReps: z.number().int().min(1).max(30),
    targetRpe: z.number().int().min(1).max(10),
  }),
  action: z.enum([
    "increase_load",
    "decrease_load",
    "maintain",
    "increase_reps",
    "change_sets",
    "substitute",
    "needs_input",
  ]),
  confidence: z.enum(["high", "medium", "needs-input"]),
  reason: z.string().min(1).max(400),
  evidence: z.array(z.string().min(1).max(320)).max(6),
});

export const ProposedWorkoutDaySchema = z.object({
  sourcePlanDayId: z.number().int(),
  dayNumber: z.number().int().min(1).max(7),
  dayName: z.string().min(1).max(20),
  title: z.string().min(1).max(120),
  exercises: z
    .array(WeeklyChangeSchema.extend({ position: z.number().int().min(1).max(20), restSeconds: z.number().int().min(0).max(600) }))
    .max(12),
});

export const WeeklyPlanProposalSchema = z.object({
  proposalType: z.enum(["initial_week", "next_week"]),
  sourceWeekId: z.number().int().positive().nullable(),
  proposedWeekNumber: z.number().int().positive(),
  proposedStartsOn: z.string().min(8).max(12),
  summary: z.object({
    completedSessions: z.number().int().min(0).max(7),
    plannedSessions: z.number().int().min(0).max(7),
    recoverySummary: z.string().min(1).max(240),
    overallRecommendation: z.string().min(1).max(400),
  }),
  changes: z.array(WeeklyChangeSchema).min(1),
  days: z.array(ProposedWorkoutDaySchema).min(1),
  questions: z.array(CoachQuestionSchema).max(3),
  confidence: z.enum(["high", "medium", "needs-input"]),
  methodologyVersion: z.string().min(1).max(80),
});

export type WeeklyPlanProposalAI = z.infer<typeof WeeklyPlanProposalSchema>;

export const RecoveryCoachDecisionSchema = CoachDecisionBaseSchema.extend({
  action: z.enum(["train_as_planned", "train_lighter", "rest", "needs_input"]),
  suggestedEffort: z.enum(["light", "usual", "heavy"]).nullable(),
});
export type RecoveryCoachDecision = z.infer<typeof RecoveryCoachDecisionSchema>;

export const SubstitutionCoachDecisionSchema = CoachDecisionBaseSchema.extend({
  action: z.enum(["substitute", "keep_exercise", "needs_input"]),
  replacement: z
    .object({
      exerciseId: z.number().int().positive(),
      exerciseName: z.string().min(1).max(120),
      sets: z.number().int().min(1).max(6),
      minReps: z.number().int().min(1).max(30),
      maxReps: z.number().int().min(1).max(30),
      targetRpe: z.number().int().min(1).max(10),
      reason: z.string().min(1).max(320),
    })
    .nullable(),
});

export type SubstitutionCoachDecision = z.infer<typeof SubstitutionCoachDecisionSchema>;

export const NutritionCoachDecisionSchema = CoachDecisionBaseSchema.extend({
  nutritionDataAvailable: z.boolean(),
  focusArea: z.enum(["protein", "calories", "timing", "hydration", "bodyweight", "general", "needs_data"]),
  suggestions: z.array(z.string().min(1).max(320)).max(5),
});

export type NutritionCoachDecision = z.infer<typeof NutritionCoachDecisionSchema>;

const RebuildProposedExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  exerciseName: z.string().min(1).max(120),
  sets: z.number().int().min(1).max(10),
  minReps: z.number().int().min(1).max(30),
  maxReps: z.number().int().min(1).max(30),
  targetRpe: z.number().int().min(1).max(9),
  suggestedWeightKg: z.number().min(0).nullable(),
  restSeconds: z.number().int().min(0).max(600),
});

const RebuildProposedDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(7),
  dateISO: z.string().min(8).max(12),
  status: z.enum(["workout", "rest"]),
  existingDayId: z.number().int().positive().nullable(),
  sessionEffort: z.enum(["light", "normal"]).nullable(),
  title: z.string().min(1).max(120).nullable(),
  rationale: z.array(z.string().min(1).max(200)).max(3),
  exercises: z.array(RebuildProposedExerciseSchema).max(12),
});

const RebuildPreservedDaySchema = z.object({
  dayId: z.number().int().positive(),
  dayNumber: z.number().int().min(1).max(7),
  dateISO: z.string().min(8).max(12),
  reason: z.enum(["completed", "in_progress"]),
});

const RebuildStateEntrySchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().min(1).max(200),
});

const RebuildChangeSchema = z.object({
  type: z.enum([
    "remove_session",
    "add_session",
    "shorten_session",
    "reduce_volume",
    "increase_volume",
    "adjust_load",
    "adjust_rpe",
    "move_day",
    "change_exercise",
    "keep",
  ]),
  date: z.string().min(8).max(12),
  exerciseId: z.number().int().positive().nullable(),
  before: z.array(RebuildStateEntrySchema).max(16).nullable(),
  after: z.array(RebuildStateEntrySchema).max(16).nullable(),
  reason: z.string().min(1).max(320),
});

export const WeekRebuildProposalSchema = z.object({
  proposalType: z.literal("week_rebuild"),
  workoutPlanId: z.number().int().positive(),
  effectiveFromDate: z.string().min(8).max(12),
  feedback: z.object({
    primaryReason: z.string().min(1).max(40),
  }),
  overallAction: z.enum(["keep_plan", "modify_remaining_week", "replace_unstarted_week", "needs_input"]),
  confidence: z.enum(["high", "medium", "needs_input"]),
  summary: z.string().min(1).max(400),
  rationale: z.array(z.string().min(1).max(320)).max(6),
  preservedDays: z.array(RebuildPreservedDaySchema).max(7),
  proposedDays: z.array(RebuildProposedDaySchema).min(1).max(7),
  changes: z.array(RebuildChangeSchema).max(20),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        question: z.string().min(1).max(320),
        reason: z.string().min(1).max(320).nullable(),
        options: z.array(z.string().min(1).max(120)).min(1).max(6),
        required: z.boolean(),
      }),
    )
    .max(3),
  safetyFlags: z.array(z.string().min(1).max(320)).max(5),
  methodologyVersion: z.string().min(1).max(80),
});

export type WeekRebuildProposalAI = z.infer<typeof WeekRebuildProposalSchema>;

export const CoachDecisionSchemas = {
  initial_week: WeeklyPlanProposalSchema,
  next_week: WeeklyPlanProposalSchema,
  extra_session: ExtraSessionCoachDecisionSchema,
  recovery_review: RecoveryCoachDecisionSchema,
  exercise_substitution: SubstitutionCoachDecisionSchema,
  nutrition_review: NutritionCoachDecisionSchema,
  week_rebuild: WeekRebuildProposalSchema,
} as const;
