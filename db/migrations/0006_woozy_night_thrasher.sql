CREATE TABLE "exercise_external_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"external_exercise_id" integer NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"match_confidence" real,
	"match_method" text,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"source_url" text,
	"primary_muscles" jsonb,
	"secondary_muscles" jsonb,
	"equipment" jsonb,
	"difficulty" text,
	"exercise_type" text,
	"instructions_source" text,
	"raw_metadata" jsonb,
	"content_hash" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "exercise_media" ADD COLUMN "provider_external_id" text;--> statement-breakpoint
ALTER TABLE "exercise_media" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_external_mappings" ADD CONSTRAINT "exercise_external_mappings_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_external_mappings" ADD CONSTRAINT "exercise_external_mappings_external_exercise_id_external_exercises_id_fk" FOREIGN KEY ("external_exercise_id") REFERENCES "public"."external_exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_external_mappings_exercise_idx" ON "exercise_external_mappings" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_external_mappings_external_idx" ON "exercise_external_mappings" USING btree ("external_exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_exercises_provider_external_idx" ON "external_exercises" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "external_exercises_name_idx" ON "external_exercises" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_external_mappings_one_approved_idx" ON "exercise_external_mappings" USING btree ("exercise_id", "provider") WHERE "status" = 'approved';