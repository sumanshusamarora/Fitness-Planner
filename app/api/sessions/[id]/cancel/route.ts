import { NextResponse } from "next/server";
import { cancelEmptySession } from "@/lib/workouts";
import { currentUserOrNull } from "@/lib/session";
import { toErrorBody } from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const result = await cancelEmptySession(user.id, Number(id));
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toErrorBody(error, "Could not cancel this workout start.", 404);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}