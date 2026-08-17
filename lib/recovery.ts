import { desc } from "drizzle-orm";
import { db } from "../db";
import { recoveryLogs } from "../db/schema";
import type { RecoverySnapshot } from "./progression";

export async function getLatestRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  const rows = await db
    .select()
    .from(recoveryLogs)
    .orderBy(desc(recoveryLogs.createdAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    sleep: r.sleepRating,
    energy: r.energyRating,
    soreness: r.sorenessRating,
    jointPain: r.jointPainRating,
    stress: r.stressRating,
  };
}
