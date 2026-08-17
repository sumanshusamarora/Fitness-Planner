import { NextResponse } from "next/server";
import { respondToProposal } from "@/lib/coach/respondToProposal";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { questionId?: string; answer?: string };
  if (!Number.isInteger(Number(id)) || !body.questionId || !body.answer) {
    return NextResponse.json({ error: "A proposal question and answer are required." }, { status: 400 });
  }
  try {
    const proposal = await respondToProposal(Number(id), body.questionId, body.answer);
    return NextResponse.json({ proposal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save answer." }, { status: 400 });
  }
}
