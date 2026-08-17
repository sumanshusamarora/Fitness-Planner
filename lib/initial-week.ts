import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
} from "@/db/schema";
import { startOfWeekMonday, toISODate } from "./dates";

interface TemplateExercise {
  exercise: string;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number;
  restSeconds: number;
}

const FULL_BODY_A: TemplateExercise[] = [
  { exercise: "Leg Press", position: 1, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 40, restSeconds: 120 },
  { exercise: "Machine Chest Press", position: 2, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 15, restSeconds: 90 },
  { exercise: "Lat Pulldown", position: 3, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 },
  { exercise: "Seated Cable Row", position: 4, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 },
  { exercise: "Seated Leg Curl", position: 5, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 15, restSeconds: 90 },
  { exercise: "Dead Bug", position: 6, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 5, suggestedWeightKg: 0, restSeconds: 60 },
];

const FULL_BODY_B: TemplateExercise[] = [
  { exercise: "Leg Press", position: 1, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 40, restSeconds: 120 },
  { exercise: "Incline Chest Press", position: 2, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 12.5, restSeconds: 90 },
  { exercise: "Seated Cable Row", position: 3, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 },
  { exercise: "Machine Shoulder Press", position: 4, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 10, restSeconds: 90 },
  { exercise: "Cable Triceps Pushdown", position: 5, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 15, restSeconds: 90 },
  { exercise: "Glute Bridge", position: 6, targetSets: 1, minReps: 8, maxReps: 12, targetRpe: 5, suggestedWeightKg: 0, restSeconds: 60 },
];

const DAYS = [
  { dayNumber: 1, dayName: "Monday", title: "Full Body A" },
  { dayNumber: 2, dayName: "Tuesday", title: "Recovery" },
  { dayNumber: 3, dayName: "Wednesday", title: "Full Body B" },
  { dayNumber: 4, dayName: "Thursday", title: "Rest" },
  { dayNumber: 5, dayName: "Friday", title: "Full Body A" },
  { dayNumber: 6, dayName: "Saturday", title: "Optional cardio" },
  { dayNumber: 7, dayName: "Sunday", title: "Rest" },
];

/**
 * Creates the conservative Week 1 return-to-training plan for a new user.
 * Idempotent: returns null if the user already has any plan.
 */
export async function createInitialWeek(userId: number): Promise<number | null> {
  const existing = await db
    .select({ id: workoutPlans.id })
    .from(workoutPlans)
    .where(eq(workoutPlans.userId, userId))
    .limit(1);
  if (existing.length > 0) return null;

  const library = await db.select().from(exercises);
  const idByName = new Map(library.map((ex) => [ex.name, ex.id]));

  const [plan] = await db
    .insert(workoutPlans)
    .values({
      userId,
      name: "Week 1 — Return to Training",
      weekNumber: 1,
      startsOn: toISODate(startOfWeekMonday(new Date())),
      status: "active",
      notes: "Establish baseline strength. No training to failure.",
    })
    .returning();

  const dayIdByNumber = new Map<number, number>();
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
    dayIdByNumber.set(day.dayNumber, row.id);
  }

  const insert = async (dayNumber: number, list: TemplateExercise[]) => {
    const dayId = dayIdByNumber.get(dayNumber)!;
    for (const item of list) {
      const exerciseId = idByName.get(item.exercise);
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

  await insert(1, FULL_BODY_A);
  await insert(3, FULL_BODY_B);
  await insert(5, FULL_BODY_A);

  return plan.id;
}
