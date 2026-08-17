CREATE TABLE "exercise_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"media_type" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"title" text,
	"source_name" text,
	"source_url" text,
	"youtube_video_id" text,
	"attribution" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workout_session_id" integer,
	"log_date" date NOT NULL,
	"sleep_rating" integer NOT NULL,
	"energy_rating" integer NOT NULL,
	"soreness_rating" integer NOT NULL,
	"joint_pain_rating" integer NOT NULL,
	"stress_rating" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_logs" ADD CONSTRAINT "recovery_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_logs" ADD CONSTRAINT "recovery_logs_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_media_exercise_id_idx" ON "exercise_media" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "recovery_logs_user_id_idx" ON "recovery_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_logs_session_id_idx" ON "recovery_logs" USING btree ("workout_session_id");