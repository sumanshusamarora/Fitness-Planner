import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessionExercises } from "@/db/schema";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const { id, exerciseId } = await params;

  const [updated] = await db
    .update(workoutSessionExercises)
    .set({ completed: true })
    .where(
      and(
        eq(workoutSessionExercises.workoutSessionId, Number(id)),
        eq(workoutSessionExercises.exerciseId, Number(exerciseId)),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Exercise not found in session" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
