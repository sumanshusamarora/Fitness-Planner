"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ActivitySummary {
  warmupMinutes: number;
  cardioMinutes: number;
  mobilityMinutes: number;
  cooldownMinutes: number;
  addedExercises: number;
  replacedExercises: number;
  extraWorkingSets: number;
  workingResistanceSets: number;
}

interface FinishWorkoutProps {
  sessionId: number;
  title: string;
  status: string;
  completedExerciseCount: number;
  skippedExerciseCount: number;
  notPerformedCount: number;
  setCount: number;
  durationText: string;
  activities?: ActivitySummary | null;
}

const ENERGY = ["Very Low", "Low", "Good", "Great"];
const EFFORT: { label: string; rpe: number }[] = [
  { label: "Easy", rpe: 6 },
  { label: "Moderate", rpe: 7 },
  { label: "Hard", rpe: 8 },
];

export function FinishWorkout(props: FinishWorkoutProps) {
  const router = useRouter();
  const [step, setStep] = useState<"energy" | "effort">("energy");
  const [energy, setEnergy] = useState<string | null>(null);
  const [effort, setEffort] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const isEndedEarly = props.status === "ended_early";
  const needsFinish = props.status === "in_progress";

  async function finish() {
    setSaving(true);
    await fetch(`/api/sessions/${props.sessionId}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ energyRating: energy, overallRpe: effort }),
    });
    router.push("/");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          {isEndedEarly ? "Workout ended early" : "Workout complete"}
        </p>
        <h1 className="mt-3 text-3xl font-bold">{props.title}</h1>
        <div className="mt-4 space-y-2 text-lg">
          <p className="text-emerald-400">✓ {props.completedExerciseCount} exercises completed</p>
          {props.skippedExerciseCount > 0 && (
            <p className="text-amber-300">– {props.skippedExerciseCount} skipped</p>
          )}
          {props.notPerformedCount > 0 && (
            <p className="text-zinc-500">{props.notPerformedCount} not performed</p>
          )}
          <p className="text-zinc-400">✓ {props.setCount} sets · {props.durationText}</p>
        </div>
        {props.activities && (
          <div className="mt-4 space-y-1 text-sm text-zinc-400">
            {props.activities.warmupMinutes > 0 && <p>Warm-up · {props.activities.warmupMinutes} min</p>}
            {props.activities.cardioMinutes > 0 && <p>Cardio · {props.activities.cardioMinutes} min</p>}
            {props.activities.mobilityMinutes > 0 && <p>Mobility / stretching · {props.activities.mobilityMinutes} min</p>}
            {props.activities.cooldownMinutes > 0 && <p>Cool-down · {props.activities.cooldownMinutes} min</p>}
            {props.activities.addedExercises > 0 && <p className="text-sky-400">+{props.activities.addedExercises} added exercise{props.activities.addedExercises > 1 ? "s" : ""}</p>}
            {props.activities.replacedExercises > 0 && <p className="text-violet-400">{props.activities.replacedExercises} replaced</p>}
            <p className="text-zinc-500">{props.activities.workingResistanceSets} working sets</p>
          </div>
        )}
      </div>

      {needsFinish && step === "energy" && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-2xl font-bold">How was your energy?</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {ENERGY.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setEnergy(label);
                  setStep("effort");
                }}
                className="h-16 rounded-2xl border border-zinc-700 bg-zinc-800 text-lg font-semibold transition active:scale-95"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {needsFinish && step === "effort" && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-2xl font-bold">Overall effort?</h2>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {EFFORT.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setEffort(item.rpe)}
                className={`h-16 rounded-2xl border text-lg font-semibold transition active:scale-95 ${
                  effort === item.rpe
                    ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                    : "border-zinc-700 bg-zinc-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={finish}
            disabled={effort == null || saving}
            className="mt-6 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? "Saving…" : "FINISH"}
          </button>
        </div>
      )}

      {!needsFinish && (
        <button
          type="button"
          onClick={() => router.push("/")}
          className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
        >
          DONE
        </button>
      )}
    </div>
  );
}
