CREATE TABLE "plan_adjustment_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workout_plan_id" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "date_of_birth" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_normalized" text;--> statement-breakpoint
UPDATE "users" SET "username" = "name" WHERE "username" IS NULL;--> statement-breakpoint
UPDATE "users" SET "username_normalized" = lower(trim("name")) WHERE "username_normalized" IS NULL;--> statement-breakpoint
ALTER TABLE "workout_plan_days" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD CONSTRAINT "plan_adjustment_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD CONSTRAINT "plan_adjustment_proposals_workout_plan_id_workout_plans_id_fk" FOREIGN KEY ("workout_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_adjustment_proposals_user_id_idx" ON "plan_adjustment_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plan_adjustment_proposals_plan_id_idx" ON "plan_adjustment_proposals" USING btree ("workout_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_normalized_idx" ON "users" USING btree ("username_normalized");