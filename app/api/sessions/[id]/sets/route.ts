import { NextResponse } from "next/server";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";
import { logSessionSet } from "@/lib/session-activities";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const sessionId = Number(id);

  try {
    const body = (await req.json()) as {
      exerciseId?: number;
      weightKg?: number;
      reps?: number;
      rpe?: number | null;
      setType?: string;
    };

    const exerciseId = Number(body.exerciseId);
    const weightKg = Number(body.weightKg);
    const reps = Number(body.reps);
    const rpe = body.rpe == null ? null : Number(body.rpe);
    const setType = body.setType === "warmup" ? "warmup" : "working";

    if (
      !Number.isFinite(weightKg) ||
      !Number.isFinite(reps) ||
      weightKg < 0 ||
      reps < 0
    ) {
      return NextResponse.json({ error: "Invalid weight or reps" }, { status: 400 });
    }

    // Bodyweight / timed-hold movements legitimately log weight 0. A set needs
    // either a weight OR a rep/time value; never both missing.
    if (reps <= 0 && weightKg <= 0) {
      return NextResponse.json({ error: "Enter a weight or reps." }, { status: 400 });
    }

    const set = await logSessionSet(user.id, sessionId, {
      exerciseId,
      weightKg,
      reps,
      rpe,
      setType,
    });

    return NextResponse.json({ setId: set.id });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not save this set.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
