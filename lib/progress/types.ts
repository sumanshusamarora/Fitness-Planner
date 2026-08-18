/**
 * Progress analytics domain types.
 *
 * This layer is deliberately deterministic and independent: it turns raw
 * workout/recovery rows into explainable longitudinal facts (performance,
 * tolerance, adaptation, plateau) that the coach interprets. It never makes a
 * call to the model and never mutates data.
 */

export type TrendDirection = "increasing" | "stable" | "decreasing" | "insufficient_data";

/** How a single exercise is moving across its recent attempted exposures. */
export type AdaptationDirection =
  | "improving_fast"
  | "improving"
  | "improving_slowly"
  | "flat"
  | "declining"
  | "insufficient_data";

/** Whether the user's own rate of improvement is changing over time. */
export type AdaptationTrend = "accelerating" | "stable" | "slowing" | "flat" | "unknown";

export type TrainingStage =
  | "returning"
  | "novice"
  | "developing"
  | "intermediate"
  | "advanced"
  | "unknown";

export type ToleranceTrend = "improving" | "stable" | "worsening" | "unknown";

export type PlateauStatus = "none" | "possible" | "likely" | "insufficient_data";

export type PlateauConfidence = "low" | "medium" | "high";

export type AdaptationInterpretation =
  | "accelerating"
  | "normal_so_far"
  | "normal_flattening"
  | "concerning"
  | "insufficient_data"
  | "mixed";

/** Why an exercise exposure did not count as an attempted performance. */
export type ExposureOutcome = "attempted" | "skipped" | "not_attempted";

export interface ExposureSet {
  weightKg: number;
  reps: number;
  rpe: number | null;
}

/**
 * One session's encounter with one exercise. Only `attempted` exposures (those
 * with logged sets) influence capability. Skipped / not-attempted exposures are
 * retained as auditable context but produce no performance signal.
 */
export interface ExerciseExposure {
  sessionId: number;
  completedAt: string;
  outcome: ExposureOutcome;
  skipReason: string | null;
  sets: ExposureSet[];
}

export interface ExerciseMeta {
  exerciseId: number;
  name: string;
  equipment: string;
  category: string;
  primaryMuscle: string;
  measurementType: string | null;
}

export interface SessionRecord {
  sessionId: number;
  status: "completed" | "ended_early" | "skipped";
  startedAt: string;
  completedAt: string | null;
  endReason: string | null;
  overallRpe: number | null;
  energyRating: string | null;
}

export interface RecoveryRecord {
  logDate: string;
  sleep: number;
  energy: number;
  soreness: number;
  jointPain: number;
  stress: number;
}

export interface ProfileRecord {
  experienceLevel: string | null;
  yearsSinceTraining: number | null;
  desiredDaysPerWeek: number | null;
}

/**
 * Pure input to the analytics assembler. Produced by the DB-backed builder and
 * by tests/fixtures. Everything here is already user-scoped by the caller.
 */
export interface ProgressAnalyticsInput {
  userId: number;
  anchorDateISO: string;
  profile: ProfileRecord;
  exercises: ExerciseMeta[];
  exposures: { exerciseId: number; exposures: ExerciseExposure[] }[];
  sessions: SessionRecord[];
  recovery: RecoveryRecord[];
  plannedSessions: number | null;
  adherenceSummary?: {
    prescribedSessions: number;
    completedPrescribedSessions: number;
    endedEarlyPrescribedSessions: number;
    skippedPrescribedSessions: number;
    inProgressPrescribedSessions: number;
    futurePrescribedSessions: number;
    pastDuePrescribedSessions: number;
    knownOpportunityPrescribedSessions: number;
    adherenceRate: number | null;
    adherencePercent: number | null;
  };
  extraSessions?: number;
}

export interface ExerciseProgress {
  exerciseId: number;
  name: string;
  equipment: string;
  category: string;
  primaryMuscle: string;
  /** Number of *attempted* exposures analysed (the recent window). */
  exposureCount: number;
  attemptedExposures: number;
  skippedExposures: number;
  notAttemptedExposures: number;
  /** Whether an estimated 1RM is meaningful for this movement. */
  supportsCapacityEstimate: boolean;
  loadTrend: TrendDirection;
  repTrend: TrendDirection;
  rpeTrend: TrendDirection;
  capacityTrend: TrendDirection | "unsupported";
  direction: AdaptationDirection;
  /** Median weekly percentage change in capability, when meaningful. */
  weeklyRatePct: number | null;
  /** Rate over the earlier half of the window (for natural-flattening checks). */
  earlyWeeklyRatePct: number | null;
  /** Rate over the later half of the window (for natural-flattening checks). */
  lateWeeklyRatePct: number | null;
  /** First vs latest exposure percentage change in capability. */
  firstVsLatestChangePct: number | null;
  recentLoadKg: number | null;
  recentRepsPerSet: number | null;
  recentRpe: number | null;
  /** True when the latest exposure is an isolated dip after an improving run. */
  isolatedDip: boolean;
  evidence: string[];
}

export interface PerformanceSummary {
  overallDirection: AdaptationDirection;
  improvingExercises: number;
  improvingFastExercises: number;
  flatExercises: number;
  decliningExercises: number;
  insufficientDataExercises: number;
  analyzedExercises: number;
  summary: string;
}

export interface TrainingTolerance {
  trend: ToleranceTrend;
  /** Completed prescribed sessions / prescribed known opportunities. */
  adherenceRate: number | null;
  /** Completed prescribed sessions in the analysed window. */
  completedSessions: number;
  plannedSessions: number | null;
  endedEarlySessions: number;
  skippedSessions: number;
  inProgressSessions: number;
  futurePrescribedSessions: number;
  pastDuePrescribedSessions: number;
  knownOpportunitySessions: number;
  extraSessions: number;
  completedSets: number;
  completedSetsTrend: TrendDirection;
  averageRpeTrend: TrendDirection;
  recoveryTrend: TrendDirection;
  fatigueRelatedEndedEarly: number;
  scheduleRelatedEndedEarly: number;
  painFlags: boolean;
  meaningfulJointPain: boolean;
  evidence: string[];
}

export interface AdaptationSummary {
  direction: AdaptationDirection;
  trend: AdaptationTrend;
  ratePctPerWeek: number | null;
  confidence: "high" | "medium" | "low";
  interpretation: AdaptationInterpretation;
  evidence: string[];
}

export interface PlateauConfounder {
  type: "poor_recovery" | "scheduling" | "pain" | "insufficient_exposures" | "single_anomalous_session";
  detail: string;
}

export interface PlateauAssessment {
  status: PlateauStatus;
  confidence: PlateauConfidence;
  evidence: string[];
  confounders: PlateauConfounder[];
}

export interface CompactExposure {
  exerciseId: number;
  exerciseName: string;
  completedAt: string;
  sets: ExposureSet[];
}

export interface ProgressAnalytics {
  userId: number;
  generatedAt: string;
  anchorDateISO: string;
  trainingStage: TrainingStage;
  performance: PerformanceSummary;
  exercises: ExerciseProgress[];
  tolerance: TrainingTolerance;
  adaptation: AdaptationSummary;
  plateau: PlateauAssessment;
  /** A few recent attempted exposures kept for coach verification only. */
  recentExposures: CompactExposure[];
}
