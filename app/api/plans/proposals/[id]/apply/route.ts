import { NextResponse } from "next/server";
import { applyProposal } from "@/lib/coach/applyProposal";
import type { ProposalDecision } from "@/lib/coach/types";
import { currentUserOrNull } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const proposalId = Number(id);
  const body = (await request.json().catch(() => ({}))) as {
    confirmation?: string;
    decisions?: Record<string, ProposalDecision>;
  };
  if (!Number.isInteger(proposalId) || body.confirmation !== "approve") {
    return NextResponse.json({ error: "Explicit approval is required." }, { status: 400 });
  }
  try {
    const result = await applyProposal(user.id, proposalId, {
      confirmation: "approve",
      decisions: body.decisions ?? {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not apply proposal." },
      { status: 400 },
    );
  }
}
