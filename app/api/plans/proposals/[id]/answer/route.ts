import { NextResponse } from "next/server";
import { respondToProposal } from "@/lib/coach/respondToProposal";
import { currentUserOrNull } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { questionId?: string; answer?: string };
  if (!Number.isInteger(Number(id)) || !body.questionId || !body.answer) {
    return NextResponse.json({ error: "A proposal question and answer are required." }, { status: 400 });
  }
  try {
    const proposal = await respondToProposal(user.id, Number(id), body.questionId, body.answer);
    return NextResponse.json({ proposal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save answer." }, { status: 400 });
  }
}
