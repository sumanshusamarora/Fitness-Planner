CREATE TABLE "plan_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workout_plan_id" integer NOT NULL,
	"kind" text NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"state_hash_before" text NOT NULL,
	"state_hash_after" text NOT NULL,
	"reverses_revision_id" integer,
	"restored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_workout_plan_id_workout_plans_id_fk" FOREIGN KEY ("workout_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_reverses_revision_id_plan_revisions_id_fk" FOREIGN KEY ("reverses_revision_id") REFERENCES "public"."plan_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_revisions_user_id_idx" ON "plan_revisions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plan_revisions_plan_id_idx" ON "plan_revisions" USING btree ("workout_plan_id");