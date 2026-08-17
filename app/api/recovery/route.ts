import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recoveryLogs, workoutPlanDays, workoutPlans } from "@/db/schema";
import { todayDayNumber, toISODate } from "@/lib/dates";
import { createSession, getActivePlan, getPlanDay } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";

export async function POST(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    planDayId?: number;
    ratings?: {
      sleep?: number;
      energy?: number;
      soreness?: number;
      jointPain?: number;
      stress?: number;
    };
  };

  const ratings = body.ratings ?? {};
  const sleep = Number(ratings.sleep);
  const energy = Number(ratings.energy);
  const soreness = Number(ratings.soreness);
  const jointPain = Number(ratings.jointPain);
  const stress = Number(ratings.stress);

  const values = [sleep, energy, soreness, jointPain, stress];
  if (values.some((v) => !Number.isFinite(v) || v < 1 || v > 10)) {
    return NextResponse.json({ error: "All ratings must be between 1 and 10" }, { status: 400 });
  }

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

  const [log] = await db
    .insert(recoveryLogs)
    .values({
      userId: user.id,
      workoutSessionId: null,
      logDate: toISODate(new Date()),
      sleepRating: sleep,
      energyRating: energy,
      sorenessRating: soreness,
      jointPainRating: jointPain,
      stressRating: stress,
      notes: null,
    })
    .returning();

  const session = await createSession(user.id, planDayId);

  await db
    .update(recoveryLogs)
    .set({ workoutSessionId: session.id })
    .where(eq(recoveryLogs.id, log.id));

  return NextResponse.json({ sessionId: session.id });
}
