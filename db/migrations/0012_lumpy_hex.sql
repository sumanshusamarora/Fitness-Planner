CREATE TABLE "session_plan_snapshot_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"target_sets" integer NOT NULL,
	"min_reps" integer NOT NULL,
	"max_reps" integer NOT NULL,
	"target_rpe" integer NOT NULL,
	"suggested_weight_kg" real,
	"rest_seconds" integer NOT NULL,
	"measurement_type" text
);
--> statement-breakpoint
CREATE TABLE "session_plan_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_session_id" integer NOT NULL,
	"workout_plan_day_id" integer NOT NULL,
	"day_number" integer NOT NULL,
	"day_name" text NOT NULL,
	"title" text NOT NULL,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_plan_snapshot_exercises" ADD CONSTRAINT "session_plan_snapshot_exercises_snapshot_id_session_plan_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."session_plan_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_plan_snapshot_exercises" ADD CONSTRAINT "session_plan_snapshot_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_plan_snapshots" ADD CONSTRAINT "session_plan_snapshots_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_plan_snapshots" ADD CONSTRAINT "session_plan_snapshots_workout_plan_day_id_workout_plan_days_id_fk" FOREIGN KEY ("workout_plan_day_id") REFERENCES "public"."workout_plan_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_plan_snapshot_exercises_snapshot_idx" ON "session_plan_snapshot_exercises" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_plan_snapshots_session_idx" ON "session_plan_snapshots" USING btree ("workout_session_id");--> statement-breakpoint
CREATE INDEX "session_plan_snapshots_day_idx" ON "session_plan_snapshots" USING btree ("workout_plan_day_id");