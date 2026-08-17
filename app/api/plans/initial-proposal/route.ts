import { NextResponse } from "next/server";
import { createInitialProposal } from "@/lib/coach/service";
import { currentUserOrNull } from "@/lib/session";

export async function POST() {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  try {
    const proposal = await createInitialProposal(user.id);
    return NextResponse.json({ proposalId: proposal.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build your first week." },
      { status: 400 },
    );
  }
}
