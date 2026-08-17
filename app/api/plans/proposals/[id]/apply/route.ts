import { NextResponse } from "next/server";
import { applyProposal } from "@/lib/coach/applyProposal";
import type { ProposalDecision } from "@/lib/coach/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const result = await applyProposal(proposalId, {
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
