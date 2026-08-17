import { NextResponse } from "next/server";
import { currentUserOrNull } from "@/lib/session";
import { respondToWeekRebuild } from "@/lib/week-rebuild";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { questionId?: string; answer?: string };
  if (!body.questionId || !body.answer) {
    return NextResponse.json({ error: "A question and answer are required." }, { status: 400 });
  }
  try {
    const stored = await respondToWeekRebuild(user.id, Number(id), body.questionId, body.answer);
    return NextResponse.json(stored);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record the answer." },
      { status: 400 },
    );
  }
}
