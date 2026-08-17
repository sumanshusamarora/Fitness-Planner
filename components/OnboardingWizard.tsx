"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface OnboardingAnswers {
  primaryGoal: string | null;
  secondaryGoals: string[];
  experienceLevel: string | null;
  yearsSinceTraining: number | null;
  desiredDaysPerWeek: number | null;
  preferredDays: number[];
  sessionMinutes: string | null;
  trainingEnvironment: string | null;
  equipmentNotes: string;
  limitationsNotes: string;
  bodyWeightKg: string;
  dateOfBirth: string;
  heightCm: string;
}

const GOALS = [
  { key: "general_fitness", label: "General fitness" },
  { key: "build_muscle", label: "Build muscle" },
  { key: "get_stronger", label: "Get stronger" },
  { key: "lose_fat", label: "Lose fat / improve fitness" },
  { key: "sport_performance", label: "Sport performance" },
  { key: "other", label: "Other" },
];

const EXPERIENCE = [
  { key: "beginner", label: "New to the gym" },
  { key: "returning", label: "Returning after a long break" },
  { key: "occasional", label: "Train occasionally" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
];

const DAYS = [2, 3, 4, 5, 6];
const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SESSIONS = ["30", "45", "60", "60+"];
const ENVIRONMENTS = [
  { key: "full_gym", label: "Full gym" },
  { key: "home", label: "Home" },
  { key: "limited", label: "Limited equipment" },
];

const STEP_TITLES = [
  "What do you want most?",
  "What's your experience?",
  "How many days can you train?",
  "How long are your sessions?",
  "Where do you train?",
  "Any limitations?",
  "A few details (optional)",
];

export function OnboardingWizard({
  mode,
  initial,
}: {
  mode: "onboard" | "edit";
  initial?: Partial<OnboardingAnswers>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    primaryGoal: initial?.primaryGoal ?? null,
    secondaryGoals: initial?.secondaryGoals ?? [],
    experienceLevel: initial?.experienceLevel ?? null,
    yearsSinceTraining: initial?.yearsSinceTraining ?? null,
    desiredDaysPerWeek: initial?.desiredDaysPerWeek ?? null,
    preferredDays: initial?.preferredDays ?? [],
    sessionMinutes: initial?.sessionMinutes ?? null,
    trainingEnvironment: initial?.trainingEnvironment ?? null,
    equipmentNotes: initial?.equipmentNotes ?? "",
    limitationsNotes: initial?.limitationsNotes ?? "",
    bodyWeightKg: initial?.bodyWeightKg ?? "",
    dateOfBirth: initial?.dateOfBirth ?? "",
    heightCm: initial?.heightCm ?? "",
  });

  const totalSteps = 7;

  function set<K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function canProceed(): boolean {
    switch (step) {
      case 0:
        return answers.primaryGoal != null;
      case 1:
        return answers.experienceLevel != null;
      case 2:
        return answers.desiredDaysPerWeek != null;
      case 3:
        return answers.sessionMinutes != null;
      case 4:
        return answers.trainingEnvironment != null;
      default:
        return true;
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/training-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryGoal: answers.primaryGoal,
        secondaryGoals: answers.secondaryGoals,
        experienceLevel: answers.experienceLevel,
        yearsSinceTraining: answers.yearsSinceTraining,
        desiredDaysPerWeek: answers.desiredDaysPerWeek,
        preferredDays: answers.preferredDays,
        sessionMinutes: answers.sessionMinutes,
        trainingEnvironment: answers.trainingEnvironment,
        equipmentNotes: answers.equipmentNotes || null,
        limitationsNotes: answers.limitationsNotes || null,
        bodyWeightKg: answers.bodyWeightKg ? Number(answers.bodyWeightKg) : null,
        dateOfBirth: answers.dateOfBirth || null,
        heightCm: answers.heightCm ? Number(answers.heightCm) : null,
      }),
    });
    if (!res.ok) {
      setError("Could not save. Try again.");
      setBusy(false);
      return;
    }

    if (mode === "edit") {
      router.push("/tools");
      router.refresh();
      return;
    }

    const propRes = await fetch("/api/plans/initial-proposal", { method: "POST" });
    if (!propRes.ok) {
      setError("Could not build your week. Try again.");
      setBusy(false);
      return;
    }
    router.push("/onboarding/review");
  }

  function next() {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  }

  return (
    <div className="flex min-h-[80vh] flex-col">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Step {step + 1} of {totalSteps}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1">
        <h1 className="mb-5 text-3xl font-bold">{STEP_TITLES[step]}</h1>

        {step === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">Pick one or more — the first is your main goal.</p>
            {GOALS.map((g) => {
              const isPrimary = answers.primaryGoal === g.key;
              const isSecondary = answers.secondaryGoals.includes(g.key);
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => {
                    if (isPrimary) {
                      setAnswers((a) => ({
                        ...a,
                        primaryGoal: a.secondaryGoals[0] ?? null,
                        secondaryGoals: a.secondaryGoals.slice(1),
                      }));
                    } else if (answers.primaryGoal == null) {
                      set("primaryGoal", g.key);
                    } else if (isSecondary) {
                      set("secondaryGoals", answers.secondaryGoals.filter((s) => s !== g.key));
                    } else {
                      set("secondaryGoals", [...answers.secondaryGoals, g.key]);
                    }
                  }}
                  className={`w-full rounded-2xl px-4 py-4 text-left text-lg font-semibold transition active:scale-[0.99] ${
                    isPrimary
                      ? "bg-emerald-500 text-zinc-950"
                      : isSecondary
                        ? "bg-emerald-500/30 text-emerald-100"
                        : "bg-zinc-800 text-zinc-100"
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            {EXPERIENCE.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => set("experienceLevel", e.key)}
                className={`w-full rounded-2xl px-4 py-4 text-left text-lg font-semibold transition active:scale-[0.99] ${
                  answers.experienceLevel === e.key
                    ? "bg-emerald-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100"
                }`}
              >
                {e.label}
              </button>
            ))}
            {answers.experienceLevel === "returning" && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm text-zinc-400">About how long since consistent training?</p>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={answers.yearsSinceTraining ?? ""}
                  onChange={(e) =>
                    set("yearsSinceTraining", e.target.value ? Number(e.target.value) : null)
                  }
                  placeholder="years"
                  className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-lg text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm text-zinc-400">Days per week</p>
              <div className="grid grid-cols-5 gap-2">
                {DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set("desiredDaysPerWeek", d)}
                    className={`h-16 rounded-2xl text-2xl font-bold transition active:scale-95 ${
                      answers.desiredDaysPerWeek === d
                        ? "bg-emerald-500 text-zinc-950"
                        : "bg-zinc-800 text-zinc-100"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm text-zinc-400">Which days normally work? (optional)</p>
              <div className="grid grid-cols-7 gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const on = answers.preferredDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        set(
                          "preferredDays",
                          on
                            ? answers.preferredDays.filter((x) => x !== d)
                            : [...answers.preferredDays, d],
                        )
                      }
                      className={`rounded-xl py-3 text-sm font-semibold transition active:scale-95 ${
                        on ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {DAY_LABELS[d]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-2 gap-3">
            {SESSIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set("sessionMinutes", s)}
                className={`h-20 rounded-2xl text-xl font-bold transition active:scale-95 ${
                  answers.sessionMinutes === s
                    ? "bg-emerald-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100"
                }`}
              >
                ~{s} min
              </button>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-2">
            {ENVIRONMENTS.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => set("trainingEnvironment", e.key)}
                className={`w-full rounded-2xl px-4 py-4 text-left text-lg font-semibold transition active:scale-[0.99] ${
                  answers.trainingEnvironment === e.key
                    ? "bg-emerald-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100"
                }`}
              >
                {e.label}
              </button>
            ))}
            <textarea
              value={answers.equipmentNotes}
              onChange={(e) => set("equipmentNotes", e.target.value)}
              placeholder="Optional: equipment notes (e.g. no squat rack, only dumbbells)"
              rows={2}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Any pain, injuries, health considerations or movements to avoid?
            </p>
            <button
              type="button"
              onClick={() => set("limitationsNotes", "")}
              className={`w-full rounded-2xl px-4 py-4 text-left text-lg font-semibold ${
                answers.limitationsNotes === "" ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"
              }`}
            >
              None
            </button>
            <textarea
              value={answers.limitationsNotes}
              onChange={(e) => set("limitationsNotes", e.target.value)}
              placeholder="Describe anything to be careful with (we won't diagnose)"
              rows={3}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <Field
              label="Date of birth"
              type="date"
              value={answers.dateOfBirth}
              onChange={(v) => set("dateOfBirth", v)}
            />
            <Field
              label="Height (cm)"
              type="number"
              value={answers.heightCm}
              onChange={(v) => set("heightCm", v)}
            />
            <Field
              label="Body weight (kg)"
              type="number"
              value={answers.bodyWeightKg}
              onChange={(v) => set("bodyWeightKg", v)}
            />
            <p className="text-sm text-zinc-500">All optional — you can add these later.</p>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={busy}
            className="flex-1 rounded-2xl bg-zinc-800 py-4 text-lg font-bold text-zinc-100 disabled:opacity-60"
          >
            BACK
          </button>
        )}
        <button
          type="button"
          onClick={next}
          disabled={!canProceed() || busy}
          className="flex-1 rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Saving…" : step === totalSteps - 1 ? "FINISH" : "NEXT"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-zinc-400">{label}</span>
      <input
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-lg text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
    </label>
  );
}
