CREATE TABLE "week_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workout_plan_id" integer NOT NULL,
	"primary_reason" text NOT NULL,
	"secondary_reasons" jsonb,
	"structured_details" jsonb,
	"free_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD COLUMN "feedback_id" integer;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD COLUMN "state_hash" text;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD COLUMN "input_responses" jsonb;--> statement-breakpoint
ALTER TABLE "week_feedback" ADD CONSTRAINT "week_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_feedback" ADD CONSTRAINT "week_feedback_workout_plan_id_workout_plans_id_fk" FOREIGN KEY ("workout_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "week_feedback_user_id_idx" ON "week_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "week_feedback_plan_id_idx" ON "week_feedback" USING btree ("workout_plan_id");--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD CONSTRAINT "plan_adjustment_proposals_feedback_id_week_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."week_feedback"("id") ON DELETE no action ON UPDATE no action;