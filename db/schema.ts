import {
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

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  heightCm: integer("height_cm"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const exercises = pgTable(
  "exercises",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    primaryMuscle: text("primary_muscle").notNull(),
    equipment: text("equipment").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("exercise_media_exercise_id_idx").on(table.exerciseId)],
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
    overallRpe: integer("overall_rpe"),
    energyRating: text("energy_rating"),
    notes: text("notes"),
  },
  (table) => [
    index("workout_sessions_user_id_idx").on(table.userId),
    index("workout_sessions_plan_day_id_idx").on(table.workoutPlanDayId),
    index("workout_sessions_started_at_idx").on(table.startedAt),
  ],
);

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
    sourcePlanId: integer("source_plan_id")
      .notNull()
      .references(() => workoutPlans.id),
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
