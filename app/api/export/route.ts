import { eq, inArray } from "drizzle-orm";
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
import { currentUserOrNull } from "@/lib/session";

export async function GET() {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const [me, plans, sessions, recovery] = await Promise.all([
    db.select().from(users).where(eq(users.id, user.id)),
    db.select().from(workoutPlans).where(eq(workoutPlans.userId, user.id)),
    db.select().from(workoutSessions).where(eq(workoutSessions.userId, user.id)),
    db.select().from(recoveryLogs).where(eq(recoveryLogs.userId, user.id)),
  ]);

  const planIds = plans.map((p) => p.id);
  const sessionIds = sessions.map((s) => s.id);

  const days = planIds.length
    ? await db
        .select()
        .from(workoutPlanDays)
        .where(inArray(workoutPlanDays.workoutPlanId, planIds))
    : [];
  const dayIds = days.map((d) => d.id);

  const planExercises = dayIds.length
    ? await db
        .select()
        .from(workoutPlanExercises)
        .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds))
    : [];

  const sessionExercises = sessionIds.length
    ? await db
        .select()
        .from(workoutSessionExercises)
        .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds))
    : [];
  const sessionExerciseIds = sessionExercises.map((se) => se.id);

  const sets = sessionExerciseIds.length
    ? await db
        .select()
        .from(workoutSets)
        .where(inArray(workoutSets.workoutSessionExerciseId, sessionExerciseIds))
    : [];

  const data = {
    exportedAt: new Date().toISOString(),
    users: me,
    exercises: await db.select().from(exercises),
    exerciseMedia: await db.select().from(exerciseMedia),
    workoutPlans: plans,
    workoutPlanDays: days,
    workoutPlanExercises: planExercises,
    workoutSessions: sessions,
    workoutSessionExercises: sessionExercises,
    workoutSets: sets,
    recoveryLogs: recovery,
  };

  const filename = `fitness-backup-${user.id}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
