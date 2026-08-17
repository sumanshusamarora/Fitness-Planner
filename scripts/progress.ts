import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { buildProgressAnalytics } from "@/lib/progress";
import { normalizeUsername } from "@/lib/username";

const ARROW: Record<string, string> = {
  improving_fast: "↑ improving quickly",
  improving: "↑ improving",
  improving_slowly: "↗ improving slowly",
  flat: "→ flat",
  declining: "↓ declining",
  insufficient_data: "? insufficient data",
};

async function resolveUserId(argv: string[]): Promise<number> {
  const idx = argv.indexOf("--user");
  const token = idx !== -1 ? argv[idx + 1] : process.env.FITNESS_USER_ID;
  if (token) {
    const byId = Number(token);
    if (Number.isInteger(byId) && byId > 0) return byId;
    const normalized = normalizeUsername(token);
    const row = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameNormalized, normalized))
        .limit(1)
    )[0];
    if (row) return row.id;
    throw new Error(`No user found for "${token}".`);
  }
  throw new Error("Provide a user with --user <id|username> or FITNESS_USER_ID.");
}

async function main() {
  const args = process.argv.slice(2);
  const userId = await resolveUserId(args);

  const user = (
    await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  const progress = await buildProgressAnalytics({ userId });

  console.log(`\n${user?.name ?? `User ${userId}`}\n`);
  console.log("Training stage:");
  console.log(`  ${progress.trainingStage.toUpperCase()}\n`);
  console.log("Overall:");
  console.log(`  ${progress.performance.overallDirection.toUpperCase()}\n`);
  console.log("Tolerance:");
  console.log(`  ${progress.tolerance.trend.toUpperCase()}\n`);

  console.log("Exercise trends:");
  for (const exercise of progress.exercises) {
    console.log(`\n${exercise.name}`);
    console.log(`  ${ARROW[exercise.direction] ?? exercise.direction}`);
    console.log(`  ${exercise.exposureCount} exposures`);
  }

  console.log("\nPlateau:");
  console.log(`  ${progress.plateau.status} (${progress.plateau.confidence})`);
  for (const confounder of progress.plateau.confounders) {
    console.log(`  - ${confounder.type}: ${confounder.detail}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
