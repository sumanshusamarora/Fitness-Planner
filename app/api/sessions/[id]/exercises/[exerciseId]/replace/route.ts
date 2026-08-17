import { NextResponse } from "next/server";
import { replaceSessionExercise, REPLACEMENT_REASONS, type ReplacementReason } from "@/lib/session-activities";
import { currentUserOrNull } from "@/lib/session";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id, exerciseId } = await params;
  const body = (await req.json().catch(() => ({}))) as { replacementExerciseId?: number; reason?: string };
  const replacementExerciseId = Number(body.replacementExerciseId);
  if (!Number.isInteger(replacementExerciseId) || replacementExerciseId <= 0) {
    return NextResponse.json({ error: "Pick a replacement exercise." }, { status: 400 });
  }
  const reason = (REPLACEMENT_REASONS as readonly string[]).includes(body.reason ?? "") ? (body.reason as ReplacementReason) : "other";
  try {
    const row = await replaceSessionExercise(user.id, Number(id), Number(exerciseId), replacementExerciseId, reason);
    return NextResponse.json({ sessionExercise: row });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not replace exercise." },
      { status: 400 },
    );
  }
}
