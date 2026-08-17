CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"primary_muscle" text NOT NULL,
	"equipment" text NOT NULL,
	"instructions" text,
	"video_url" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"height_cm" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_plan_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_plan_id" integer NOT NULL,
	"day_number" integer NOT NULL,
	"day_name" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_plan_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_plan_day_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"position" integer NOT NULL,
	"target_sets" integer NOT NULL,
	"min_reps" integer NOT NULL,
	"max_reps" integer NOT NULL,
	"target_rpe" integer NOT NULL,
	"suggested_weight_kg" real,
	"rest_seconds" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "workout_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"week_number" integer NOT NULL,
	"starts_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_session_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_session_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"position" integer NOT NULL,
	"suggested_weight_kg" real,
	"completed" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workout_plan_day_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"overall_rpe" integer,
	"energy_rating" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_session_exercise_id" integer NOT NULL,
	"set_number" integer NOT NULL,
	"weight_kg" real NOT NULL,
	"reps" integer NOT NULL,
	"rpe" integer,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_plan_days" ADD CONSTRAINT "workout_plan_days_workout_plan_id_workout_plans_id_fk" FOREIGN KEY ("workout_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_workout_plan_day_id_workout_plan_days_id_fk" FOREIGN KEY ("workout_plan_day_id") REFERENCES "public"."workout_plan_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_plan_day_id_workout_plan_days_id_fk" FOREIGN KEY ("workout_plan_day_id") REFERENCES "public"."workout_plan_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_session_exercise_id_workout_session_exercises_id_fk" FOREIGN KEY ("workout_session_exercise_id") REFERENCES "public"."workout_session_exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_name_idx" ON "exercises" USING btree ("name");--> statement-breakpoint
CREATE INDEX "workout_plan_days_plan_id_idx" ON "workout_plan_days" USING btree ("workout_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_plan_days_plan_day_idx" ON "workout_plan_days" USING btree ("workout_plan_id","day_number");--> statement-breakpoint
CREATE INDEX "workout_plan_exercises_day_id_idx" ON "workout_plan_exercises" USING btree ("workout_plan_day_id");--> statement-breakpoint
CREATE INDEX "workout_plans_user_id_idx" ON "workout_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workout_session_exercises_session_id_idx" ON "workout_session_exercises" USING btree ("workout_session_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_user_id_idx" ON "workout_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_plan_day_id_idx" ON "workout_sessions" USING btree ("workout_plan_day_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_started_at_idx" ON "workout_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "workout_sets_session_exercise_id_idx" ON "workout_sets" USING btree ("workout_session_exercise_id");