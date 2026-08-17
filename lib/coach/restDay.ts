import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { exercises, workoutPlanDays, workoutPlanExercises, workoutPlans } from "@/db/schema";
import { hasMeaningfulJointPain, hasPoorRecovery } from "@/lib/progression";
import { getLatestRecoverySnapshot } from "@/lib/recovery";
import { getLastCompletedSets } from "@/lib/workouts";
import type { AddWorkoutExercise } from "@/lib/schedule";

export type Effort = "light" | "usual" | "heavy";

export interface RestDayWorkout {
  title: string;
  effort: Effort;
  reason: string;
  note: string | null;
  exercises: AddWorkoutExercise[];
}

/** Curated complementary movements for ad-hoc sessions. Compounds stay in the plan. */
const COMPLEMENTARY_POOL = [
  { name: "Cable Triceps Pushdown", muscle: "Triceps" },
  { name: "Dumbbell Curl", muscle: "Biceps" },
  { name: "Cable Curl", muscle: "Biceps" },
  { name: "Lateral Raise", muscle: "Shoulders" },
  { name: "Calf Raise", muscle: "Calves" },
  { name: "Leg Extension", muscle: "Quads" },
  { name: "Seated Leg Curl", muscle: "Hamstrings" },
  { name: "Hip Thrust Machine", muscle: "Glutes" },
  { name: "Glute Bridge", muscle: "Glutes" },
  { name: "Plank", muscle: "Core" },
  { name: "Dead Bug", muscle: "Core" },
  { name: "Treadmill", muscle: "Cardiovascular" },
  { name: "Exercise Bike", muscle: "Cardiovascular" },
];

interface EffortPreset {
  sets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  restSeconds: number;
  count: number;
  title: string;
}

const PRESETS: Record<Effort, EffortPreset> = {
  light: { sets: 1, minReps: 8, maxReps: 12, targetRpe: 5, restSeconds: 60, count: 2, title: "Light Session" },
  usual: { sets: 2, minReps: 8, maxReps: 12, targetRpe: 6, restSeconds: 90, count: 3, title: "Extra Session" },
  heavy: { sets: 3, minReps: 8, maxReps: 12, targetRpe: 7, restSeconds: 120, count: 4, title: "Bonus Session" },
};

interface EffortContext {
  jointPain: boolean;
  poorRecovery: boolean;
  earlyPhase: boolean;
  adjacentOverlap: boolean;
}

function resolveEffort(
  requested: Effort,
  ctx: EffortContext,
): { effort: Effort; reason: string; note: string | null } {
  if (requested === "light") {
    return { effort: "light", reason: "Light additional session to keep things easy.", note: null };
  }

  if (ctx.jointPain) {
    return {
      effort: "light",
      reason: "Joint pain is reported, so a demanding session is not ideal right now.",
      note: "Keep it light and stop anything that hurts. Seek assessment if it persists.",
    };
  }

  if (ctx.poorRecovery) {
    return {
      effort: "light",
      reason: "Recovery is below normal, so keep today very light.",
      note: "Low sleep/energy or high soreness means a light session is the better call.",
    };
  }

  if (requested === "usual") {
    return { effort: "usual", reason: "A moderate additional session to keep momentum.", note: null };
  }

  // heavy from here
  if (ctx.earlyPhase) {
    return {
      effort: "usual",
      reason: "You're still in the early return-to-training phase, so heavy is not ideal yet.",
      note: null,
    };
  }
  if (ctx.adjacentOverlap) {
    return {
      effort: "usual",
      reason: "Yesterday or tomorrow already works these muscles, so keep today moderate.",
      note: null,
    };
  }
  return { effort: "heavy", reason: "Recovery and schedule allow a harder bonus session.", note: null };
}

export async function proposeRestDayWorkout(input: {
  userId: number;
  workoutPlanId: number;
  dayNumber: number;
  requestedEffort: Effort;
}): Promise<RestDayWorkout> {
  const { userId, workoutPlanId, dayNumber, requestedEffort } = input;

  const [plan, recovery, plannedRows, library] = await Promise.all([
    db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, workoutPlanId), eq(workoutPlans.userId, userId)))
      .limit(1),
    getLatestRecoverySnapshot(userId),
    db
      .select({
        dayNumber: workoutPlanDays.dayNumber,
        muscle: exercises.primaryMuscle,
        exerciseId: exercises.id,
      })
      .from(workoutPlanExercises)
      .innerJoin(workoutPlanDays, eq(workoutPlanExercises.workoutPlanDayId, workoutPlanDays.id))
      .innerJoin(exercises, eq(workoutPlanExercises.exerciseId, exercises.id))
      .where(eq(workoutPlanDays.workoutPlanId, workoutPlanId)),
    db.select().from(exercises).where(eq(exercises.active, true)),
  ]);
  if (!plan[0]) throw new Error("Plan not found.");

  const musclesByDay = new Map<number, Set<string>>();
  const weekExerciseIds = new Set<number>();
  for (const row of plannedRows) {
    if (!musclesByDay.has(row.dayNumber)) musclesByDay.set(row.dayNumber, new Set());
    musclesByDay.get(row.dayNumber)!.add(row.muscle);
    weekExerciseIds.add(row.exerciseId);
  }

  const adjacentMuscles = new Set<string>([
    ...(musclesByDay.get(dayNumber - 1) ?? []),
    ...(musclesByDay.get(dayNumber + 1) ?? []),
  ]);

  const ctx: EffortContext = {
    jointPain: hasMeaningfulJointPain(recovery),
    poorRecovery: hasPoorRecovery(recovery),
    earlyPhase: plan[0].weekNumber <= 2,
    adjacentOverlap: adjacentMuscles.size > 0,
  };

  const { effort, reason, note } = resolveEffort(requestedEffort, ctx);
  const preset = PRESETS[effort];

  // Prefer library exercises by name from the curated pool.
  const byName = new Map(library.map((ex) => [ex.name, ex]));
  const candidates = COMPLEMENTARY_POOL.filter(
    (item) => byName.has(item.name) && !adjacentMuscles.has(item.muscle),
  ).map((item) => byName.get(item.name)!);
  const fallback = COMPLEMENTARY_POOL.filter(
    (item) => byName.has(item.name) && !weekExerciseIds.has(byName.get(item.name)!.id),
  ).map((item) => byName.get(item.name)!);

  const picked: (typeof library)[number][] = [];
  for (const ex of [...candidates, ...fallback]) {
    if (picked.some((p) => p.id === ex.id)) continue;
    picked.push(ex);
    if (picked.length >= preset.count) break;
  }

  const result: AddWorkoutExercise[] = [];
  for (let i = 0; i < picked.length; i++) {
    const ex = picked[i];
    const lastSets = await getLastCompletedSets(userId, ex.id);
    result.push({
      exerciseId: ex.id,
      name: ex.name,
      position: i + 1,
      targetSets: preset.sets,
      minReps: preset.minReps,
      maxReps: preset.maxReps,
      targetRpe: preset.targetRpe,
      suggestedWeightKg: lastSets.length ? lastSets[lastSets.length - 1].weightKg : null,
      restSeconds: preset.restSeconds,
    });
  }

  return { title: preset.title, effort, reason, note, exercises: result };
}
