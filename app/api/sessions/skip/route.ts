import { NextResponse } from "next/server";
import { skipPlannedSession } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

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

  try {
    const session = await skipPlannedSession(user.id, planDayId, body.reason ?? null);
    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not skip workout.", 400);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}