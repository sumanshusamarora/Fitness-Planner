import { eq } from "drizzle-orm";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { addDaysToISODate, startOfWeekMonday, toISODate } from "@/lib/dates";
import { buildRollingCoachContext } from "../ai/context";
import { runCoachDecision, type CoachDecisionFailure, type CoachDecisionResult } from "../ai/runCoach";
import {
  ExtraSessionCoachDecisionSchema,
  NutritionCoachDecisionSchema,
  RecoveryCoachDecisionSchema,
  SubstitutionCoachDecisionSchema,
  WeeklyPlanProposalSchema,
  WeekRebuildProposalSchema,
  type ExtraSessionCoachDecision,
  type NutritionCoachDecision,
  type RecoveryCoachDecision,
  type SubstitutionCoachDecision,
  type WeeklyPlanProposalAI,
  type WeekRebuildProposalAI,
} from "../ai/schemas";
import { CoachInvalidError, CoachUnavailableError } from "../ai/types";
import { validateAIWeeklyProposal, validateExtraSessionDecision, validateInitialWeekAIConstraints } from "../ai/validation";
import { validateWeekRebuildProposal } from "@/lib/week-rebuild/validate";
import { getRecentWeekFeedbackSummary } from "@/lib/week-rebuild/feedback";
import type { WeekRebuildContext, WeekRebuildProposal } from "@/lib/week-rebuild/types";
import { buildExtraSessionContext, analyseExtraSessionFromRolling } from "../restDay";
import { initialWeekCandidateNames, initialWeekConstraints } from "../proposeFirstWeek";
import type { InitialTrainingContext, TrainingContext, WeekAnalysis, WeeklyPlanProposal } from "../types";
import type {
  CoachReasoner,
  ExtraSessionReasonerInput,
  NutritionReviewInput,
  SubstitutionReasonerInput,
} from "./types";

function throwForFailure(result: CoachDecisionFailure): never {
  if (result.code === "invalid") throw new CoachInvalidError(result.reason);
  throw new CoachUnavailableError(result.reason);
}

function isSuccess<T>(result: CoachDecisionResult<T> | CoachDecisionFailure): result is CoachDecisionResult<T> {
  return result.ok;
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface CompactExercise {
  exerciseId: number;
  name: string;
  primaryMuscle: string;
  equipment: string;
}

/**
 * Runtime AI coaching backed by GPT-5. Read-only: every method only reasons
 * and returns a proposal/decision; writes remain in applyProposal/
 * applyPlanAdjustment behind explicit approval. Any failure (missing key, API
 * error, invalid output) surfaces as a CoachUnavailable/Invalid error so the
 * caller can fall back to the deterministic coach.
 */
export class OpenAICoachReasoner implements CoachReasoner {
  async proposeInitialWeek(context: InitialTrainingContext): Promise<WeeklyPlanProposal> {
    const constraints = initialWeekConstraints(context);
    const rolling = await buildRollingCoachContext({ userId: context.user.id });

    const library = await db
      .select({ id: exercises.id, name: exercises.name, primaryMuscle: exercises.primaryMuscle, equipment: exercises.equipment })
      .from(exercises)
      .where(eq(exercises.active, true));
    const candidateNames = new Set(initialWeekCandidateNames(context.profile.trainingEnvironment));
    const candidates: CompactExercise[] = library
      .filter((exercise) => candidateNames.has(exercise.name))
      .map((exercise) => ({
        exerciseId: exercise.id,
        name: exercise.name,
        primaryMuscle: exercise.primaryMuscle,
        equipment: exercise.equipment,
      }));

    const result = await runCoachDecision<WeeklyPlanProposalAI>({
      mode: "initial_week",
      schema: WeeklyPlanProposalSchema,
      reasoningEffort: "high",
      context: {
        user: { id: context.user.id },
        profile: {
          primaryGoal: context.profile.primaryGoal,
          experienceLevel: context.profile.experienceLevel,
          yearsSinceTraining: context.profile.yearsSinceTraining,
          desiredDaysPerWeek: context.profile.desiredDaysPerWeek,
          preferredDays: context.profile.preferredDays,
          sessionMinutes: context.profile.sessionMinutes,
          trainingEnvironment: context.profile.trainingEnvironment,
          equipmentNotes: context.profile.equipmentNotes,
          limitationsNotes: context.profile.limitationsNotes,
        },
        recovery: context.recovery.latest,
        rolling,
        candidateExercises: candidates,
        recentFeedback: await getRecentWeekFeedbackSummary(context.user.id),
      },
      constraints: {
        resistanceDays: constraints.resistanceDays,
        maxExercisesPerDay: constraints.maxExercisesPerDay,
        sets: constraints.sets,
        rpe: constraints.rpe,
      },
    });
    if (!isSuccess(result)) throwForFailure(result);

    const ai = result.decision;
    const proposal: WeeklyPlanProposal = {
      ...ai,
      proposalType: "initial_week",
      sourceWeekId: null,
      proposedWeekNumber: 1,
      proposedStartsOn: toISODate(startOfWeekMonday(new Date())),
      aiMetadata: result.metadata,
      methodologyVersion: `openai-${result.metadata.model}-v1`,
    };

    // Normalise to the deterministic initial-week conventions: unique negative
    // source IDs and starting loads where previous === proposed.
    let counter = -1;
    proposal.days = proposal.days.map((day) => ({
      ...day,
      sourcePlanDayId: -day.dayNumber,
      exercises: day.exercises.map((exercise) => {
        const id = counter--;
        return { ...exercise, sourcePlanExerciseId: id, previous: exercise.proposed };
      }),
    }));

    // Ensure a full Monday–Sunday week, filling any missing rest days so the
    // Week 1 plan mirrors the deterministic builder exactly.
    const presentDays = new Set(proposal.days.map((day) => day.dayNumber));
    for (let dayNumber = 1; dayNumber <= 7; dayNumber++) {
      if (!presentDays.has(dayNumber)) {
        proposal.days.push({
          sourcePlanDayId: -dayNumber,
          dayNumber,
          dayName: DAY_NAMES[dayNumber],
          title: "Rest",
          exercises: [],
        });
      }
    }
    proposal.days.sort((a, b) => a.dayNumber - b.dayNumber);

    proposal.changes = proposal.days.flatMap((day) =>
      day.exercises.map(({ position, restSeconds, ...change }) => change),
    );

    validateInitialWeekAIConstraints(proposal, constraints);
    await validateAIWeeklyProposal(proposal);
    return proposal;
  }

  async proposeNextWeek(context: TrainingContext, analysis: WeekAnalysis): Promise<WeeklyPlanProposal> {
    const rolling = await buildRollingCoachContext({ userId: context.user.id });

    const sourceByExercise = new Map(context.exercises.map((exercise) => [exercise.sourcePlanExerciseId, exercise]));
    const result = await runCoachDecision<WeeklyPlanProposalAI>({
      mode: "next_week",
      schema: WeeklyPlanProposalSchema,
      reasoningEffort: "high",
      context: {
        user: { id: context.user.id },
        profile: rolling.profile,
        sourceWeek: {
          weekNumber: context.sourcePlan.weekNumber,
          startsOn: context.sourcePlan.startsOn,
          name: context.sourcePlan.name,
          notes: context.sourcePlan.notes,
          completedSessions: context.completedSessions,
          plannedSessions: context.plannedSessions,
          missedDays: context.missedDays,
          sessionOutcomes: context.sessionOutcomes,
        },
        recovery: {
          entries: context.recovery.entries,
          latest: context.recovery.latest,
          average: context.recovery.average,
          poorRecovery: context.recovery.poorRecovery,
          meaningfulJointPain: context.recovery.meaningfulJointPain,
        },
        exercises: context.exercises.map((exercise) => ({
          sourcePlanExerciseId: exercise.sourcePlanExerciseId,
          dayNumber: exercise.dayNumber,
          dayName: exercise.dayName,
          exerciseName: exercise.exerciseName,
          primaryMuscle: exercise.primaryMuscle,
          equipment: exercise.equipment,
          position: exercise.position,
          targetSets: exercise.targetSets,
          minReps: exercise.minReps,
          maxReps: exercise.maxReps,
          targetRpe: exercise.targetRpe,
          suggestedWeightKg: exercise.suggestedWeightKg,
          restSeconds: exercise.restSeconds,
          analysis: analysis.exerciseAnalyses[exercise.sourcePlanExerciseId],
          recentExposures: exercise.recentExposures.map((exposure) => ({
            completedAt: exposure.completedAt,
            weightKg: exposure.weightKg,
            sets: exposure.sets,
            belongsToSourceWeek: exposure.belongsToSourceWeek,
          })),
        })),
        weekAnalysis: {
          completedSessions: analysis.completedSessions,
          plannedSessions: analysis.plannedSessions,
          missedSessions: analysis.missedSessions,
          recoverySummary: analysis.recoverySummary,
          hasMaterialSafetyFlag: analysis.hasMaterialSafetyFlag,
        },
        progress: context.progress,
        rolling,
        recentFeedback: await getRecentWeekFeedbackSummary(context.user.id),
      },
    });
    if (!isSuccess(result)) throwForFailure(result);

    const ai = result.decision;
    const proposal: WeeklyPlanProposal = {
      ...ai,
      proposalType: "next_week",
      sourceWeekId: context.sourcePlan.id,
      proposedWeekNumber: context.sourcePlan.weekNumber + 1,
      proposedStartsOn: addDaysToISODate(context.sourcePlan.startsOn, 7),
      aiMetadata: result.metadata,
      methodologyVersion: `openai-${result.metadata.model}-v1`,
    };

    // Keep-decision loads must reference the real source plan, never model-invented values.
    proposal.days = proposal.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => {
        const source = sourceByExercise.get(exercise.sourcePlanExerciseId);
        return {
          ...exercise,
          previous: source
            ? {
                weightKg: source.suggestedWeightKg,
                sets: source.targetSets,
                minReps: source.minReps,
                maxReps: source.maxReps,
                targetRpe: source.targetRpe,
              }
            : exercise.previous,
        };
      }),
    }));
    proposal.changes = proposal.days.flatMap((day) =>
      day.exercises.map(({ position, restSeconds, ...change }) => change),
    );

    await validateAIWeeklyProposal(proposal, context);
    return proposal;
  }

  async proposeExtraSession(input: ExtraSessionReasonerInput) {
    const [rolling, base] = await Promise.all([
      buildRollingCoachContext({ userId: input.userId }),
      buildExtraSessionContext(input),
    ]);
    const deterministic = analyseExtraSessionFromRolling(rolling, input.requestedEffort);

    const result = await runCoachDecision<ExtraSessionCoachDecision>({
      mode: "extra_session",
      schema: ExtraSessionCoachDecisionSchema,
      context: {
        user: { id: input.userId },
        today: rolling.today,
        requestedEffort: input.requestedEffort,
        deterministic,
        plan: { weekNumber: base.plan.weekNumber, name: base.plan.name },
        adjacentMuscles: base.adjacentMuscles,
        candidateExercises: base.candidates,
        progress: rolling.progress,
        past: {
          sessionsCompleted: rolling.past.sessionsCompleted,
          sessionsEndedEarly: rolling.past.sessionsEndedEarly,
          sessionsSkipped: rolling.past.sessionsSkipped,
          averageRpe: rolling.past.averageRpe,
          latestRpe: rolling.past.latestRpe,
          rpeTrend: rolling.past.rpeTrend,
          muscleSets: rolling.past.muscleSets,
          painFlags: rolling.past.painFlags,
          workouts: rolling.past.workouts,
        },
      },
      constraints: { allowedEfforts: deterministic.allowedEfforts },
    });
    if (!isSuccess(result)) throwForFailure(result);

    const decision = validateExtraSessionDecision(result.decision, {
      requestedEffort: input.requestedEffort,
      allowedExerciseIds: base.candidates.map((candidate) => candidate.exerciseId),
    });
    if (decision.requestedEffort !== input.requestedEffort) {
      throw new CoachInvalidError("The model echoed a different requested effort than provided.");
    }
    return { decision, metadata: result.metadata };
  }

  async reviewRecovery(userId: number): Promise<RecoveryCoachDecision> {
    const rolling = await buildRollingCoachContext({ userId });
    const result = await runCoachDecision<RecoveryCoachDecision>({
      mode: "recovery_review",
      schema: RecoveryCoachDecisionSchema,
      context: {
        user: { id: userId },
        today: rolling.today,
        progress: rolling.progress,
        past: {
          sessionsCompleted: rolling.past.sessionsCompleted,
          sessionsEndedEarly: rolling.past.sessionsEndedEarly,
          averageRpe: rolling.past.averageRpe,
          latestRpe: rolling.past.latestRpe,
          rpeTrend: rolling.past.rpeTrend,
          painFlags: rolling.past.painFlags,
          muscleSets: rolling.past.muscleSets,
        },
        future: rolling.future,
      },
    });
    if (!isSuccess(result)) throwForFailure(result);
    return result.decision;
  }

  async proposeSubstitution(input: SubstitutionReasonerInput): Promise<SubstitutionCoachDecision> {
    const result = await runCoachDecision<SubstitutionCoachDecision>({
      mode: "exercise_substitution",
      schema: SubstitutionCoachDecisionSchema,
      context: {
        exercise: {
          exerciseId: input.exerciseId,
          name: input.exerciseName,
          primaryMuscle: input.primaryMuscle,
          equipment: input.equipment,
        },
        reason: input.reason,
        candidates: input.candidates,
      },
      constraints: { allowedExerciseIds: input.candidates.map((candidate) => candidate.exerciseId) },
    });
    if (!isSuccess(result)) throwForFailure(result);

    const decision = result.decision;
    if (decision.action === "substitute") {
      const replacementId = decision.replacement?.exerciseId;
      if (!input.candidates.some((candidate) => candidate.exerciseId === replacementId)) {
        throw new CoachInvalidError("Replacement exercise is not in the allowed candidate set.");
      }
    }
    return decision;
  }

  async reviewNutrition(input: NutritionReviewInput): Promise<NutritionCoachDecision> {
    if (input.nutritionDataAvailable === false) {
      return {
        mode: "nutrition_review",
        recommendation: "Nutrition guidance needs food and bodyweight data.",
        confidence: "needs_input",
        rationale: ["There is no diet data to coach against yet."],
        evidence: [],
        questions: [
          {
            id: "nutrition-data",
            question: "Track your meals and bodyweight for a few days and ask again.",
            reason: "Coaching nutrition without intake data would be guesswork.",
            options: ["I'll start tracking", "Skip for now"],
            required: false,
          },
        ],
        safetyFlags: [],
        researchUsed: false,
        nutritionDataAvailable: false,
        focusArea: "needs_data",
        suggestions: [],
      };
    }

    const rolling = await buildRollingCoachContext({ userId: input.userId });
    const result = await runCoachDecision<NutritionCoachDecision>({
      mode: "nutrition_review",
      schema: NutritionCoachDecisionSchema,
      context: {
        user: { id: input.userId },
        profile: rolling.profile,
        today: rolling.today,
        past: {
          sessionsCompleted: rolling.past.sessionsCompleted,
          averageRpe: rolling.past.averageRpe,
          rpeTrend: rolling.past.rpeTrend,
          muscleSets: rolling.past.muscleSets,
        },
      },
    });
    if (!isSuccess(result)) throwForFailure(result);
    return result.decision;
  }

  async proposeWeekRebuild(context: WeekRebuildContext): Promise<WeekRebuildProposal> {
    const result = await runCoachDecision<WeekRebuildProposalAI>({
      mode: "week_rebuild",
      schema: WeekRebuildProposalSchema,
      reasoningEffort: "high",
      context: buildRebuildAIContext(context),
      constraints: {
        modifiableDayNumbers: context.currentWeek.days.filter((d) => d.modifiable).map((d) => d.dayNumber),
        remainingAvailableDayNumbers: context.constraints.remainingAvailableDayNumbers,
        maxExercisesPerDay: context.constraints.maxExercisesPerDay,
        minSets: context.constraints.minSets,
        maxSets: context.constraints.maxSets,
        maxRpe: context.constraints.maxRpe,
        allowedExerciseIds: context.constraints.allowedExerciseIds,
      },
    });
    if (!isSuccess(result)) throwForFailure(result);

    const proposal: WeekRebuildProposal = {
      ...result.decision,
      feedback: {
        primaryReason: result.decision.feedback.primaryReason as WeekRebuildProposal["feedback"]["primaryReason"],
      },
      changes: result.decision.changes.map((change) => ({
        ...change,
        exerciseId: change.exerciseId ?? undefined,
        before: toRecord(change.before),
        after: toRecord(change.after),
      })),
      questions: result.decision.questions.map((question) => ({
        ...question,
        reason: question.reason ?? undefined,
        required: question.required,
      })),
      aiMetadata: result.metadata,
    };
    try {
      validateWeekRebuildProposal(proposal, context);
    } catch (error) {
      throw new CoachInvalidError(error instanceof Error ? error.message : "Invalid week-rebuild proposal.");
    }
    return proposal;
  }
}

function buildRebuildAIContext(context: WeekRebuildContext) {
  const progress = context.progress;
  return {
    user: { id: context.user.id },
    profile: context.profile,
    feedback: context.feedback,
    recovery: context.recovery,
    progress: {
      trainingStage: progress.trainingStage,
      performance: progress.performance,
      tolerance: {
        trend: progress.tolerance.trend,
        adherenceRate: progress.tolerance.adherenceRate,
        recoveryTrend: progress.tolerance.recoveryTrend,
        meaningfulJointPain: progress.tolerance.meaningfulJointPain,
        painFlags: progress.tolerance.painFlags,
        evidence: progress.tolerance.evidence,
      },
      adaptation: progress.adaptation,
      plateau: progress.plateau,
    },
    currentWeek: {
      planId: context.currentWeek.planId,
      weekNumber: context.currentWeek.weekNumber,
      startsOn: context.currentWeek.startsOn,
      completedSessions: context.currentWeek.completedSessions,
      plannedSessions: context.currentWeek.plannedSessions,
      days: context.currentWeek.days.map((day) => ({
        dayId: day.dayId,
        dayNumber: day.dayNumber,
        dayName: day.dayName,
        dateISO: day.dateISO,
        title: day.title,
        sessionStatus: day.sessionStatus,
        modifiable: day.modifiable,
        isWorkout: day.isWorkout,
        exercises: day.exercises,
      })),
    },
    future: context.future,
    constraints: context.constraints,
  };
}

function toRecord(entries: { key: string; value: string }[] | null): Record<string, unknown> | undefined {
  if (!entries || entries.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const entry of entries) out[entry.key] = entry.value;
  return out;
}
