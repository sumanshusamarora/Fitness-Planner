import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userTrainingProfiles } from "@/db/schema";

export interface TrainingProfileInput {
  primaryGoal: string | null;
  secondaryGoals: string[] | null;
  experienceLevel: string | null;
  yearsSinceTraining: number | null;
  desiredDaysPerWeek: number | null;
  preferredDays: number[] | null;
  sessionMinutes: string | null;
  trainingEnvironment: string | null;
  equipmentNotes: string | null;
  limitationsNotes: string | null;
  bodyWeightKg: number | null;
}

export async function getTrainingProfile(userId: number) {
  const rows = await db
    .select()
    .from(userTrainingProfiles)
    .where(eq(userTrainingProfiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertTrainingProfile(
  userId: number,
  input: TrainingProfileInput,
) {
  const existing = await getTrainingProfile(userId);
  if (existing) {
    const [row] = await db
      .update(userTrainingProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(userTrainingProfiles.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(userTrainingProfiles)
    .values({ userId, ...input })
    .returning();
  return row;
}
