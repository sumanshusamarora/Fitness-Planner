import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getTrainingProfile } from "@/lib/training-profile";
import { summariseRecovery } from "./recovery";
import type { InitialTrainingContext } from "./types";

export async function buildInitialTrainingContext(
  userId: number,
): Promise<InitialTrainingContext | null> {
  const user = (
    await db.select().from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!user) return null;

  const profile = await getTrainingProfile(userId);

  return {
    user,
    profile: {
      primaryGoal: profile?.primaryGoal ?? null,
      secondaryGoals: (profile?.secondaryGoals as string[] | null) ?? [],
      experienceLevel: profile?.experienceLevel ?? null,
      yearsSinceTraining: profile?.yearsSinceTraining ?? null,
      desiredDaysPerWeek: profile?.desiredDaysPerWeek ?? null,
      preferredDays: (profile?.preferredDays as number[] | null) ?? [],
      sessionMinutes: profile?.sessionMinutes ?? null,
      trainingEnvironment: profile?.trainingEnvironment ?? null,
      equipmentNotes: profile?.equipmentNotes ?? null,
      limitationsNotes: profile?.limitationsNotes ?? null,
    },
    recovery: summariseRecovery([]),
  };
}
