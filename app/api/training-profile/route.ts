import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUserOrNull } from "@/lib/session";
import { upsertTrainingProfile } from "@/lib/training-profile";

export async function POST(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    primaryGoal?: string | null;
    secondaryGoals?: string[] | null;
    experienceLevel?: string | null;
    yearsSinceTraining?: number | null;
    desiredDaysPerWeek?: number | null;
    preferredDays?: number[] | null;
    sessionMinutes?: string | null;
    trainingEnvironment?: string | null;
    equipmentNotes?: string | null;
    limitationsNotes?: string | null;
    bodyWeightKg?: number | null;
    dateOfBirth?: string | null;
    heightCm?: number | null;
  };

  await upsertTrainingProfile(user.id, {
    primaryGoal: body.primaryGoal ?? null,
    secondaryGoals: body.secondaryGoals ?? null,
    experienceLevel: body.experienceLevel ?? null,
    yearsSinceTraining: body.yearsSinceTraining ?? null,
    desiredDaysPerWeek: body.desiredDaysPerWeek ?? null,
    preferredDays: body.preferredDays ?? null,
    sessionMinutes: body.sessionMinutes ?? null,
    trainingEnvironment: body.trainingEnvironment ?? null,
    equipmentNotes: body.equipmentNotes ?? null,
    limitationsNotes: body.limitationsNotes ?? null,
    bodyWeightKg: body.bodyWeightKg ?? null,
  });

  if (body.dateOfBirth != null || body.heightCm != null) {
    await db
      .update(users)
      .set({
        dateOfBirth: body.dateOfBirth ?? null,
        heightCm: body.heightCm ?? null,
      })
      .where(eq(users.id, user.id));
  }

  return NextResponse.json({ ok: true });
}
