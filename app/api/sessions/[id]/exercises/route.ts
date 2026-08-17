import { NextResponse } from "next/server";
import { addUnplannedExercise } from "@/lib/session-activities";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { exerciseId?: number };
  const exerciseId = Number(body.exerciseId);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
    return NextResponse.json({ error: "Pick an exercise." }, { status: 400 });
  }
  try {
    const row = await addUnplannedExercise(user.id, Number(id), exerciseId);
    return NextResponse.json({ sessionExercise: row });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not add exercise.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
