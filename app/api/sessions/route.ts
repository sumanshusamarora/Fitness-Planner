import { NextResponse } from "next/server";
import { startOrResumeSession } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";
import { getActivePlan, getPlanDay } from "@/lib/workouts";
import { todayDayNumber } from "@/lib/dates";

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

  try {
    // Resume-or-create: repeated taps and concurrent requests all resolve to
    // the single in-progress session for this plan day.
    const { session } = await startOrResumeSession(user.id, planDayId);
    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not start workout.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}