import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import {
  approveMapping,
  DEFAULT_PROVIDER,
  getCandidatesForExercise,
  rejectMapping,
} from "@/lib/external-exercises";
import { currentUserOrNull } from "@/lib/session";

export const dynamic = "force-dynamic";

async function loadExercise(exerciseId: number) {
  return db
    .select()
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const exerciseId = Number(id);
  if (!Number.isFinite(exerciseId)) {
    return NextResponse.json({ error: "Invalid exercise id" }, { status: 400 });
  }

  const [ex] = await loadExercise(exerciseId);
  if (!ex) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const candidates = await getCandidatesForExercise({
    id: ex.id,
    name: ex.name,
    primaryMuscle: ex.primaryMuscle,
    equipment: ex.equipment,
    category: ex.category,
  });

  return NextResponse.json({ exerciseId, candidates });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const { id } = await params;
  const exerciseId = Number(id);
  if (!Number.isFinite(exerciseId)) {
    return NextResponse.json({ error: "Invalid exercise id" }, { status: 400 });
  }

  const [ex] = await loadExercise(exerciseId);
  if (!ex) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    externalExerciseId?: number;
    provider?: string;
  };

  const externalExerciseId = Number(body.externalExerciseId);
  const provider = (body.provider as typeof DEFAULT_PROVIDER) || DEFAULT_PROVIDER;

  if (body.action === "approve") {
    if (!Number.isFinite(externalExerciseId)) {
      return NextResponse.json({ error: "externalExerciseId required" }, { status: 400 });
    }
    const mapping = await approveMapping(exerciseId, externalExerciseId, provider);
    return NextResponse.json({ ok: true, status: mapping.status });
  }

  if (body.action === "reject") {
    if (!Number.isFinite(externalExerciseId)) {
      return NextResponse.json({ error: "externalExerciseId required" }, { status: 400 });
    }
    const mapping = await rejectMapping(exerciseId, externalExerciseId, provider);
    return NextResponse.json({ ok: true, status: mapping.status });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
