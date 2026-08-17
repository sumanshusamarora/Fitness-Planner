CREATE TABLE "weekly_plan_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source_plan_id" integer NOT NULL,
	"proposed_week_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proposal" jsonb NOT NULL,
	"applied_decisions" jsonb,
	"applied_plan_id" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "weekly_plan_proposals" ADD CONSTRAINT "weekly_plan_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_plan_proposals" ADD CONSTRAINT "weekly_plan_proposals_source_plan_id_workout_plans_id_fk" FOREIGN KEY ("source_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_plan_proposals" ADD CONSTRAINT "weekly_plan_proposals_applied_plan_id_workout_plans_id_fk" FOREIGN KEY ("applied_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_plan_proposals_user_id_idx" ON "weekly_plan_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_plan_proposals_source_week_idx" ON "weekly_plan_proposals" USING btree ("source_plan_id","proposed_week_number");