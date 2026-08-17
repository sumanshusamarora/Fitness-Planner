import { NextResponse } from "next/server";
import { finishSession } from "@/lib/workouts";
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
    energyRating?: string | null;
    overallRpe?: number | null;
  };

  try {
    await finishSession(user.id, Number(id), {
      energyRating: body.energyRating ?? null,
      overallRpe: body.overallRpe ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not finish workout.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}