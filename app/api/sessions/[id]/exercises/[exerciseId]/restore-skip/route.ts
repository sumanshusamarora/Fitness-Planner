import { NextResponse } from "next/server";
import { restoreSkippedExercise } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id, exerciseId } = await params;

  try {
    const row = await restoreSkippedExercise(user.id, Number(id), Number(exerciseId));
    return NextResponse.json({ sessionExercise: row });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not restore this exercise.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}