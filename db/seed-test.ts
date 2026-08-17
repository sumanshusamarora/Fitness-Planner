import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { exercises, users, workoutPlans } from "./schema";
import { createInitialWeek } from "../lib/initial-week";

/**
 * Creates (or reuses) a dedicated `fitness-test` profile for automated tests.
 * It never touches other users' data. Safe to run repeatedly.
 */
async function main() {
  const library = await db.select({ id: exercises.id }).from(exercises).limit(1);
  if (library.length === 0) {
    console.error("No exercises seeded. Run `npm run db:seed` first.");
    process.exit(1);
  }

  const normalized = "fitness-test";
  let user = (
    await db
      .select()
      .from(users)
      .where(eq(users.usernameNormalized, normalized))
      .limit(1)
  )[0];

  if (!user) {
    const [created] = await db
      .insert(users)
      .values({ name: "Fitness Test", username: "fitness-test", usernameNormalized: normalized })
      .returning();
    user = created;
  }

  const hasPlan = (
    await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, user.id)).limit(1)
  )[0];

  if (!hasPlan) {
    await createInitialWeek(user.id);
  }

  console.log(`Test user ready: id=${user.id} @${user.username}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
