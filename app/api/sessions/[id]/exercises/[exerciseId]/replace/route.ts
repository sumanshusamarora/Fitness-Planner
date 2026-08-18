import { NextResponse } from "next/server";
import {
  replaceSessionExercise,
  REPLACEMENT_REASONS,
  type ReplacementReason,
  type ReplacementScope,
} from "@/lib/session-activities";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

const REPLACEMENT_SCOPES: readonly ReplacementScope[] = ["temporary", "anchor_change"] as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id, exerciseId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    replacementExerciseId?: number;
    reason?: string;
    replacementScope?: string;
    confirmAnchorChange?: boolean;
  };
  const replacementExerciseId = Number(body.replacementExerciseId);
  if (!Number.isInteger(replacementExerciseId) || replacementExerciseId <= 0) {
    return NextResponse.json({ error: "Pick a replacement exercise." }, { status: 400 });
  }
  const reason = (REPLACEMENT_REASONS as readonly string[]).includes(body.reason ?? "") ? (body.reason as ReplacementReason) : "other";
  const replacementScope = REPLACEMENT_SCOPES.includes((body.replacementScope ?? "temporary") as ReplacementScope)
    ? (body.replacementScope as ReplacementScope)
    : "temporary";
  try {
    const row = await replaceSessionExercise(
      user.id,
      Number(id),
      Number(exerciseId),
      replacementExerciseId,
      reason,
      { replacementScope, confirmAnchorChange: body.confirmAnchorChange === true },
    );
    return NextResponse.json({ sessionExercise: row });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not replace exercise.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}