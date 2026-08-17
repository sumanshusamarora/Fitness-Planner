"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatWeight } from "@/lib/dates";
import type { StoredWeeklyPlanProposal } from "@/lib/coach/service";

function labelFor(action: string) {
  if (action === "increase_load") return "↑ Increase";
  if (action === "decrease_load") return "↓ Reduce";
  if (action === "increase_reps") return "→ Build reps";
  if (action === "needs_input") return "Needs input";
  return "→ Keep";
}

export function WeekReview({ storedProposal }: { storedProposal: StoredWeeklyPlanProposal }) {
  const router = useRouter();
  const proposal = storedProposal.proposal;
  const [decisions, setDecisions] = useState<Record<string, "accept" | "keep">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => proposal.days, [proposal.days]);
  const changes = new Map(proposal.changes.map((change) => [change.sourcePlanExerciseId, change]));
  const needsInput = proposal.questions.length > 0 || proposal.confidence === "needs-input";

  async function acceptWeek() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/plans/proposals/${storedProposal.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "approve", decisions }),
    });
    const data = await res.json();
    if (data.planId) {
      router.push("/week");
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not apply this proposal.");
    setBusy(false);
  }

  async function answerQuestion(questionId: string, answer: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/plans/proposals/${storedProposal.id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, answer }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not save answer.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-emerald-400">WEEK {proposal.proposedWeekNumber} PROPOSAL</p>
        <h1 className="mt-1 text-3xl font-bold">Ready to review</h1>
        <p className="mt-2 text-zinc-400">{proposal.summary.completedSessions} / {proposal.summary.plannedSessions} workouts completed · {proposal.summary.recoverySummary}</p>
      </div>

      {proposal.questions.map((question) => (
        <section key={question.id} className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="font-semibold text-amber-200">I need your input</p>
          <p className="mt-1 text-sm text-amber-100">{question.prompt}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {question.options.map((option) => <button type="button" disabled={busy} onClick={() => answerQuestion(question.id, option)} key={option} className="rounded-full bg-zinc-950/60 px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50">{option}</button>)}
          </div>
          <p className="mt-3 text-xs text-amber-200/80">Choose one answer to continue reviewing Week {proposal.proposedWeekNumber}.</p>
        </section>
      ))}

      {groups.map((day) => (
        <section key={day.sourcePlanDayId} className="space-y-3">
          <h2 className="pt-1 text-sm font-semibold uppercase tracking-widest text-zinc-500">{day.title}</h2>
          {day.exercises.map((exercise) => {
            const change = changes.get(exercise.sourcePlanExerciseId)!;
            const changed = change.previous.weightKg !== change.proposed.weightKg;
            const decision = decisions[String(change.sourcePlanExerciseId)] ?? "accept";
            return <div key={exercise.sourcePlanExerciseId} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{change.exerciseName}</p>
                  <p className="mt-1 text-sm text-zinc-400">{labelFor(change.action)} · {change.confidence}</p>
                </div>
                <p className={change.action === "increase_load" ? "font-bold text-emerald-400" : change.action === "needs_input" ? "font-bold text-amber-300" : "font-bold text-zinc-300"}>
                  {formatWeight(change.previous.weightKg)}{changed && ` → ${formatWeight(change.proposed.weightKg)}`} kg
                </p>
              </div>
              <p className="mt-3 text-sm text-zinc-400">{change.reason}</p>
              <ul className="mt-3 space-y-1 text-sm text-zinc-500">
                {change.evidence.slice(0, 3).map((evidence) => <li key={evidence}>✓ {evidence}</li>)}
              </ul>
              {changed && !needsInput && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setDecisions((current) => ({ ...current, [String(change.sourcePlanExerciseId)]: "accept" }))} className={`rounded-xl py-2.5 font-bold ${decision === "accept" ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-200"}`}>Use change</button>
                  <button type="button" onClick={() => setDecisions((current) => ({ ...current, [String(change.sourcePlanExerciseId)]: "keep" }))} className={`rounded-xl py-2.5 font-bold ${decision === "keep" ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-200"}`}>Keep load</button>
                </div>
              )}
            </div>;
          })}
        </section>
      ))}

      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <button type="button" onClick={acceptWeek} disabled={busy || needsInput} className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Saving…" : needsInput ? "INPUT REQUIRED" : `ACCEPT WEEK ${proposal.proposedWeekNumber}`}
      </button>
    </div>
  );
}
