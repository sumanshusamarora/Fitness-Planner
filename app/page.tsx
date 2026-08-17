import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { TodayCard } from "@/components/TodayCard";
import { db } from "@/db";
import { workoutSessions } from "@/db/schema";
import { todayDayNumber } from "@/lib/dates";
import {
  estimateDurationMinutes,
  getActivePlan,
  getPlanDay,
  getPlanExercises,
} from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const plan = await getActivePlan();

  if (!plan) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold">No active plan</h1>
        <p className="mt-2 text-zinc-400">
          Seed the database to load your Week 1 plan.
        </p>
      </div>
    );
  }

  const day = await getPlanDay(plan.id, todayDayNumber());

  if (!day) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold">Nothing scheduled today</h1>
        <p className="mt-2 text-zinc-400">Take the day to recover.</p>
      </div>
    );
  }

  const planExercises = await getPlanExercises(day.id);

  if (planExercises.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
          Today
        </p>
        <h1 className="mt-3 text-4xl font-bold">{day.title}</h1>
        <p className="mt-3 text-lg text-zinc-400">
          No resistance training scheduled. Focus on rest and recovery.
        </p>
      </div>
    );
  }

  const recent = (
    await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.workoutPlanDayId, day.id))
      .orderBy(desc(workoutSessions.startedAt))
      .limit(1)
  )[0];

  let state: "start" | "resume" | "done" = "start";
  let sessionId: number | null = null;

  if (recent) {
    const start = new Date(recent.startedAt);
    const now = new Date();
    const sameDay =
      start.getFullYear() === now.getFullYear() &&
      start.getMonth() === now.getMonth() &&
      start.getDate() === now.getDate();
    if (sameDay) {
      sessionId = recent.id;
      state = recent.completedAt != null ? "done" : "resume";
    }
  }

  return (
    <div className="space-y-4">
      <TodayCard
        title={day.title}
        exerciseCount={planExercises.length}
        durationMinutes={estimateDurationMinutes(planExercises)}
        planDayId={day.id}
        state={state}
        sessionId={sessionId}
      />
      <Link
        href="/week"
        className="block rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center text-zinc-400"
      >
        View the week
      </Link>
    </div>
  );
}
