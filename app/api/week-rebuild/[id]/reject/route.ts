import { NextResponse } from "next/server";
import { currentUserOrNull } from "@/lib/session";
import { rejectWeekRebuildProposal } from "@/lib/week-rebuild";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const result = await rejectWeekRebuildProposal(user.id, Number(id));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not reject the rebuild." },
      { status: 400 },
    );
  }
}
