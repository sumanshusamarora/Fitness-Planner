import { NextResponse } from "next/server";
import { endSessionEarly } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    reason?: string | null;
    energyRating?: string | null;
    overallRpe?: number | null;
  };

  try {
    await endSessionEarly(user.id, Number(id), {
      reason: body.reason ?? null,
      energyRating: body.energyRating ?? null,
      overallRpe: body.overallRpe ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not end workout.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}