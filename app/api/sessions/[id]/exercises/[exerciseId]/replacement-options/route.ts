import { NextResponse } from "next/server";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";
import { getReplacementOptions, type SubstitutionReason } from "@/lib/exercise-substitution";

const ALLOWED_REASONS: readonly SubstitutionReason[] = [
  "equipment_busy",
  "equipment_unavailable",
  "pain_discomfort",
  "preference",
  "coach_adjustment",
  "other",
] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });

  const { id, exerciseId } = await params;
  const url = new URL(req.url);
  const reason = url.searchParams.get("reason") as SubstitutionReason | null;

  if (!reason || !ALLOWED_REASONS.includes(reason)) {
    return NextResponse.json({ error: "Invalid replacement reason." }, { status: 400 });
  }

  try {
    const options = await getReplacementOptions({
      userId: user.id,
      sessionId: Number(id),
      exerciseId: Number(exerciseId),
      reason,
    });
    return NextResponse.json(options);
  } catch (error) {
    const mapped = toErrorBody(error, "Could not build replacement options.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
