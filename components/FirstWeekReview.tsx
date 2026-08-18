"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StoredWeeklyPlanProposal } from "@/lib/coach/service";
import { Loader } from "./Loader";

export function FirstWeekReview({ stored }: { stored: StoredWeeklyPlanProposal }) {
  const router = useRouter();
  const proposal = stored.proposal;
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  const workoutDays = proposal.days.filter((d) => d.exercises.length > 0);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/plans/proposals/${stored.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "approve" }),
    });
    const data = await res.json();
    if (data.planId) {
      router.push("/");
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not apply.");
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          Week 1
        </p>
        <h1 className="mt-1 text-3xl font-bold">Your first week</h1>
        <p className="mt-2 text-zinc-400">
          {proposal.summary.plannedSessions} resistance days · {workoutDays.length} sessions
        </p>
      </div>

      <div className="space-y-2">
        {proposal.days.map((day) => {
          const isWorkout = day.exercises.length > 0;
          return (
            <div key={day.dayNumber}>
              <button
                type="button"
                disabled={!isWorkout}
                onClick={() => setOpenDay(openDay === day.dayNumber ? null : day.dayNumber)}
                className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left ${
                  isWorkout ? "border-zinc-800 bg-zinc-900" : "border-zinc-800/50 bg-zinc-900/50"
                }`}
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                    {day.dayName}
                  </p>
                  <p className={`mt-1 text-lg font-semibold ${isWorkout ? "text-zinc-100" : "text-zinc-500"}`}>
                    {isWorkout ? day.title : "Rest"}
                  </p>
                </div>
                {isWorkout && (
                  <span className="text-sm text-zinc-400">{day.exercises.length} exercises</span>
                )}
              </button>

              {isWorkout && openDay === day.dayNumber && (
                <div className="space-y-1 border-x border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
                  {day.exercises.map((ex) => (
                    <div key={ex.sourcePlanExerciseId} className="flex items-center justify-between py-1">
                      <span className="font-semibold text-zinc-200">{ex.exerciseName}</span>
                      <span className="text-sm text-zinc-400">
                        {ex.proposed.sets} × {ex.proposed.minReps}–{ex.proposed.maxReps} · RPE {ex.proposed.targetRpe}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowWhy((s) => !s)}
        className="w-full rounded-2xl py-3 text-sm font-semibold text-zinc-400"
      >
        {showWhy ? "Hide" : "Why this plan?"}
      </button>
      {showWhy && (
        <p className="rounded-2xl bg-zinc-900 p-4 text-sm text-zinc-400">
          {proposal.summary.overallRecommendation}
        </p>
      )}

      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? <Loader compact /> : "ACCEPT WEEK 1"}
      </button>
      <button
        type="button"
        onClick={() => router.push("/onboarding")}
        disabled={busy}
        className="w-full rounded-2xl py-3 text-base font-semibold text-zinc-400"
      >
        CHANGE
      </button>
    </div>
  );
}
