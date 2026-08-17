import { NextResponse } from "next/server";
import { finishSession } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not finish workout." },
      { status: 404 },
    );
  }
}
