import { NextResponse } from "next/server";
import { restoreSessionExercise } from "@/lib/session-activities";
import { currentUserOrNull } from "@/lib/session";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id, exerciseId } = await params;
  try {
    await restoreSessionExercise(user.id, Number(id), Number(exerciseId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not restore exercise." },
      { status: 400 },
    );
  }
}
