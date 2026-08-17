CREATE TABLE "user_training_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"primary_goal" text,
	"secondary_goals" jsonb,
	"experience_level" text,
	"years_since_training" integer,
	"desired_days_per_week" integer,
	"preferred_days" jsonb,
	"session_minutes" text,
	"training_environment" text,
	"equipment_notes" text,
	"limitations_notes" text,
	"body_weight_kg" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weekly_plan_proposals" ALTER COLUMN "source_plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_plan_proposals" ADD COLUMN "proposal_type" text DEFAULT 'next_week' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "status" text DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "end_reason" text;--> statement-breakpoint
UPDATE "workout_sessions" SET "status" = 'completed' WHERE "completed_at" IS NOT NULL;--> statement-breakpoint
UPDATE "workout_session_exercises" SET "status" = 'completed' WHERE "completed" = true;--> statement-breakpoint
ALTER TABLE "user_training_profiles" ADD CONSTRAINT "user_training_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_training_profiles_user_id_idx" ON "user_training_profiles" USING btree ("user_id");