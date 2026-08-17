import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutPlanDays } from "@/db/schema";
import { eq } from "drizzle-orm";
import { proposeAddSession } from "@/lib/coach/addSession";
import type { Effort } from "@/lib/coach/restDay";
import { persistAdjustment, proposeMoveOrSwap } from "@/lib/schedule";
import { currentUserOrNull } from "@/lib/session";

export async function POST(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    planId?: number;
    sourceDayId?: number;
    targetDayId?: number;
    dayId?: number;
    effort?: Effort;
  };

  try {
    if (body.action === "move") {
      if (!body.sourceDayId || !body.targetDayId || !body.planId) {
        return NextResponse.json({ error: "Move requires a plan and two days." }, { status: 400 });
      }
      const stored = await proposeMoveOrSwap(user.id, body.planId, body.sourceDayId, body.targetDayId);
      return NextResponse.json(stored);
    }

    if (body.action === "add") {
      if (!body.planId || !body.dayId || !body.effort) {
        return NextResponse.json({ error: "Add requires a plan, day, and effort." }, { status: 400 });
      }
      const day = (
        await db
          .select()
          .from(workoutPlanDays)
          .where(eq(workoutPlanDays.id, body.dayId))
          .limit(1)
      )[0];
      if (!day || day.workoutPlanId !== body.planId) {
        return NextResponse.json({ error: "Day not found." }, { status: 400 });
      }
      const proposal = await proposeAddSession({
        userId: user.id,
        workoutPlanId: body.planId,
        dayNumber: day.dayNumber,
        dayId: body.dayId,
        requestedEffort: body.effort,
      });
      const stored = await persistAdjustment(user.id, body.planId, "add_rest_day_workout", proposal);
      return NextResponse.json(stored);
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not propose adjustment." },
      { status: 400 },
    );
  }
}
