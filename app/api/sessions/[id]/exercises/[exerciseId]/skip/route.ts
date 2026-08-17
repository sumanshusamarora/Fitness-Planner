import { NextResponse } from "next/server";
import { skipSessionExercise } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

const VALID_REASONS = [
  "equipment_busy",
  "not_feeling_well",
  "pain",
  "short_on_time",
  "other",
  "no_reason",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id, exerciseId } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = VALID_REASONS.includes(body.reason ?? "") ? body.reason! : "other";

  try {
    await skipSessionExercise(user.id, Number(id), Number(exerciseId), reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not skip exercise.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}