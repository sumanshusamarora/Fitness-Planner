import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessionExercises, workoutSets } from "@/db/schema";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionId = Number(id);

  const body = (await req.json()) as {
    exerciseId?: number;
    weightKg?: number;
    reps?: number;
    rpe?: number | null;
  };

  const exerciseId = Number(body.exerciseId);
  const weightKg = Number(body.weightKg);
  const reps = Number(body.reps);
  const rpe = body.rpe == null ? null : Number(body.rpe);

  if (
    !Number.isFinite(weightKg) ||
    !Number.isFinite(reps) ||
    weightKg < 0 ||
    reps < 0
  ) {
    return NextResponse.json(
      { error: "Invalid weight or reps" },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: "Exercise not found in session" },
      { status: 404 },
    );
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
    })
    .returning();

  return NextResponse.json({ setId: set.id });
}
