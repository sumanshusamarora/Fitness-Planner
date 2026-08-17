import { NextResponse } from "next/server";
import { toErrorBody } from "@/lib/errors";
import { currentUserOrNull } from "@/lib/session";
import { removeAddedSessionExercise } from "@/lib/session-activities";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const { id, exerciseId } = await params;
  try {
    await removeAddedSessionExercise(user.id, Number(id), Number(exerciseId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not remove this added exercise.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
