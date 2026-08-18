CREATE TABLE "equipment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_equipment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"equipment_type_id" integer NOT NULL,
	"requirement" text DEFAULT 'supported' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"muscle_id" integer NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_exercise_id" integer NOT NULL,
	"to_exercise_id" integer NOT NULL,
	"relationship_type" text NOT NULL,
	"source" text DEFAULT 'curated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muscles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_equipment_availability_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"equipment_type_id" integer NOT NULL,
	"availability" text NOT NULL,
	"source" text NOT NULL,
	"exercise_id" integer,
	"workout_session_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_exercise_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"preference" text,
	"anchor_state" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_gym_equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"equipment_type_id" integer NOT NULL,
	"equipment_model" text,
	"nickname" text,
	"known_availability" text DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "modality" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "movement_pattern" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "mechanics" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "laterality" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "stability" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "skill_demand" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "progression_suitability" text;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD COLUMN "user_gym_equipment_id" integer;--> statement-breakpoint
ALTER TABLE "exercise_equipment_types" ADD CONSTRAINT "exercise_equipment_types_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_equipment_types" ADD CONSTRAINT "exercise_equipment_types_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_id_muscles_id_fk" FOREIGN KEY ("muscle_id") REFERENCES "public"."muscles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_relationships" ADD CONSTRAINT "exercise_relationships_from_exercise_id_exercises_id_fk" FOREIGN KEY ("from_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_relationships" ADD CONSTRAINT "exercise_relationships_to_exercise_id_exercises_id_fk" FOREIGN KEY ("to_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_profiles" ADD CONSTRAINT "user_exercise_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_profiles" ADD CONSTRAINT "user_exercise_profiles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_gym_equipment" ADD CONSTRAINT "user_gym_equipment_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_gym_equipment" ADD CONSTRAINT "user_gym_equipment_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_types_code_idx" ON "equipment_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "exercise_equipment_types_exercise_idx" ON "exercise_equipment_types" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_equipment_types_equipment_idx" ON "exercise_equipment_types" USING btree ("equipment_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_equipment_types_unique_idx" ON "exercise_equipment_types" USING btree ("exercise_id","equipment_type_id","requirement");--> statement-breakpoint
CREATE INDEX "exercise_muscles_exercise_idx" ON "exercise_muscles" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_muscles_muscle_idx" ON "exercise_muscles" USING btree ("muscle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_muscles_unique_idx" ON "exercise_muscles" USING btree ("exercise_id","muscle_id","role");--> statement-breakpoint
CREATE INDEX "exercise_relationships_from_idx" ON "exercise_relationships" USING btree ("from_exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_relationships_to_idx" ON "exercise_relationships" USING btree ("to_exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_relationships_unique_idx" ON "exercise_relationships" USING btree ("from_exercise_id","to_exercise_id","relationship_type");--> statement-breakpoint
CREATE UNIQUE INDEX "muscles_code_idx" ON "muscles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_equipment_availability_user_idx" ON "user_equipment_availability_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_equipment_availability_equipment_idx" ON "user_equipment_availability_signals" USING btree ("equipment_type_id");--> statement-breakpoint
CREATE INDEX "user_equipment_availability_created_idx" ON "user_equipment_availability_signals" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_exercise_profiles_user_exercise_idx" ON "user_exercise_profiles" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "user_exercise_profiles_user_idx" ON "user_exercise_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_gym_equipment_user_idx" ON "user_gym_equipment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_gym_equipment_equipment_idx" ON "user_gym_equipment" USING btree ("equipment_type_id");--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_user_gym_equipment_id_user_gym_equipment_id_fk" FOREIGN KEY ("user_gym_equipment_id") REFERENCES "public"."user_gym_equipment"("id") ON DELETE no action ON UPDATE no action;