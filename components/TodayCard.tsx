"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { routes } from "@/lib/routes";

interface TodayCardProps {
  title: string;
  exerciseCount: number;
  durationMinutes: number;
  weekId?: number;
  planDayId: number;
  state: "start" | "resume" | "done";
  sessionId: number | null;
}

export function TodayCard({
  title,
  exerciseCount,
  durationMinutes,
  weekId,
  planDayId,
  state,
  sessionId,
}: TodayCardProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  function start() {
    setStarting(true);
    router.push(routes.recovery(planDayId));
  }

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
        Today
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-tight">{title}</h1>
      <p className="mt-2 text-lg text-zinc-400">
        {exerciseCount} exercises · ~{durationMinutes} minutes
      </p>

      <div className="mt-6">
        {state === "done" && sessionId != null && (
          <div className="space-y-3">
            <p className="text-lg font-semibold text-emerald-400">Done</p>
            <Link
              href={routes.historySession(sessionId)}
              className="block w-full rounded-2xl bg-zinc-800 py-4 text-center text-lg font-semibold text-zinc-100"
            >
              View workout
            </Link>
          </div>
        )}

        {state === "resume" && sessionId != null && (
          <Link
            href={weekId != null ? routes.session(weekId, planDayId, sessionId) : `/workout/${sessionId}`}
            className="block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
          >
            RESUME WORKOUT
          </Link>
        )}

        {state === "start" && (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
          >
            {starting ? "Starting…" : "START WORKOUT"}
          </button>
        )}
      </div>
    </div>
  );
}
