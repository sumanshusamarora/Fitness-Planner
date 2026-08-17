import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessionExercises, workoutSessions, workoutSets } from "@/db/schema";
import { currentUserOrNull } from "@/lib/session";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const sessionId = Number(id);

  const session = (
    await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, user.id)))
      .limit(1)
  )[0];
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    exerciseId?: number;
    weightKg?: number;
    reps?: number;
    rpe?: number | null;
    setType?: string;
  };

  const exerciseId = Number(body.exerciseId);
  const weightKg = Number(body.weightKg);
  const reps = Number(body.reps);
  const rpe = body.rpe == null ? null : Number(body.rpe);
  const setType = body.setType === "warmup" ? "warmup" : "working";

  if (
    !Number.isFinite(weightKg) ||
    !Number.isFinite(reps) ||
    weightKg < 0 ||
    reps < 0
  ) {
    return NextResponse.json({ error: "Invalid weight or reps" }, { status: 400 });
  }

  // Bodyweight / timed-hold movements legitimately log weight 0. A set needs
  // either a weight OR a rep/time value; never both missing.
  if (reps <= 0 && weightKg <= 0) {
    return NextResponse.json({ error: "Enter a weight or reps." }, { status: 400 });
  }

  const sse = (
    await db
      .select()
      .from(workoutSessionExercises)
      .where(
        and(
          eq(workoutSessionExercises.workoutSessionId, sessionId),
          eq(workoutSessionExercises.exerciseId, exerciseId),
        ),
      )
      .limit(1)
  )[0];

  if (!sse) {
    return NextResponse.json({ error: "Exercise not found in session" }, { status: 404 });
  }

  const existing = await db
    .select({ c: count() })
    .from(workoutSets)
    .where(eq(workoutSets.workoutSessionExerciseId, sse.id));

  const setNumber = (existing[0]?.c ?? 0) + 1;

  const [set] = await db
    .insert(workoutSets)
    .values({
      workoutSessionExerciseId: sse.id,
      setNumber,
      weightKg,
      reps,
      rpe,
      setType,
    })
    .returning();

  return NextResponse.json({ setId: set.id });
}
