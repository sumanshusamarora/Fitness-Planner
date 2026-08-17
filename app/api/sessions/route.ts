import { NextResponse } from "next/server";
import { todayDayNumber } from "@/lib/dates";
import {
  createSession,
  getActivePlan,
  getPlanDay,
  getSingleUser,
} from "@/lib/workouts";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    planDayId?: number;
  };

  let planDayId = body.planDayId;

  if (!planDayId) {
    const plan = await getActivePlan();
    if (!plan) {
      return NextResponse.json({ error: "No active plan" }, { status: 400 });
    }
    const day = await getPlanDay(plan.id, todayDayNumber());
    if (!day) {
      return NextResponse.json(
        { error: "No workout scheduled today" },
        { status: 400 },
      );
    }
    planDayId = day.id;
  }

  const user = await getSingleUser();
  if (!user) {
    return NextResponse.json({ error: "No user found" }, { status: 400 });
  }

  const session = await createSession(user.id, planDayId);
  return NextResponse.json({ sessionId: session.id });
}
