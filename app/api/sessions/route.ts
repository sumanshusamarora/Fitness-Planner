import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutPlanDays, workoutPlans } from "@/db/schema";
import { todayDayNumber } from "@/lib/dates";
import { createSession, getActivePlan, getPlanDay } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";

export async function POST(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { planDayId?: number };
  let planDayId = body.planDayId;

  if (!planDayId) {
    const plan = await getActivePlan(user.id);
    if (!plan) {
      return NextResponse.json({ error: "No active plan" }, { status: 400 });
    }
    const day = await getPlanDay(plan.id, todayDayNumber());
    if (!day) {
      return NextResponse.json({ error: "No workout scheduled today" }, { status: 400 });
    }
    planDayId = day.id;
  }

  // Verify the requested plan day belongs to a plan owned by this user.
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

  const session = await createSession(user.id, planDayId);
  return NextResponse.json({ sessionId: session.id });
}
