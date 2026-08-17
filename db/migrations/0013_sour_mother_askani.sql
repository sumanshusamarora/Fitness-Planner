ALTER TABLE "session_plan_snapshot_exercises" DROP CONSTRAINT "session_plan_snapshot_exercises_snapshot_id_session_plan_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "session_plan_snapshots" DROP CONSTRAINT "session_plan_snapshots_workout_session_id_workout_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "session_plan_snapshot_exercises" ADD CONSTRAINT "session_plan_snapshot_exercises_snapshot_id_session_plan_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."session_plan_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_plan_snapshots" ADD CONSTRAINT "session_plan_snapshots_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;