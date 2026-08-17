import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  exerciseMedia,
  exercises,
  recoveryLogs,
  users,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";

export async function GET() {
  const data = {
    exportedAt: new Date().toISOString(),
    users: await db.select().from(users),
    exercises: await db.select().from(exercises),
    exerciseMedia: await db.select().from(exerciseMedia),
    workoutPlans: await db.select().from(workoutPlans),
    workoutPlanDays: await db.select().from(workoutPlanDays),
    workoutPlanExercises: await db.select().from(workoutPlanExercises),
    workoutSessions: await db.select().from(workoutSessions),
    workoutSessionExercises: await db.select().from(workoutSessionExercises),
    workoutSets: await db.select().from(workoutSets),
    recoveryLogs: await db.select().from(recoveryLogs),
  };

  const filename = `fitness-backup-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
