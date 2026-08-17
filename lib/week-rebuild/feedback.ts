import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { weekFeedback } from "@/db/schema";
import type { WeekFeedbackInput, WeekFeedbackReason } from "./types";

/**
 * Structured feedback categories and the material follow-up questions that can
 * change a rebuild decision. Feedback is stored as real data and summarised
 * back into future coaching context (never as raw UI wording).
 */

export interface FeedbackOption {
  key: WeekFeedbackReason;
  label: string;
}

export const FEEDBACK_REASONS: FeedbackOption[] = [
  { key: "too_difficult", label: "Too difficult" },
  { key: "too_easy", label: "Too easy" },
  { key: "too_many_days", label: "Too many workouts" },
  { key: "too_few_days", label: "Too few workouts" },
  { key: "sessions_too_long", label: "Sessions too long" },
  { key: "schedule_changed", label: "Schedule changed" },
  { key: "poor_recovery", label: "Recovery is poor" },
  { key: "pain", label: "Pain / discomfort" },
  { key: "exercise_preference", label: "Don't like an exercise" },
  { key: "equipment_problem", label: "Equipment problem" },
  { key: "other", label: "Something else" },
];

export interface FollowUpQuestion {
  id: string;
  question: string;
  options: string[];
}

/** Material follow-up questions per primary reason (kept small on purpose). */
export const FOLLOW_UP_QUESTIONS: Record<WeekFeedbackReason, FollowUpQuestion[]> = {
  too_difficult: [
    {
      id: "difficulty_driver",
      question: "What feels like the main issue?",
      options: ["Sessions too long", "Too much soreness", "Weights feel too hard", "Too many exercises", "Overall fatigue"],
    },
  ],
  too_easy: [
    {
      id: "easy_driver",
      question: "What feels too easy?",
      options: ["Weights", "Session length", "Exercise count", "Overall effort"],
    },
  ],
  too_many_days: [
    {
      id: "target_days",
      question: "How many sessions would feel realistic for the rest of this week?",
      options: ["1", "2", "3"],
    },
  ],
  too_few_days: [
    {
      id: "additional_days",
      question: "How many additional training days would you realistically like?",
      options: ["+1", "+2"],
    },
  ],
  sessions_too_long: [
    {
      id: "length_issue",
      question: "What's the main issue?",
      options: ["Too many exercises", "Too much rest", "Too many sets"],
    },
  ],
  schedule_changed: [
    {
      id: "available_days",
      question: "Which days can you train for the rest of this week?",
      options: ["Thursday", "Friday", "Saturday", "Sunday"],
    },
  ],
  poor_recovery: [
    {
      id: "recovery_driver",
      question: "What's affecting you most?",
      options: ["Sleep", "Soreness", "Energy", "Stress", "Overall fatigue"],
    },
  ],
  pain: [
    {
      id: "pain_current",
      question: "Is the discomfort still present today?",
      options: ["Yes", "No"],
    },
    {
      id: "pain_location",
      question: "Where is it?",
      options: ["Shoulder", "Elbow", "Back", "Hip", "Knee", "Other"],
    },
  ],
  exercise_preference: [
    {
      id: "disliked_exercise",
      question: "Which exercise?",
      options: [], // populated dynamically from the current week's exercises
    },
  ],
  equipment_problem: [
    {
      id: "equipment_issue",
      question: "What's the problem?",
      options: ["Equipment unavailable", "Equipment feels unsafe", "Other"],
    },
  ],
  other: [],
};

export const ALL_FEEDBACK_REASONS: WeekFeedbackReason[] = FEEDBACK_REASONS.map((option) => option.key);

export function isFeedbackReason(value: unknown): value is WeekFeedbackReason {
  return typeof value === "string" && (ALL_FEEDBACK_REASONS as string[]).includes(value);
}

export async function storeWeekFeedback(
  userId: number,
  workoutPlanId: number,
  input: WeekFeedbackInput,
): Promise<number> {
  const [row] = await db
    .insert(weekFeedback)
    .values({
      userId,
      workoutPlanId,
      primaryReason: input.primaryReason,
      secondaryReasons: input.secondaryReasons.length ? input.secondaryReasons : null,
      structuredDetails: input.structuredDetails,
      freeText: input.freeText,
    })
    .returning();
  return row.id;
}

export async function loadWeekFeedbackInput(
  feedbackId: number,
): Promise<WeekFeedbackInput | null> {
  const row = (
    await db
      .select()
      .from(weekFeedback)
      .where(eq(weekFeedback.id, feedbackId))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    primaryReason: row.primaryReason as WeekFeedbackReason,
    secondaryReasons: (row.secondaryReasons as WeekFeedbackReason[] | null) ?? [],
    structuredDetails: (row.structuredDetails as Record<string, unknown> | null) ?? null,
    freeText: row.freeText,
  };
}

export interface WeekFeedbackSummary {
  total: number;
  recent: { reason: WeekFeedbackReason; count: number }[];
  note: string;
}

/**
 * A compact, user-scoped summary of recent planning feedback. One old complaint
 * must not permanently dominate programming, so only the last several weeks
 * count and the summary is deliberately short.
 */
export async function getRecentWeekFeedbackSummary(
  userId: number,
  limit = 6,
): Promise<WeekFeedbackSummary> {
  const rows = await db
    .select({
      primaryReason: weekFeedback.primaryReason,
    })
    .from(weekFeedback)
    .where(eq(weekFeedback.userId, userId))
    .orderBy(desc(weekFeedback.createdAt))
    .limit(limit);

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.primaryReason, (counts.get(row.primaryReason) ?? 0) + 1);
  }
  const recent = [...counts.entries()]
    .map(([reason, count]) => ({ reason: reason as WeekFeedbackReason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    recent,
    note:
      recent.length === 0
        ? "No recent week-feedback recorded."
        : recent
            .map((entry) => `${entry.reason} (${entry.count}x)`)
            .join(", "),
  };
}
