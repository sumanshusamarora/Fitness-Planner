import { eq } from "drizzle-orm";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { startOfWeekMonday, toISODate } from "@/lib/dates";
import type {
  CoachConfidence,
  ExerciseChange,
  InitialTrainingContext,
  ProposedWorkoutDay,
  ProposedWorkoutExercise,
  WeeklyPlanProposal,
} from "./types";

interface TemplateExercise {
  name: string;
  restSeconds: number;
}

interface DayTemplates {
  a: TemplateExercise[];
  b: TemplateExercise[];
}

const FULL_A: TemplateExercise[] = [
  { name: "Leg Press", restSeconds: 120 },
  { name: "Machine Chest Press", restSeconds: 90 },
  { name: "Lat Pulldown", restSeconds: 90 },
  { name: "Seated Cable Row", restSeconds: 90 },
  { name: "Seated Leg Curl", restSeconds: 90 },
  { name: "Dead Bug", restSeconds: 60 },
];

const FULL_B: TemplateExercise[] = [
  { name: "Leg Press", restSeconds: 120 },
  { name: "Incline Chest Press", restSeconds: 90 },
  { name: "Seated Cable Row", restSeconds: 90 },
  { name: "Machine Shoulder Press", restSeconds: 90 },
  { name: "Cable Triceps Pushdown", restSeconds: 90 },
  { name: "Glute Bridge", restSeconds: 60 },
];

const LIMITED_A: TemplateExercise[] = [
  { name: "Lat Pulldown", restSeconds: 90 },
  { name: "Seated Cable Row", restSeconds: 90 },
  { name: "Cable Triceps Pushdown", restSeconds: 90 },
  { name: "Dumbbell Curl", restSeconds: 90 },
  { name: "Lateral Raise", restSeconds: 90 },
  { name: "Glute Bridge", restSeconds: 60 },
];

const LIMITED_B: TemplateExercise[] = [
  { name: "Seated Cable Row", restSeconds: 90 },
  { name: "Lat Pulldown", restSeconds: 90 },
  { name: "Cable Curl", restSeconds: 90 },
  { name: "Cable Triceps Pushdown", restSeconds: 90 },
  { name: "Lateral Raise", restSeconds: 90 },
  { name: "Plank", restSeconds: 60 },
];

const HOME_A: TemplateExercise[] = [
  { name: "Glute Bridge", restSeconds: 60 },
  { name: "Dumbbell Curl", restSeconds: 90 },
  { name: "Lateral Raise", restSeconds: 90 },
  { name: "Plank", restSeconds: 60 },
  { name: "Dead Bug", restSeconds: 60 },
];

const HOME_B: TemplateExercise[] = [
  { name: "Dead Bug", restSeconds: 60 },
  { name: "Glute Bridge", restSeconds: 60 },
  { name: "Lateral Raise", restSeconds: 90 },
  { name: "Dumbbell Curl", restSeconds: 90 },
  { name: "Plank", restSeconds: 60 },
];

function templatesFor(environment: string | null): DayTemplates {
  if (environment === "home") return { a: HOME_A, b: HOME_B };
  if (environment === "limited") return { a: LIMITED_A, b: LIMITED_B };
  return { a: FULL_A, b: FULL_B };
}

function experienceParams(level: string | null): { sets: number; rpe: number; conservative: boolean } {
  switch (level) {
    case "beginner":
      return { sets: 2, rpe: 5, conservative: true };
    case "returning":
      return { sets: 2, rpe: 6, conservative: true };
    case "occasional":
      return { sets: 2, rpe: 6, conservative: false };
    case "intermediate":
      return { sets: 3, rpe: 7, conservative: false };
    case "advanced":
      return { sets: 3, rpe: 7, conservative: false };
    default:
      return { sets: 2, rpe: 6, conservative: true };
  }
}

function exercisesPerDay(sessionMinutes: string | null): number {
  switch (sessionMinutes) {
    case "30":
      return 4;
    case "45":
      return 5;
    case "60":
      return 6;
    case "60+":
      return 7;
    default:
      return 5;
  }
}

function pickResistanceDays(
  desired: number | null,
  preferred: number[],
  conservative: boolean,
): { days: number[]; note: string | null } {
  const wanted = desired ?? 3;
  const cap = conservative ? 3 : 4;
  const count = Math.max(2, Math.min(wanted, cap));
  const defaults: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
  };
  const chosen = [...preferred].filter((d) => d >= 1 && d <= 7);
  for (const d of defaults[count]) {
    if (chosen.length >= count) break;
    if (!chosen.includes(d)) chosen.push(d);
  }
  const days = chosen.slice(0, count).sort((a, b) => a - b);
  const note =
    wanted > count
      ? `You asked for ${wanted} days; to ease back in, this plan uses ${count} resistance days with recovery and optional cardio on the other days.`
      : null;
  return { days, note };
}

const REST_TITLES: Record<number, string> = {
  2: "Recovery",
  4: "Recovery",
  6: "Optional cardio",
};

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export async function proposeFirstWeek(
  context: InitialTrainingContext,
): Promise<WeeklyPlanProposal> {
  const { sets, rpe, conservative } = experienceParams(context.profile.experienceLevel);
  const perDay = exercisesPerDay(context.profile.sessionMinutes);
  const templates = templatesFor(context.profile.trainingEnvironment);
  const { days: resistanceDays, note } = pickResistanceDays(
    context.profile.desiredDaysPerWeek,
    context.profile.preferredDays,
    conservative,
  );

  const library = await db.select().from(exercises).where(eq(exercises.active, true));
  const idByName = new Map(library.map((ex) => [ex.name, ex.id]));

  const hasLimitations = Boolean(context.profile.limitationsNotes?.trim());
  const confidence: CoachConfidence = hasLimitations ? "medium" : "high";

  const changes: ExerciseChange[] = [];
  const proposalDays: ProposedWorkoutDay[] = [];
  let counter = -1;

  for (let dayNumber = 1; dayNumber <= 7; dayNumber++) {
    if (!resistanceDays.includes(dayNumber)) {
      proposalDays.push({
        sourcePlanDayId: -dayNumber,
        dayNumber,
        dayName: DAY_NAMES[dayNumber],
        title: REST_TITLES[dayNumber] ?? "Rest",
        exercises: [],
      });
      continue;
    }

    const isA = resistanceDays.indexOf(dayNumber) % 2 === 0;
    const template = (isA ? templates.a : templates.b).slice(0, perDay);
    const exercisesForDay: ProposedWorkoutExercise[] = template.map((entry, i) => {
      const sourcePlanExerciseId = counter--;
      const exerciseId = idByName.get(entry.name) ?? 0;
      const change: ExerciseChange = {
        sourcePlanExerciseId,
        exerciseId,
        exerciseName: entry.name,
        previous: { weightKg: null, sets, minReps: 8, maxReps: 12, targetRpe: rpe },
        proposed: { weightKg: null, sets, minReps: 8, maxReps: 12, targetRpe: rpe },
        action: "maintain",
        confidence,
        reason: "Starting load for Week 1.",
        evidence: [],
      };
      changes.push(change);
      return { ...change, position: i + 1, restSeconds: entry.restSeconds };
    });

    proposalDays.push({
      sourcePlanDayId: -dayNumber,
      dayNumber,
      dayName: DAY_NAMES[dayNumber],
      title: isA ? "Full Body A" : "Full Body B",
      exercises: exercisesForDay,
    });
  }

  return {
    proposalType: "initial_week",
    sourceWeekId: null,
    proposedWeekNumber: 1,
    proposedStartsOn: toISODate(startOfWeekMonday(new Date())),
    summary: {
      completedSessions: 0,
      plannedSessions: resistanceDays.length,
      recoverySummary: "No training history yet — starting with a conservative baseline.",
      overallRecommendation:
        note ?? "A conservative first week to establish baseline strength and technique.",
    },
    changes,
    days: proposalDays,
    questions: [],
    confidence,
    methodologyVersion: "local-deterministic-v1",
  };
}
