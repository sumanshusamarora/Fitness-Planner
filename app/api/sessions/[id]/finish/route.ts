import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessions } from "@/db/schema";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionId = Number(id);

  const body = (await req.json().catch(() => ({}))) as {
    energyRating?: string | null;
    overallRpe?: number | null;
  };

  const [session] = await db
    .update(workoutSessions)
    .set({
      completedAt: new Date(),
      energyRating: body.energyRating ?? null,
      overallRpe: body.overallRpe ?? null,
    })
    .where(eq(workoutSessions.id, sessionId))
    .returning();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
