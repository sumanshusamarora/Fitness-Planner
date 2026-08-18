import type { ProgressAnalytics } from "@/lib/progress";
import type { RecoverySnapshot } from "@/lib/progression";
import type { RecentActualSummary } from "@/lib/session-activities";
import type { WeeklyActualSummary } from "@/lib/training-summary";
import type { CoachRunMetadata } from "@/lib/coach/ai/types";

/**
 * Week feedback + remaining-week rebuild domain.
 *
 * Rebuilding a week is normal adaptive coaching, not failure. Completed
 * training is immutable history; only legal current/future plan records may be
 * changed, and only after explicit user approval.
 */

export type WeekFeedbackReason =
  | "too_difficult"
  | "too_easy"
  | "too_many_days"
  | "too_few_days"
  | "sessions_too_long"
  | "schedule_changed"
  | "poor_recovery"
  | "pain"
  | "exercise_preference"
  | "equipment_problem"
  | "other";

export interface WeekFeedbackInput {
  primaryReason: WeekFeedbackReason;
  secondaryReasons: WeekFeedbackReason[];
  structuredDetails: Record<string, unknown> | null;
  freeText: string | null;
}

export type AddedDayEffortPreference = "coach_decide" | "light" | "normal";
export type RebuildSessionEffort = "light" | "normal";

export type RebuildDayStatus = "workout" | "rest";
export type RebuildOverallAction =
  | "keep_plan"
  | "modify_remaining_week"
  | "replace_unstarted_week"
  | "needs_input";

export interface RebuildProposedExercise {
  exerciseId: number;
  exerciseName: string;
  sets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
}

export interface RebuildProposedDay {
  dayNumber: number;
  dateISO: string;
  status: RebuildDayStatus;
  existingDayId: number | null;
  sessionEffort: RebuildSessionEffort | null;
  title: string | null;
  rationale: string[];
  exercises: RebuildProposedExercise[];
}

export interface RebuildPreservedDay {
  dayId: number;
  dayNumber: number;
  dateISO: string;
  reason: "completed" | "in_progress";
}

export type RebuildChangeType =
  | "remove_session"
  | "add_session"
  | "shorten_session"
  | "reduce_volume"
  | "increase_volume"
  | "adjust_load"
  | "adjust_rpe"
  | "move_day"
  | "change_exercise"
  | "keep";

export interface RebuildChange {
  type: RebuildChangeType;
  date: string;
  exerciseId?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason: string;
}

export interface RebuildQuestion {
  id: string;
  question: string;
  reason?: string;
  options: string[];
  required?: boolean;
}

export interface WeekRebuildProposal {
  proposalType: "week_rebuild";
  workoutPlanId: number;
  effectiveFromDate: string;
  feedback: { primaryReason: WeekFeedbackReason };
  overallAction: RebuildOverallAction;
  confidence: "high" | "medium" | "needs_input";
  summary: string;
  rationale: string[];
  preservedDays: RebuildPreservedDay[];
  proposedDays: RebuildProposedDay[];
  changes: RebuildChange[];
  questions: RebuildQuestion[];
  safetyFlags: string[];
  methodologyVersion: string;
  aiMetadata?: CoachRunMetadata;
}

// ---------------------------------------------------------------------------
// Context building blocks
// ---------------------------------------------------------------------------

export interface RebuildDayExercise {
  exerciseId: number;
  name: string;
  primaryMuscle: string;
  equipment: string;
  sets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
}

export type RebuildSessionState = "none" | "in_progress" | "completed" | "ended_early" | "skipped";

export interface RebuildDayContext {
  dayId: number;
  dayNumber: number;
  dayName: string;
  dateISO: string;
  title: string;
  origin: "moved" | "extra" | null;
  exercises: RebuildDayExercise[];
  sessionStatus: RebuildSessionState;
  sessionId: number | null;
  endReason: string | null;
  /** Only legal current/future days with no recorded outcome are modifiable. */
  modifiable: boolean;
  /** Day already carries a workout (exercises > 0). */
  isWorkout: boolean;
}

export interface RebuildConstraints {
  immutableDayIds: number[];
  inProgressDayIds: number[];
  modifiableDayIds: number[];
  modifiableWorkoutDayIds: number[];
  modifiableRestDayIds: number[];
  /** Day numbers (1-7) the user can still train on, per feedback/schedule. */
  remainingAvailableDayNumbers: number[];
  futureWeekExists: boolean;
  maxExercisesPerDay: number;
  minSets: number;
  maxSets: number;
  maxRpe: number;
  /** Exercises the coach may legally place (current week + catalogue). */
  allowedExerciseIds: number[];
  recentMuscles: string[];
}

export interface RebuildRecoverySummary {
  latest: RecoverySnapshot | null;
  poorRecovery: boolean;
  meaningfulJointPain: boolean;
  trend: "improving" | "stable" | "worsening" | "unknown";
}

export interface WeekRebuildContext {
  user: { id: number };
  profile: {
    primaryGoal: string | null;
    experienceLevel: string | null;
    yearsSinceTraining: number | null;
    desiredDaysPerWeek: number | null;
    sessionMinutes: string | null;
    trainingEnvironment: string | null;
    limitationsNotes: string | null;
  };
  currentWeek: {
    planId: number;
    weekNumber: number;
    startsOn: string;
    plannedSessions: number;
    prescribedSessions: number;
    extraSessions: number;
    completedSessions: number;
    days: RebuildDayContext[];
  };
  feedback: WeekFeedbackInput;
  recovery: RebuildRecoverySummary;
  progress: ProgressAnalytics;
  /** Canonical prescribed-vs-actual facts for the current week window. */
  training?: WeeklyActualSummary;
  /** Compact recent "what actually happened" facts (added sets, cardio, replacements). */
  actual: RecentActualSummary;
  future: {
    nextWeekKnown: boolean;
    remainingDays: { dayNumber: number; dateISO: string; dayName: string }[];
  };
  constraints: RebuildConstraints;
}
