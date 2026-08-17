import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutPlanDays, workoutPlans, workoutSessions } from "@/db/schema";
import { createSkippedSession } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";

export async function POST(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    planDayId?: number;
    reason?: string | null;
  };
  const planDayId = Number(body.planDayId);
  if (!Number.isInteger(planDayId)) {
    return NextResponse.json({ error: "A day is required." }, { status: 400 });
  }

  const owned = (
    await db
      .select({ id: workoutPlanDays.id })
      .from(workoutPlanDays)
      .innerJoin(workoutPlans, eq(workoutPlanDays.workoutPlanId, workoutPlans.id))
      .where(and(eq(workoutPlanDays.id, planDayId), eq(workoutPlans.userId, user.id)))
      .limit(1)
  )[0];
  if (!owned) {
    return NextResponse.json({ error: "Day not found." }, { status: 404 });
  }

  const inProgress = (
    await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.workoutPlanDayId, planDayId),
          eq(workoutSessions.userId, user.id),
          eq(workoutSessions.status, "in_progress"),
        ),
      )
      .limit(1)
  )[0];
  if (inProgress) {
    return NextResponse.json(
      { error: "This workout is in progress. Resume or end it first." },
      { status: 400 },
    );
  }

  const session = await createSkippedSession(user.id, planDayId, body.reason ?? null);
  return NextResponse.json({ sessionId: session.id });
}
