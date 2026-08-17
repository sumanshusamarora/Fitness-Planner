import type { RecoverySnapshot } from "@/lib/progression";
import type { CoachRunMetadata } from "./ai/types";

export type CoachConfidence = "high" | "medium" | "needs-input";
export type ProposalStatus =
  | "draft"
  | "awaiting_input"
  | "approved"
  | "rejected"
  | "applied";
export type ExerciseAction =
  | "increase_load"
  | "decrease_load"
  | "maintain"
  | "increase_reps"
  | "change_sets"
  | "substitute"
  | "needs_input";

export interface CompletedSet {
  weightKg: number;
  reps: number;
  rpe: number | null;
}

export interface ExerciseExposure {
  completedAt: string;
  weightKg: number | null;
  sets: CompletedSet[];
  belongsToSourceWeek: boolean;
  dayNumber: number | null;
}

export interface TrainingContextExercise {
  sourcePlanExerciseId: number;
  sourcePlanDayId: number;
  dayNumber: number;
  dayName: string;
  dayTitle: string;
  position: number;
  exerciseId: number;
  exerciseName: string;
  primaryMuscle: string;
  equipment: string;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
  recentExposures: ExerciseExposure[];
}

export interface RecoverySummary {
  entries: number;
  latest: RecoverySnapshot | null;
  average: RecoverySnapshot | null;
  poorRecovery: boolean;
  meaningfulJointPain: boolean;
  notes: string[];
}

export interface SessionOutcome {
  dayNumber: number;
  dayName: string;
  title: string;
  status: string;
  endReason: string | null;
}

export interface TrainingContext {
  user: { id: number; name: string; dateOfBirth: string | null; heightCm: number | null };
  sourcePlan: {
    id: number;
    weekNumber: number;
    startsOn: string;
    name: string;
    notes: string | null;
  };
  exercises: TrainingContextExercise[];
  plannedSessions: number;
  completedSessions: number;
  missedDays: { dayNumber: number; dayName: string; title: string }[];
  sessionOutcomes: SessionOutcome[];
  recovery: RecoverySummary;
}

export interface ExerciseAnalysis {
  sourcePlanExerciseId: number;
  latestExposure: ExerciseExposure | null;
  allSetsCompleted: boolean;
  reachedTopOfRange: boolean;
  reachedMinimumReps: boolean;
  latestRpe: number | null;
  averageRpe: number | null;
  trend: "improving" | "stable" | "declining" | "insufficient_data";
  deterministicWeightKg: number | null;
  deterministicReason: string;
}

export interface WeekAnalysis {
  completedSessions: number;
  plannedSessions: number;
  missedSessions: number;
  recoverySummary: string;
  hasMaterialSafetyFlag: boolean;
  exerciseAnalyses: Record<number, ExerciseAnalysis>;
}

export interface CoachQuestion {
  id: string;
  prompt: string;
  options: string[];
  exerciseId?: number;
}

export interface ExerciseChange {
  sourcePlanExerciseId: number;
  exerciseId: number;
  exerciseName: string;
  previous: {
    weightKg: number | null;
    sets: number;
    minReps: number;
    maxReps: number;
    targetRpe: number;
  };
  proposed: {
    weightKg: number | null;
    sets: number;
    minReps: number;
    maxReps: number;
    targetRpe: number;
  };
  action: ExerciseAction;
  confidence: CoachConfidence;
  reason: string;
  evidence: string[];
}

export interface ProposedWorkoutExercise extends ExerciseChange {
  position: number;
  restSeconds: number;
}

export interface ProposedWorkoutDay {
  sourcePlanDayId: number;
  dayNumber: number;
  dayName: string;
  title: string;
  exercises: ProposedWorkoutExercise[];
}

export interface WeeklyPlanProposal {
  proposalType: "initial_week" | "next_week";
  sourceWeekId: number | null;
  proposedWeekNumber: number;
  proposedStartsOn: string;
  summary: {
    completedSessions: number;
    plannedSessions: number;
    recoverySummary: string;
    overallRecommendation: string;
  };
  changes: ExerciseChange[];
  days: ProposedWorkoutDay[];
  questions: CoachQuestion[];
  confidence: CoachConfidence;
  methodologyVersion: string;
  /** Set when this proposal came from the runtime AI coach. */
  aiMetadata?: CoachRunMetadata;
}

export interface InitialTrainingContext {
  user: { id: number; name: string; dateOfBirth: string | null; heightCm: number | null };
  profile: {
    primaryGoal: string | null;
    secondaryGoals: string[];
    experienceLevel: string | null;
    yearsSinceTraining: number | null;
    desiredDaysPerWeek: number | null;
    preferredDays: number[];
    sessionMinutes: string | null;
    trainingEnvironment: string | null;
    equipmentNotes: string | null;
    limitationsNotes: string | null;
  };
  recovery: RecoverySummary;
}

export type ProposalDecision = "accept" | "keep";
