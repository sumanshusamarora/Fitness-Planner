import { NextResponse } from "next/server";
import { toErrorBody } from "@/lib/errors";
import { currentUserOrNull } from "@/lib/session";
import { removeSessionSet, updateSessionSet } from "@/lib/session-activities";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; setId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const { id, setId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    weightKg?: number;
    reps?: number;
    rpe?: number | null;
    setType?: string;
  };

  const patch: { weightKg?: number; reps?: number; rpe?: number | null; setType?: "warmup" | "working" } = {};
  if ("weightKg" in body) patch.weightKg = Number(body.weightKg);
  if ("reps" in body) patch.reps = Number(body.reps);
  if ("rpe" in body) patch.rpe = body.rpe == null ? null : Number(body.rpe);
  if ("setType" in body) patch.setType = body.setType === "warmup" ? "warmup" : "working";

  if (patch.weightKg != null && (!Number.isFinite(patch.weightKg) || patch.weightKg < 0)) {
    return NextResponse.json({ error: "Invalid weight." }, { status: 400 });
  }
  if (patch.reps != null && (!Number.isFinite(patch.reps) || patch.reps < 0)) {
    return NextResponse.json({ error: "Invalid reps/seconds." }, { status: 400 });
  }
  if (patch.rpe != null && (!Number.isFinite(patch.rpe) || patch.rpe < 1 || patch.rpe > 10)) {
    return NextResponse.json({ error: "Invalid RPE." }, { status: 400 });
  }
  if (patch.weightKg != null && patch.reps != null && patch.weightKg <= 0 && patch.reps <= 0) {
    return NextResponse.json({ error: "Enter a weight or reps." }, { status: 400 });
  }

  try {
    const set = await updateSessionSet(user.id, Number(id), Number(setId), patch);
    return NextResponse.json({ set });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not update this set.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; setId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const { id, setId } = await params;
  try {
    await removeSessionSet(user.id, Number(id), Number(setId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not remove this set.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
