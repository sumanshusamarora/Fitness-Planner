import "dotenv/config";
import { db } from "./index";
import {
  exerciseMedia,
  exercises,
  recoveryLogs,
  weeklyPlanProposals,
  users,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "./schema";
import { startOfWeekMonday, toISODate } from "../lib/dates";

const EXERCISES: {
  name: string;
  category: string;
  primaryMuscle: string;
  equipment: string;
  instructions?: string;
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

interface PlanExerciseSeed {
  exercise: string;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number;
  restSeconds: number;
}

const FULL_BODY_A: PlanExerciseSeed[] = [
  { exercise: "Leg Press", position: 1, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 40, restSeconds: 120 },
  { exercise: "Machine Chest Press", position: 2, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 15, restSeconds: 90 },
  { exercise: "Lat Pulldown", position: 3, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 },
  { exercise: "Seated Cable Row", position: 4, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 },
  { exercise: "Seated Leg Curl", position: 5, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 15, restSeconds: 90 },
  { exercise: "Dead Bug", position: 6, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 5, suggestedWeightKg: 0, restSeconds: 60 },
];

const FULL_BODY_B: PlanExerciseSeed[] = [
  { exercise: "Leg Press", position: 1, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 40, restSeconds: 120 },
  { exercise: "Incline Chest Press", position: 2, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 12.5, restSeconds: 90 },
  { exercise: "Seated Cable Row", position: 3, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 },
  { exercise: "Machine Shoulder Press", position: 4, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 10, restSeconds: 90 },
  { exercise: "Cable Triceps Pushdown", position: 5, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 15, restSeconds: 90 },
  { exercise: "Glute Bridge", position: 6, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 5, suggestedWeightKg: 0, restSeconds: 60 },
];

async function main() {
  console.log("Clearing existing data...");
  await db.delete(workoutSets);
  await db.delete(workoutSessionExercises);
  await db.delete(recoveryLogs);
  await db.delete(workoutSessions);
  await db.delete(weeklyPlanProposals);
  await db.delete(workoutPlanExercises);
  await db.delete(workoutPlanDays);
  await db.delete(workoutPlans);
  await db.delete(exerciseMedia);
  await db.delete(exercises);
  await db.delete(users);

  console.log("Seeding user...");
  const [user] = await db
    .insert(users)
    .values({ name: "Sam", dateOfBirth: "1989-05-01", heightCm: 180 })
    .returning();

  console.log("Seeding exercises...");
  const exerciseIds = new Map<string, number>();
  for (const ex of EXERCISES) {
    const [row] = await db
      .insert(exercises)
      .values({
        name: ex.name,
        category: ex.category,
        primaryMuscle: ex.primaryMuscle,
        equipment: ex.equipment,
        instructions: ex.instructions ?? null,
        active: true,
      })
      .returning();
    exerciseIds.set(ex.name, row.id);
  }

  console.log("Seeding Week 1 plan...");
  const monday = startOfWeekMonday(new Date());
  const [plan] = await db
    .insert(workoutPlans)
    .values({
      userId: user.id,
      name: "Week 1 — Return to Training",
      weekNumber: 1,
      startsOn: toISODate(monday),
      status: "active",
      notes: "Establish baseline strength. No training to failure.",
    })
    .returning();

  const DAYS = [
    { dayNumber: 1, dayName: "Monday", title: "Full Body A" },
    { dayNumber: 2, dayName: "Tuesday", title: "Recovery" },
    { dayNumber: 3, dayName: "Wednesday", title: "Full Body B" },
    { dayNumber: 4, dayName: "Thursday", title: "Rest" },
    { dayNumber: 5, dayName: "Friday", title: "Full Body A" },
    { dayNumber: 6, dayName: "Saturday", title: "Optional cardio" },
    { dayNumber: 7, dayName: "Sunday", title: "Rest" },
  ];

  const dayIds = new Map<number, number>();
  for (const day of DAYS) {
    const [row] = await db
      .insert(workoutPlanDays)
      .values({
        workoutPlanId: plan.id,
        dayNumber: day.dayNumber,
        dayName: day.dayName,
        title: day.title,
      })
      .returning();
    dayIds.set(day.dayNumber, row.id);
  }

  const insertDayExercises = async (dayNumber: number, list: PlanExerciseSeed[]) => {
    const dayId = dayIds.get(dayNumber)!;
    for (const item of list) {
      const exerciseId = exerciseIds.get(item.exercise);
      if (!exerciseId) throw new Error(`Unknown exercise: ${item.exercise}`);
      await db.insert(workoutPlanExercises).values({
        workoutPlanDayId: dayId,
        exerciseId,
        position: item.position,
        targetSets: item.targetSets,
        minReps: item.minReps,
        maxReps: item.maxReps,
        targetRpe: item.targetRpe,
        suggestedWeightKg: item.suggestedWeightKg,
        restSeconds: item.restSeconds,
        notes: null,
      });
    }
  };

  await insertDayExercises(1, FULL_BODY_A);
  await insertDayExercises(3, FULL_BODY_B);
  await insertDayExercises(5, FULL_BODY_A);

  console.log("Seed complete.");
  console.log(`  User: ${user.name} (id ${user.id})`);
  console.log(`  Plan: ${plan.name} (id ${plan.id})`);
  console.log(`  Week starts: ${plan.startsOn}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
