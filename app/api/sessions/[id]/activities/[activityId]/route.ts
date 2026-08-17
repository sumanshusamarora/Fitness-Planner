import { NextResponse } from "next/server";
import { removeSessionActivity, updateSessionActivity } from "@/lib/session-activities";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id, activityId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const key of ["nameSnapshot", "notes"]) {
    if (key in body) patch[key] = body[key];
  }
  for (const key of ["durationSeconds", "distanceMeters", "speed", "inclinePercent", "effortRpe"]) {
    if (key in body) patch[key] = body[key] == null ? null : Number(body[key]);
  }

  try {
    const row = await updateSessionActivity(user.id, Number(id), Number(activityId), patch as never);
    return NextResponse.json({ activity: row });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not update activity.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  const { id, activityId } = await params;
  try {
    await removeSessionActivity(user.id, Number(id), Number(activityId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not remove activity.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
