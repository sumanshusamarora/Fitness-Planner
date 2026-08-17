import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { exercises, users, workoutPlans } from "./schema";
import { createInitialWeek } from "../lib/initial-week";

const EXERCISES: {
  name: string;
  category: string;
  primaryMuscle: string;
  equipment: string;
}[] = [
  { name: "Leg Press", category: "strength", primaryMuscle: "Quads", equipment: "Machine" },
  { name: "Machine Chest Press", category: "strength", primaryMuscle: "Chest", equipment: "Machine" },
  { name: "Lat Pulldown", category: "strength", primaryMuscle: "Back", equipment: "Cable" },
  { name: "Seated Leg Curl", category: "strength", primaryMuscle: "Hamstrings", equipment: "Machine" },
  { name: "Seated Cable Row", category: "strength", primaryMuscle: "Back", equipment: "Cable" },
  { name: "Machine Shoulder Press", category: "strength", primaryMuscle: "Shoulders", equipment: "Machine" },
  { name: "Incline Chest Press", category: "strength", primaryMuscle: "Chest", equipment: "Machine" },
  { name: "Leg Extension", category: "strength", primaryMuscle: "Quads", equipment: "Machine" },
  { name: "Calf Raise", category: "strength", primaryMuscle: "Calves", equipment: "Machine" },
  { name: "Cable Triceps Pushdown", category: "strength", primaryMuscle: "Triceps", equipment: "Cable" },
  { name: "Dumbbell Curl", category: "strength", primaryMuscle: "Biceps", equipment: "Dumbbell" },
  { name: "Cable Curl", category: "strength", primaryMuscle: "Biceps", equipment: "Cable" },
  { name: "Lateral Raise", category: "strength", primaryMuscle: "Shoulders", equipment: "Dumbbell" },
  { name: "Hip Thrust Machine", category: "strength", primaryMuscle: "Glutes", equipment: "Machine" },
  { name: "Glute Bridge", category: "strength", primaryMuscle: "Glutes", equipment: "Bodyweight" },
  { name: "Plank", category: "core", primaryMuscle: "Core", equipment: "Bodyweight" },
  { name: "Dead Bug", category: "core", primaryMuscle: "Core", equipment: "Bodyweight" },
  { name: "Treadmill", category: "cardio", primaryMuscle: "Cardiovascular", equipment: "Machine" },
  { name: "Exercise Bike", category: "cardio", primaryMuscle: "Cardiovascular", equipment: "Machine" },
];

async function ensureExercises() {
  const names = EXERCISES.map((e) => e.name);
  const existing = await db
    .select({ name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.name, names));
  const have = new Set(existing.map((e) => e.name));
  let added = 0;
  for (const ex of EXERCISES) {
    if (have.has(ex.name)) continue;
    await db.insert(exercises).values({
      name: ex.name,
      category: ex.category,
      primaryMuscle: ex.primaryMuscle,
      equipment: ex.equipment,
      instructions: null,
      active: true,
    });
    added += 1;
  }
  return added;
}

async function main() {
  const addedExercises = await ensureExercises();

  const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
  if (existingUsers.length === 0) {
    console.log("No users found. Creating the default profile...");
    const [user] = await db
      .insert(users)
      .values({
        name: "Sam",
        username: "Sam",
        usernameNormalized: "sam",
        dateOfBirth: "1989-05-01",
        heightCm: 180,
      })
      .returning();
    const planId = await createInitialWeek(user.id);
    console.log(`  User: ${user.name} (id ${user.id}, @${user.username})`);
    console.log(`  Plan: ${planId ? `created (#${planId})` : "skipped"}`);
  } else {
    console.log("Users already exist. Skipping user/plan creation to preserve real data.");
  }

  console.log(`Seed complete. Added ${addedExercises} exercises.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
