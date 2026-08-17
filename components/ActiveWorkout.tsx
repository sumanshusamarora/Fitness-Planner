"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatWeight } from "@/lib/dates";
import { smallestIncrement } from "@/lib/progression";
import { Stepper } from "@/components/Stepper";
import { ExerciseMedia, type ExerciseMediaData } from "@/components/ExerciseMedia";

interface LoggedSet {
  setNumber: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
}

interface Exercise {
  sessionExerciseId: number;
  exerciseId: number;
  name: string;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  restSeconds: number;
  suggestedWeightKg: number | null;
  lastTime: { weightKg: number | null; reps: string; rpe: number | null } | null;
  recommendationReason: string | null;
  media: ExerciseMediaData | null;
  loggedSets: LoggedSet[];
  completed: boolean;
}

export interface ActiveWorkoutData {
  sessionId: number;
  title: string;
  completed: boolean;
  exercises: Exercise[];
}

type Phase = "setup" | "rpe" | "rest" | "done" | "finish";

const RPE_OPTIONS = [5, 6, 7, 8, 9, 10];

export function ActiveWorkout({ data }: { data: ActiveWorkoutData }) {
  const router = useRouter();
  const { sessionId, title, exercises: initialExercises } = data;

  const [exercises, setExercises] = useState(initialExercises);
  const [index, setIndex] = useState(() => {
    const idx = initialExercises.findIndex((e) => !e.completed);
    return idx === -1 ? Math.max(0, initialExercises.length - 1) : idx;
  });
  const [phase, setPhase] = useState<Phase>(() =>
    initialExercises.length > 0 && initialExercises.every((e) => e.completed)
      ? "finish"
      : "setup",
  );
  const [weight, setWeight] = useState(() => {
    const ex = initialExercises[0];
    return ex ? (ex.suggestedWeightKg ?? ex.lastTime?.weightKg ?? 0) : 0;
  });
  const [reps, setReps] = useState(() => initialExercises[0]?.maxReps ?? 0);
  const [restLeft, setRestLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exercisesRef = useRef(exercises);
  const indexRef = useRef(index);
  useEffect(() => {
    exercisesRef.current = exercises;
    indexRef.current = index;
  }, [exercises, index]);

  useEffect(() => {
    const ex = exercises[index];
    if (ex) {
      setWeight(ex.suggestedWeightKg ?? ex.lastTime?.weightKg ?? 0);
      setReps(ex.maxReps);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (phase !== "rest") return;
    if (restLeft <= 0) {
      const ex = exercisesRef.current[indexRef.current];
      setPhase(ex.loggedSets.length < ex.targetSets ? "setup" : "done");
      return;
    }
    const t = setTimeout(() => setRestLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, restLeft]);

  if (initialExercises.length === 0) {
    return (
      <p className="text-lg text-zinc-400">No exercises in this workout.</p>
    );
  }

  const ex = exercises[index];
  const setNumber = ex.loggedSets.length + 1;
  const weightStep = smallestIncrement(weight) || 2.5;

  async function saveSet(rpe: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exerciseId: ex.exerciseId,
          weightKg: weight,
          reps,
          rpe,
        }),
      });
      if (!res.ok) throw new Error("save failed");

      const isLastSet = ex.loggedSets.length + 1 >= ex.targetSets;
      const newSet: LoggedSet = {
        setNumber: ex.loggedSets.length + 1,
        weightKg: weight,
        reps,
        rpe,
      };
      setExercises((prev) =>
        prev.map((e, i) =>
          i === index
            ? {
                ...e,
                loggedSets: [...e.loggedSets, newSet],
                completed: isLastSet,
              }
            : e,
        ),
      );

      if (isLastSet) {
        await fetch(
          `/api/sessions/${sessionId}/exercises/${ex.exerciseId}/complete`,
          { method: "POST" },
        );
      }

      setRestLeft(ex.restSeconds);
      setPhase("rest");
    } catch {
      setError("Could not save this set. Try again.");
      setPhase("setup");
    } finally {
      setSaving(false);
    }
  }

  function nextExercise() {
    if (index + 1 >= exercises.length) {
      router.push(`/workout/${sessionId}/complete`);
      return;
    }
    setIndex(index + 1);
    setPhase("setup");
  }

  const progress = Math.round(((index + 1) / exercises.length) * 100);

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{title}</h1>
          <span className="text-sm text-zinc-400">
            {index + 1} / {exercises.length}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {phase === "setup" && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
              Exercise {index + 1}
            </p>
            <h2 className="mt-2 text-3xl font-bold">{ex.name}</h2>

            <div className="mt-4">
              <ExerciseMedia media={ex.media} />
            </div>

            {ex.lastTime && (
              <div className="mt-4 rounded-2xl bg-zinc-800/60 p-4">
                <p className="text-xs uppercase tracking-widest text-zinc-400">
                  Last time
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatWeight(ex.lastTime.weightKg)} kg · {ex.lastTime.reps}{" "}
                  reps
                  {ex.lastTime.rpe != null && ` · RPE ${ex.lastTime.rpe}`}
                </p>
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs uppercase tracking-widest text-zinc-400">
                Today
              </p>
              <p className="mt-1 text-lg font-semibold">
                {formatWeight(ex.suggestedWeightKg)} kg · {ex.targetSets} set
                {ex.targetSets > 1 ? "s" : ""} × {ex.minReps}–{ex.maxReps} reps ·
                RPE {ex.targetRpe}
              </p>
              {ex.recommendationReason && (
                <p className="mt-1 text-sm text-zinc-500">
                  {ex.recommendationReason}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="mb-4 text-center text-sm font-semibold uppercase tracking-[0.3em] text-zinc-400">
              Set {setNumber} of {ex.targetSets}
            </p>
            <div className="space-y-4">
              <Stepper
                label="Weight"
                value={weight}
                step={weightStep}
                unit="kg"
                format={formatWeight}
                onChange={setWeight}
              />
              <Stepper
                label="Reps"
                value={reps}
                step={1}
                unit="reps"
                onChange={setReps}
              />
            </div>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={() => setPhase("rpe")}
              disabled={saving || weight <= 0 || reps <= 0}
              className="mt-6 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
            >
              COMPLETE SET
            </button>
          </div>
        </div>
      )}

      {phase === "rpe" && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
            {ex.name}
          </p>
          <h2 className="mt-2 text-3xl font-bold">How hard was that set?</h2>
          <p className="mt-1 text-zinc-400">
            {formatWeight(weight)} kg × {reps} reps
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {RPE_OPTIONS.map((rpe) => (
              <button
                key={rpe}
                type="button"
                onClick={() => saveSet(rpe)}
                disabled={saving}
                className="h-20 rounded-2xl border border-zinc-700 bg-zinc-800 text-3xl font-bold transition active:scale-95 disabled:opacity-60"
              >
                {rpe}
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm text-zinc-500">6 = light · 8 = hard</p>
        </div>
      )}

      {phase === "rest" && (
        <div className="flex flex-col items-center rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
            Rest
          </p>
          <p className="mt-4 text-7xl font-bold tabular-nums">
            {Math.ceil(restLeft)}
          </p>
          <p className="mt-2 text-zinc-400">seconds</p>
          <button
            type="button"
            onClick={() => setRestLeft(0)}
            className="mt-8 w-full rounded-2xl bg-zinc-800 py-4 text-lg font-semibold text-zinc-100 active:scale-[0.98]"
          >
            Skip rest
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-col items-center rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl font-bold text-zinc-950">
            ✓
          </div>
          <h2 className="mt-6 text-3xl font-bold">Exercise complete</h2>
          <p className="mt-1 text-zinc-400">{ex.name}</p>
          <button
            type="button"
            onClick={nextExercise}
            className="mt-8 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 active:scale-[0.98]"
          >
            {index + 1 >= exercises.length
              ? "FINISH WORKOUT →"
              : "NEXT EXERCISE →"}
          </button>
        </div>
      )}

      {phase === "finish" && (
        <div className="flex flex-col items-center rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl font-bold text-zinc-950">
            ✓
          </div>
          <h2 className="mt-6 text-3xl font-bold">All exercises logged</h2>
          <button
            type="button"
            onClick={() => router.push(`/workout/${sessionId}/complete`)}
            className="mt-8 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 active:scale-[0.98]"
          >
            FINISH WORKOUT →
          </button>
        </div>
      )}
    </div>
  );
}
