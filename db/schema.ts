import {
  AnyPgColumn,
  pgTable,
  serial,
  text,
  integer,
  boolean,
  real,
  jsonb,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    username: text("username"),
    usernameNormalized: text("username_normalized"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    heightCm: integer("height_cm"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_username_normalized_idx").on(table.usernameNormalized)],
);

/**
 * Per-user training preferences collected during onboarding. Everything here is
 * user-scoped and editable later under More → Training profile.
 */
export const userTrainingProfiles = pgTable(
  "user_training_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    primaryGoal: text("primary_goal"),
    secondaryGoals: jsonb("secondary_goals"),
    experienceLevel: text("experience_level"),
    yearsSinceTraining: integer("years_since_training"),
    desiredDaysPerWeek: integer("desired_days_per_week"),
    preferredDays: jsonb("preferred_days"),
    sessionMinutes: text("session_minutes"),
    trainingEnvironment: text("training_environment"),
    equipmentNotes: text("equipment_notes"),
    limitationsNotes: text("limitations_notes"),
    bodyWeightKg: real("body_weight_kg"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("user_training_profiles_user_id_idx").on(table.userId)],
);

export const exercises = pgTable(
  "exercises",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    primaryMuscle: text("primary_muscle").notNull(),
    equipment: text("equipment").notNull(),
    measurementType: text("measurement_type"),
    instructions: text("instructions"),
    videoUrl: text("video_url"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [uniqueIndex("exercises_name_idx").on(table.name)],
);

export const exerciseMedia = pgTable(
  "exercise_media",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id),
    mediaType: text("media_type").notNull(),
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    title: text("title"),
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    youtubeVideoId: text("youtube_video_id"),
    attribution: text("attribution"),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    provider: text("provider"),
    providerExternalId: text("provider_external_id"),
    providerMetadata: jsonb("provider_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("exercise_media_exercise_id_idx").on(table.exerciseId)],
);

/**
 * A local, provider-agnostic catalogue of externally sourced exercises. This is
 * reference/discovery data only — `exercises` remains the canonical workout
 * model. Rows are populated offline by the import command from a JSONL snapshot
 * produced by the scraper; the app never talks to the provider at runtime.
 */
export const externalExercises = pgTable(
  "external_exercises",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    slug: text("slug"),
    name: text("name").notNull(),
    sourceUrl: text("source_url"),
    primaryMuscles: jsonb("primary_muscles"),
    secondaryMuscles: jsonb("secondary_muscles"),
    equipment: jsonb("equipment"),
    difficulty: text("difficulty"),
    exerciseType: text("exercise_type"),
    instructionsSource: text("instructions_source"),
    rawMetadata: jsonb("raw_metadata"),
    contentHash: text("content_hash"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("external_exercises_provider_external_idx").on(
      table.provider,
      table.externalId,
    ),
    index("external_exercises_name_idx").on(table.name),
  ],
);

/**
 * Maps a canonical exercise to an external catalogue exercise. A mapping is
 * never authoritative until its status is `approved` (manual confirmation).
 */
export const exerciseExternalMappings = pgTable(
  "exercise_external_mappings",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id),
    externalExerciseId: integer("external_exercise_id")
      .notNull()
      .references(() => externalExercises.id),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("suggested"),
    matchConfidence: real("match_confidence"),
    matchMethod: text("match_method"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("exercise_external_mappings_exercise_idx").on(table.exerciseId),
    index("exercise_external_mappings_external_idx").on(table.externalExerciseId),
  ],
);

export const workoutPlans = pgTable(
  "workout_plans",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    weekNumber: integer("week_number").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("workout_plans_user_id_idx").on(table.userId)],
);

export const workoutPlanDays = pgTable(
  "workout_plan_days",
  {
    id: serial("id").primaryKey(),
    workoutPlanId: integer("workout_plan_id")
      .notNull()
      .references(() => workoutPlans.id),
    dayNumber: integer("day_number").notNull(),
    dayName: text("day_name").notNull(),
    title: text("title").notNull(),
    origin: text("origin"),
  },
  (table) => [
    index("workout_plan_days_plan_id_idx").on(table.workoutPlanId),
    uniqueIndex("workout_plan_days_plan_day_idx").on(
      table.workoutPlanId,
      table.dayNumber,
    ),
  ],
);

export const workoutPlanExercises = pgTable(
  "workout_plan_exercises",
  {
    id: serial("id").primaryKey(),
    workoutPlanDayId: integer("workout_plan_day_id")
      .notNull()
      .references(() => workoutPlanDays.id),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id),
    position: integer("position").notNull(),
    targetSets: integer("target_sets").notNull(),
    minReps: integer("min_reps").notNull(),
    maxReps: integer("max_reps").notNull(),
    targetRpe: integer("target_rpe").notNull(),
    suggestedWeightKg: real("suggested_weight_kg"),
    restSeconds: integer("rest_seconds").notNull(),
    notes: text("notes"),
  },
  (table) => [
    index("workout_plan_exercises_day_id_idx").on(table.workoutPlanDayId),
  ],
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    workoutPlanDayId: integer("workout_plan_day_id")
      .notNull()
      .references(() => workoutPlanDays.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").notNull().default("in_progress"),
    endReason: text("end_reason"),
    overallRpe: integer("overall_rpe"),
    energyRating: text("energy_rating"),
    notes: text("notes"),
  },
  (table) => [
    index("workout_sessions_user_id_idx").on(table.userId),
    index("workout_sessions_plan_day_id_idx").on(table.workoutPlanDayId),
    index("workout_sessions_started_at_idx").on(table.startedAt),
    // One active session per plan day. A day can never have two in-progress
    // sessions, so concurrent/double-tap Start is impossible at the DB level.
    uniqueIndex("workout_sessions_active_session_day_idx")
      .on(table.workoutPlanDayId)
      .where(sql`${table.status} = 'in_progress'`),
  ],
);

/**
 * The prescription a workout session saw when it started. Immutable: the live
 * plan (`workout_plan_exercises`) remains mutable future intent, while a
 * started session keeps the exact day/exercise prescription it began with, so
 * later plan changes can never retroactively rewrite what was prescribed.
 * Created once at session start; never updated. There is exactly one per
 * session, keyed by `workout_session_id`.
 */
export const sessionPlanSnapshots = pgTable(
  "session_plan_snapshots",
  {
    id: serial("id").primaryKey(),
    workoutSessionId: integer("workout_session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    workoutPlanDayId: integer("workout_plan_day_id")
      .notNull()
      .references(() => workoutPlanDays.id),
    dayNumber: integer("day_number").notNull(),
    dayName: text("day_name").notNull(),
    title: text("title").notNull(),
    origin: text("origin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("session_plan_snapshots_session_idx").on(table.workoutSessionId),
    index("session_plan_snapshots_day_idx").on(table.workoutPlanDayId),
  ],
);

/**
 * Per-exercise prescription rows frozen at session start. Repository of the
 * script-prescribed target sets/reps/RPE/rest and the weight recommendation
 * shown when the user pressed Start. `name` is a display snapshot so history
 * survives later catalogue edits.
 */
export const sessionPlanSnapshotExercises = pgTable(
  "session_plan_snapshot_exercises",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => sessionPlanSnapshots.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    targetSets: integer("target_sets").notNull(),
    minReps: integer("min_reps").notNull(),
    maxReps: integer("max_reps").notNull(),
    targetRpe: integer("target_rpe").notNull(),
    suggestedWeightKg: real("suggested_weight_kg"),
    restSeconds: integer("rest_seconds").notNull(),
    measurementType: text("measurement_type"),
  },
  (table) => [
    index("session_plan_snapshot_exercises_snapshot_idx").on(table.snapshotId),
  ],
);

/**
 * An actual resistance movement inside a workout session. `origin` records why
 * the movement exists (planned / added spontaneously / a replacement), while
 * `replaces_session_exercise_id` links a replacement back to the original
 * planned entry it substituted. The original planned entry is preserved with
 * status "replaced" — never deleted and never marked failed.
 */
export const workoutSessionExercises = pgTable(
  "workout_session_exercises",
  {
    id: serial("id").primaryKey(),
    workoutSessionId: integer("workout_session_id")
      .notNull()
      .references(() => workoutSessions.id),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id),
    position: integer("position").notNull(),
    suggestedWeightKg: real("suggested_weight_kg"),
    completed: boolean("completed").notNull().default(false),
    status: text("status").notNull().default("pending"),
    skipReason: text("skip_reason"),
    origin: text("origin").notNull().default("planned"),
    replacementReason: text("replacement_reason"),
    replacesSessionExerciseId: integer("replaces_session_exercise_id"),
    notes: text("notes"),
  },
  (table) => [
    index("workout_session_exercises_session_id_idx").on(table.workoutSessionId),
  ],
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: serial("id").primaryKey(),
    workoutSessionExerciseId: integer("workout_session_exercise_id")
      .notNull()
      .references(() => workoutSessionExercises.id),
    setNumber: integer("set_number").notNull(),
    weightKg: real("weight_kg").notNull(),
    reps: integer("reps").notNull(),
    rpe: integer("rpe"),
    setType: text("set_type").notNull().default("working"),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("workout_sets_session_exercise_id_idx").on(
      table.workoutSessionExerciseId,
    ),
  ],
);

/**
 * A non-set-based actual activity inside a workout session (cardio, mobility,
 * stretching, generic warm-up/cool-down). These are factual "what actually
 * happened" records, kept separate from the set-based resistance model so a
 * treadmill warm-up is never modelled as "3 × 10".
 */
export const workoutSessionActivities = pgTable(
  "workout_session_activities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    workoutSessionId: integer("workout_session_id")
      .notNull()
      .references(() => workoutSessions.id),
    activityType: text("activity_type").notNull(),
    activityRole: text("activity_role").notNull(),
    exerciseId: integer("exercise_id").references(() => exercises.id),
    nameSnapshot: text("name_snapshot"),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: real("distance_meters"),
    speed: real("speed"),
    inclinePercent: real("incline_percent"),
    effortRpe: integer("effort_rpe"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("workout_session_activities_session_id_idx").on(
      table.workoutSessionId,
    ),
    index("workout_session_activities_user_id_idx").on(table.userId),
  ],
);

export const recoveryLogs = pgTable(
  "recovery_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    workoutSessionId: integer("workout_session_id").references(
      () => workoutSessions.id,
    ),
    logDate: date("log_date", { mode: "string" }).notNull(),
    sleepRating: integer("sleep_rating").notNull(),
    energyRating: integer("energy_rating").notNull(),
    sorenessRating: integer("soreness_rating").notNull(),
    jointPainRating: integer("joint_pain_rating").notNull(),
    stressRating: integer("stress_rating").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("recovery_logs_user_id_idx").on(table.userId),
    index("recovery_logs_session_id_idx").on(table.workoutSessionId),
  ],
);

/**
 * A reviewable coaching recommendation. This is deliberately separate from
 * `workout_plans`: drafting a proposal must never activate a future week.
 */
export const weeklyPlanProposals = pgTable(
  "weekly_plan_proposals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    sourcePlanId: integer("source_plan_id").references(() => workoutPlans.id),
    proposalType: text("proposal_type").notNull().default("next_week"),
    proposedWeekNumber: integer("proposed_week_number").notNull(),
    status: text("status").notNull().default("draft"),
    proposal: jsonb("proposal").notNull(),
    appliedDecisions: jsonb("applied_decisions"),
    inputResponses: jsonb("input_responses"),
    appliedPlanId: integer("applied_plan_id").references(() => workoutPlans.id),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    index("weekly_plan_proposals_user_id_idx").on(table.userId),
    uniqueIndex("weekly_plan_proposals_source_week_idx").on(
      table.sourcePlanId,
      table.proposedWeekNumber,
    ),
  ],
);

/**
 * Structured week feedback a user submits when asking to adjust/rebuild their
 * current week. Stored as first-class data (not just prompt logs) so it becomes
 * longitudinal coaching context and audit history.
 */
export const weekFeedback = pgTable(
  "week_feedback",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    workoutPlanId: integer("workout_plan_id")
      .notNull()
      .references(() => workoutPlans.id),
    primaryReason: text("primary_reason").notNull(),
    secondaryReasons: jsonb("secondary_reasons"),
    structuredDetails: jsonb("structured_details"),
    freeText: text("free_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("week_feedback_user_id_idx").on(table.userId),
    index("week_feedback_plan_id_idx").on(table.workoutPlanId),
  ],
);

/**
 * A reviewable intra-week schedule change (move, swap, rest-day workout, or
 * full week rebuild). Like `weekly_plan_proposals`, drafting one must never
 * mutate the plan. `state_hash` guards against applying a stale proposal.
 */
export const planAdjustmentProposals = pgTable(
  "plan_adjustment_proposals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    workoutPlanId: integer("workout_plan_id")
      .notNull()
      .references(() => workoutPlans.id),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    proposal: jsonb("proposal").notNull(),
    feedbackId: integer("feedback_id").references(() => weekFeedback.id),
    stateHash: text("state_hash"),
    inputResponses: jsonb("input_responses"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    index("plan_adjustment_proposals_user_id_idx").on(table.userId),
    index("plan_adjustment_proposals_plan_id_idx").on(table.workoutPlanId),
  ],
);

/**
 * Durable provenance for future-plan mutations (move, swap, add extra, remove
 * extra). Each row stores the exact day-level state before and after the
 * operation so a still-unstarted change can be restored deterministically
 * without reconstructing it from the `origin` display marker. Only unstarted
 * `move`/`swap` revisions are restorable; removing an extra or recording a
 * rebuild change is an audit trail, not a restoration source.
 *
 * A later move can chain an earlier move via `reverses_revision_id`, so
 * "Restore Original Day" on a Wed → Thu → Sat chain puts the unchanged
 * workout back on its pre-move day in one atomic restore.
 */
export const planRevisions = pgTable(
  "plan_revisions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    workoutPlanId: integer("workout_plan_id")
      .notNull()
      .references(() => workoutPlans.id),
    kind: text("kind").notNull(),
    beforeSnapshot: jsonb("before_snapshot").notNull(),
    afterSnapshot: jsonb("after_snapshot").notNull(),
    stateHashBefore: text("state_hash_before").notNull(),
    stateHashAfter: text("state_hash_after").notNull(),
    reversesRevisionId: integer("reverses_revision_id").references(
      (): AnyPgColumn => planRevisions.id,
    ),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("plan_revisions_user_id_idx").on(table.userId),
    index("plan_revisions_plan_id_idx").on(table.workoutPlanId),
  ],
);
