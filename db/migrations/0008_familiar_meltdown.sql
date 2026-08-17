CREATE TABLE "workout_session_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workout_session_id" integer NOT NULL,
	"activity_type" text NOT NULL,
	"activity_role" text NOT NULL,
	"exercise_id" integer,
	"name_snapshot" text,
	"duration_seconds" integer,
	"distance_meters" real,
	"speed" real,
	"incline_percent" real,
	"effort_rpe" integer,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD COLUMN "origin" text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD COLUMN "replacement_reason" text;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD COLUMN "replaces_session_exercise_id" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "set_type" text DEFAULT 'working' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_session_activities" ADD CONSTRAINT "workout_session_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_activities" ADD CONSTRAINT "workout_session_activities_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_activities" ADD CONSTRAINT "workout_session_activities_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_session_activities_session_id_idx" ON "workout_session_activities" USING btree ("workout_session_id");--> statement-breakpoint
CREATE INDEX "workout_session_activities_user_id_idx" ON "workout_session_activities" USING btree ("user_id");