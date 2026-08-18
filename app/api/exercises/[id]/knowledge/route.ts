import { NextResponse } from "next/server";
import { toErrorBody } from "@/lib/errors";
import {
  getExerciseKnowledge,
  isEquipmentAvailability,
  setExerciseAnchorState,
  setUserExerciseEquipmentAvailability,
  setUserExercisePreference,
} from "@/lib/exercise-knowledge";
import { currentUserOrNull } from "@/lib/session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });

  const { id } = await params;
  const exerciseId = Number(id);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
    return NextResponse.json({ error: "Invalid exercise id." }, { status: 400 });
  }

  const knowledge = await getExerciseKnowledge(exerciseId, user.id);
  if (!knowledge) {
    return NextResponse.json({ error: "Exercise not found." }, { status: 404 });
  }

  return NextResponse.json({ knowledge });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) return NextResponse.json({ error: "No profile selected" }, { status: 401 });

  const { id } = await params;
  const exerciseId = Number(id);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
    return NextResponse.json({ error: "Invalid exercise id." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    preference?: "preferred" | "dont_prefer" | null;
    availability?: string;
    anchorState?: "none" | "candidate" | "current";
  };

  try {
    if (body.action === "set_preference") {
      const preference = body.preference ?? null;
      if (
        preference !== null &&
        preference !== "preferred" &&
        preference !== "dont_prefer"
      ) {
        return NextResponse.json({ error: "Invalid preference." }, { status: 400 });
      }
      await setUserExercisePreference(user.id, exerciseId, preference);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "set_availability") {
      if (!isEquipmentAvailability(body.availability)) {
        return NextResponse.json({ error: "Invalid availability." }, { status: 400 });
      }
      await setUserExerciseEquipmentAvailability(user.id, exerciseId, body.availability);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "set_anchor_state") {
      if (
        body.anchorState !== "none" &&
        body.anchorState !== "candidate" &&
        body.anchorState !== "current"
      ) {
        return NextResponse.json({ error: "Invalid anchor state." }, { status: 400 });
      }
      await setExerciseAnchorState(user.id, exerciseId, body.anchorState);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const mapped = toErrorBody(error, "Could not update exercise knowledge.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
