import { NextResponse } from "next/server";
import { currentUserOrNull } from "@/lib/session";
import { applyWeekRebuildProposal } from "@/lib/week-rebuild";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { confirmation?: string };
  if (body.confirmation !== "approve") {
    return NextResponse.json({ error: "Explicit approval is required." }, { status: 400 });
  }
  try {
    const result = await applyWeekRebuildProposal(user.id, Number(id), { confirmation: "approve" });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not apply the rebuild." },
      { status: 400 },
    );
  }
}
