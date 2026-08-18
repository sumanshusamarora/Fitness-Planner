ALTER TABLE "user_equipment_availability_signals" DROP CONSTRAINT "user_equipment_availability_signals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" DROP CONSTRAINT "user_equipment_availability_signals_exercise_id_exercises_id_fk";
--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" DROP CONSTRAINT "user_equipment_availability_signals_workout_session_id_workout_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "user_exercise_profiles" DROP CONSTRAINT "user_exercise_profiles_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_gym_equipment" DROP CONSTRAINT "user_gym_equipment_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workout_session_exercises" DROP CONSTRAINT "workout_session_exercises_user_gym_equipment_id_user_gym_equipment_id_fk";
--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_availability_signals" ADD CONSTRAINT "user_equipment_availability_signals_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_profiles" ADD CONSTRAINT "user_exercise_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_gym_equipment" ADD CONSTRAINT "user_gym_equipment_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_user_gym_equipment_id_user_gym_equipment_id_fk" FOREIGN KEY ("user_gym_equipment_id") REFERENCES "public"."user_gym_equipment"("id") ON DELETE set null ON UPDATE no action;