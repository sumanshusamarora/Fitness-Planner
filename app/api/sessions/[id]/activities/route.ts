import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessionActivities } from "@/db/schema";
import { addSessionActivity, type ActivityRole, type ActivityType } from "@/lib/session-activities";
import { currentUserOrNull } from "@/lib/session";

const ACTIVITY_TYPES = ["cardio", "mobility", "stretching", "other"];
const ACTIVITY_ROLES = ["warmup", "cardio", "mobility", "cooldown", "other"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id } = await params;
  const rows = await db
    .select()
    .from(workoutSessionActivities)
    .where(eq(workoutSessionActivities.workoutSessionId, Number(id)))
    .orderBy(workoutSessionActivities.sortOrder);
  return NextResponse.json({ activities: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    activityType?: string;
    activityRole?: string;
    exerciseId?: number | null;
    nameSnapshot?: string | null;
    durationSeconds?: number | null;
    distanceMeters?: number | null;
    speed?: number | null;
    inclinePercent?: number | null;
    effortRpe?: number | null;
    notes?: string | null;
  };

  const activityType = ACTIVITY_TYPES.includes(body.activityType ?? "") ? (body.activityType as ActivityType) : null;
  const activityRole = ACTIVITY_ROLES.includes(body.activityRole ?? "") ? (body.activityRole as ActivityRole) : null;
  if (!activityType || !activityRole) {
    return NextResponse.json({ error: "Pick an activity type." }, { status: 400 });
  }

  try {
    const row = await addSessionActivity(user.id, Number(id), {
      activityType,
      activityRole,
      exerciseId: body.exerciseId ?? null,
      nameSnapshot: body.nameSnapshot ?? null,
      durationSeconds: body.durationSeconds ?? null,
      distanceMeters: body.distanceMeters ?? null,
      speed: body.speed ?? null,
      inclinePercent: body.inclinePercent ?? null,
      effortRpe: body.effortRpe ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ activity: row });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add activity." },
      { status: 400 },
    );
  }
}
