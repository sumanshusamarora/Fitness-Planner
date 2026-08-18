"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { routes } from "@/lib/routes";
import { WeekStrip } from "@/components/WeekStrip";
import type { WeekDayView, WeekView } from "@/lib/week-view";

export function HomeScreen({
  user,
  week,
}: {
  user: { name: string; username: string | null };
  week: WeekView | null;
}) {
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const displayName = user.name || user.username || "there";

  async function buildFirstWeek() {
    setBuilding(true);
    router.push("/onboarding");
  }

  if (!week) {
    return (
      <div className="flex flex-col justify-center py-10">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            Welcome, {displayName}
          </p>
          <h1 className="mt-3 text-3xl font-bold">No workout plan yet</h1>
          <p className="mt-2 text-zinc-400">Answer a few quick questions to build your first week.</p>
          <button
            type="button"
            onClick={buildFirstWeek}
            disabled={building}
            className="mt-6 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
          >
            {building ? "Starting…" : "BUILD MY FIRST WEEK"}
          </button>
        </div>
      </div>
    );
  }

  const today = week.days.find((d) => d.isToday) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-zinc-400">Hello, {displayName}</p>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-3xl font-bold">Week {week.weekNumber}</h1>
          <p className="text-sm text-zinc-400">
            Adherence: {week.completedPrescribedCount} of {week.prescribedWorkoutCount} prescribed sessions
            {week.extraWorkoutCount > 0 && ` · Extra sessions: ${week.extraWorkoutCount}`}
            {week.endedEarlyCount > 0 && ` · ${week.endedEarlyCount} ended early`}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-2 py-3">
        <WeekStrip days={week.days} onSelect={() => router.push(routes.week(week.planId))} />
      </div>

      <TodayHero today={today} weekId={week.planId} router={router} />
    </div>
  );
}

function TodayHero({
  today,
  weekId,
  router,
}: {
  today: WeekDayView | null;
  weekId: number;
  router: ReturnType<typeof useRouter>;
}) {
  if (!today) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">Today</p>
        <h2 className="mt-3 text-3xl font-bold">Nothing scheduled</h2>
        <p className="mt-2 text-zinc-400">This week&apos;s plan is outside today.</p>
        <Link href={routes.week(weekId)} className="mt-5 block rounded-2xl bg-zinc-800 py-4 text-center text-lg font-semibold text-zinc-100">
          VIEW WEEK
        </Link>
      </div>
    );
  }

  if (today.exerciseCount === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Recovery day</p>
        <h2 className="mt-3 text-3xl font-bold">Rest today</h2>
        <p className="mt-2 text-zinc-400">No workout scheduled.</p>
        <button
          type="button"
          onClick={() => router.push(routes.day(weekId, today.planDayId))}
          className="mt-5 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
        >
          TRAIN TODAY
        </button>
        <button
          type="button"
          onClick={() => router.push(routes.week(weekId))}
          className="mt-3 w-full rounded-2xl py-3 text-base font-semibold text-zinc-400"
        >
          Move another workout here
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Today</p>
      <h2 className="mt-3 text-4xl font-bold leading-tight">{today.title}</h2>
      <p className="mt-2 text-lg text-zinc-400">
        {today.exerciseCount} exercises · ~{today.durationMinutes} minutes
      </p>

      <div className="mt-6 space-y-3">
        {today.status === "completed" && today.sessionId != null && (
          <>
            <p className="text-lg font-semibold text-emerald-400">Done</p>
            <Link
              href={routes.historySession(today.sessionId)}
              className="block w-full rounded-2xl bg-zinc-800 py-4 text-center text-lg font-semibold text-zinc-100"
            >
              VIEW WORKOUT
            </Link>
          </>
        )}

        {(today.status === "ended_early" || today.status === "skipped") && today.sessionId != null && (
          <>
            <p className={`text-lg font-semibold ${today.status === "ended_early" ? "text-amber-400" : "text-zinc-400"}`}>
              {today.status === "ended_early" ? "Ended early" : "Skipped"}
            </p>
            <Link
              href={routes.historySession(today.sessionId)}
              className="block w-full rounded-2xl bg-zinc-800 py-4 text-center text-lg font-semibold text-zinc-100"
            >
              VIEW OUTCOME
            </Link>
            <button
              type="button"
              onClick={() => router.push(routes.recovery(today.planDayId))}
              className="w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
            >
              START ANOTHER WORKOUT
            </button>
          </>
        )}

        {today.status === "in-progress" && today.sessionId != null && (
          <>
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-300">
              Workout in progress
            </p>
            <p className="text-zinc-400">
              {today.progressExercises} of {today.exerciseCount} exercises done
            </p>
            <Link
              href={routes.session(weekId, today.planDayId, today.sessionId)}
              className="block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
            >
              RESUME WORKOUT
            </Link>
          </>
        )}

        {(today.status === "scheduled" || today.status === "missed") && (
          <>
            <button
              type="button"
              onClick={() => router.push(routes.recovery(today.planDayId))}
              className="w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
            >
              START WORKOUT
            </button>
            <button
              type="button"
              onClick={() => router.push(routes.day(weekId, today.planDayId))}
              className="w-full rounded-2xl py-3 text-base font-semibold text-zinc-400"
            >
              Can&apos;t train today?
            </button>
          </>
        )}
      </div>
    </div>
  );
}
