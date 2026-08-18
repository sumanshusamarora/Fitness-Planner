"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeekView } from "@/lib/week-view";
import { CoachDecisionCard } from "./CoachDecisionCard";
import { Loader } from "./Loader";

export interface RebuildReasonOption {
  key: string;
  label: string;
}

export interface RebuildFollowUp {
  id: string;
  question: string;
  options: string[];
}

interface StoredRebuild {
  id: number;
  status: string;
  coachSource: "llm" | "fallback";
  feedbackId: number | null;
  proposal: {
    overallAction: string;
    confidence: string;
    summary: string;
    rationale: string[];
    safetyFlags: string[];
    questions: { id: string; question: string; options: string[] }[];
    preservedDays: { dayNumber: number; reason: string }[];
    proposedDays: {
      dayNumber: number;
      status: "workout" | "rest";
      sessionEffort: "light" | "normal" | null;
      title: string | null;
      rationale: string[];
      exercises: { exerciseName: string; sets: number; minReps: number; maxReps: number; suggestedWeightKg: number | null }[];
    }[];
    aiMetadata?: { provider?: string; model: string; promptVersion?: string };
  };
  diff: { summary: string[] };
}

function coachLabel(source: "llm" | "fallback", metadata?: { provider?: string; model: string }): string {
  if (source !== "llm" || !metadata?.model) return "Local fallback";
  if (metadata.provider === "deepseek") return "DeepSeek";
  if (metadata.provider === "openai") return "GPT-5";
  return metadata.model;
}

export function WeekRebuildModal({
  planId,
  week,
  reasons,
  followUps,
  onClose,
}: {
  planId: number;
  week: WeekView;
  reasons: RebuildReasonOption[];
  followUps: Record<string, RebuildFollowUp[]>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"reason" | "details" | "review">("reason");
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [freeText, setFreeText] = useState("");
  const [proposal, setProposal] = useState<StoredRebuild | null>(null);
  const [busy, setBusy] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setCoaching(true);
    setError(null);
    const res = await fetch("/api/week-rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        feedback: { primaryReason: reason, secondaryReasons: [], structuredDetails: details, freeText: freeText || null },
      }),
    });
    const data = await res.json();
    setCoaching(false);
    setBusy(false);
    if (data.error) {
      setError(data.error);
      return;
    }
    setProposal(data);
    setStep("review");
  }

  async function answer(questionId: string, answer: string) {
    setBusy(true);
    setCoaching(true);
    setError(null);
    const res = await fetch(`/api/week-rebuild/${proposal!.id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, answer }),
    });
    const data = await res.json();
    setCoaching(false);
    setBusy(false);
    if (data.error) {
      setError(data.error);
      return;
    }
    setProposal(data);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/week-rebuild/${proposal!.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "approve" }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok) {
      onClose();
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not apply.");
  }

  async function reject() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/week-rebuild/${proposal!.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setBusy(false);
    if (data.ok) {
      onClose();
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not reject.");
  }

  function renderDetails() {
    if (!reason) return null;

    if (reason === "schedule_changed") {
      const remaining = week.days.filter((day) => day.dateISO >= todayISO());
      return (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Which days can you train for the rest of this week?</p>
          {remaining.map((day) => {
            const selected = (details.available_days as number[])?.includes(day.dayNumber);
            return (
              <button
                key={day.planDayId}
                type="button"
                onClick={() => {
                  const current = new Set<number>((details.available_days as number[]) ?? []);
                  if (current.has(day.dayNumber)) current.delete(day.dayNumber);
                  else current.add(day.dayNumber);
                  setDetails({ ...details, available_days: [...current].sort((a, b) => a - b) });
                }}
                className={`w-full rounded-2xl px-4 py-3 text-left ${selected ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
              >
                <span className="font-semibold">{day.dayName}</span>
                <span className="ml-2 text-sm opacity-70">{day.dateISO}</span>
              </button>
            );
          })}
        </div>
      );
    }

    if (reason === "exercise_preference") {
      const names = [...new Set(week.days.filter((day) => day.exerciseCount > 0).flatMap((day) => day.exerciseNames))];
      return (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Which exercise don&apos;t you like?</p>
          {names.length === 0 && <p className="text-sm text-zinc-500">No exercises found this week.</p>}
          {names.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setDetails({ ...details, disliked_exercise: name })}
              className={`w-full rounded-2xl px-4 py-3 text-left ${details.disliked_exercise === name ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
            >
              {name}
            </button>
          ))}
        </div>
      );
    }

    if (reason === "too_few_days") {
      const desired = String(details.desired_total_days ?? "4");
      const effort = String(details.added_day_effort ?? "coach_decide");
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">Desired total training days this week:</p>
            {["3", "4", "5", "6"].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDetails({ ...details, desired_total_days: option })}
                className={`w-full rounded-2xl px-4 py-3 text-left ${desired === option ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">How should the added days feel?</p>
            {[
              { key: "coach_decide", label: "COACH DECIDES" },
              { key: "light", label: "LIGHT" },
              { key: "normal", label: "NORMAL" },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setDetails({ ...details, added_day_effort: option.key })}
                className={`w-full rounded-2xl px-4 py-3 text-left ${effort === option.key ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    const follow = followUps[reason] ?? [];
    return (
      <div className="space-y-4">
        {follow.map((question) => (
          <div key={question.id}>
            <p className="mb-2 text-sm text-zinc-400">{question.question}</p>
            <div className="space-y-2">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDetails({ ...details, [question.id]: option })}
                  className={`w-full rounded-2xl px-4 py-3 text-left ${details[question.id] === option ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={() => !busy && onClose()}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-zinc-800 bg-zinc-900 p-5 pb-8" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-2xl font-bold">Adjust / rebuild week</h2>
        {error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        {step === "reason" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">What&apos;s not working?</p>
            {reasons.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setReason(option.key);
                  setStep("details");
                }}
                className="w-full rounded-2xl bg-zinc-800 px-4 py-3 text-left text-zinc-100 transition active:scale-[0.99]"
              >
                {option.label}
              </button>
            ))}
            <button type="button" onClick={onClose} className="mt-3 w-full rounded-2xl py-3 text-base font-semibold text-zinc-500">
              CLOSE
            </button>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4">
            {renderDetails()}
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Anything else? (optional)"
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-sm text-zinc-100"
              rows={2}
            />
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Thinking…" : "REVIEW MY WEEK"}
            </button>
            {coaching && <Loader context="week-rebuild" />}
            <button type="button" onClick={() => setStep("reason")} className="w-full rounded-2xl py-3 text-base font-semibold text-zinc-500">
              BACK
            </button>
          </div>
        )}

        {step === "review" && proposal && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">{proposal.proposal.summary}</p>
            <CoachDecisionCard
              confidence={proposal.proposal.confidence}
              rationale={proposal.proposal.rationale}
              safetyFlags={proposal.proposal.safetyFlags}
              model={proposal.proposal.aiMetadata?.model}
            />
            <div className="rounded-xl bg-zinc-800/70 px-3 py-2 text-xs text-zinc-400">
              Coach: {coachLabel(proposal.coachSource, proposal.proposal.aiMetadata)}
              {proposal.proposal.aiMetadata?.promptVersion ? ` · Prompt ${proposal.proposal.aiMetadata.promptVersion}` : ""}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">Revised week</p>
              <div className="space-y-2">
                {week.days.map((day) => {
                  const preserved = proposal.proposal.preservedDays.find((p) => p.dayNumber === day.dayNumber);
                  const proposed = proposal.proposal.proposedDays.find((p) => p.dayNumber === day.dayNumber);
                  const label = preserved
                    ? `${day.dayName} · completed — unchanged`
                    : proposed && proposed.status === "workout"
                      ? `${day.dayName} · ${proposed.title ?? "Workout"} · ${proposed.exercises.length} exercises`
                      : `${day.dayName} · Rest`;
                  return (
                    <div key={day.planDayId} className="rounded-xl bg-zinc-800 px-3 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span>{label}</span>
                        <div className="flex items-center gap-2">
                          {proposed?.status === "workout" && proposed.sessionEffort && (
                            <span className="rounded-full bg-zinc-700 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
                              {proposed.sessionEffort}
                            </span>
                          )}
                          {preserved && <span className="text-emerald-400">✓</span>}
                        </div>
                      </div>
                      {proposed?.status === "workout" && (proposed.rationale ?? []).length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-300">
                          {(proposed.rationale ?? []).slice(0, 3).map((item, i) => (
                            <li key={`${day.planDayId}-${i}`}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {proposal.diff.summary.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">What changed</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
                  {proposal.diff.summary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {coaching ? (
              <Loader context="week-rebuild" />
            ) : (
              proposal.proposal.questions.length > 0 && (
                <div className="space-y-2">
                  {proposal.proposal.questions.map((question) => (
                    <div key={question.id}>
                      <p className="mb-2 text-sm text-zinc-300">{question.question}</p>
                      <div className="space-y-2">
                        {question.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            disabled={busy}
                            onClick={() => answer(question.id, option)}
                            className="w-full rounded-2xl bg-zinc-800 px-4 py-3 text-left text-zinc-100"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {proposal.proposal.questions.length === 0 && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={apply}
                  className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
                >
                  {busy ? <Loader compact /> : "ACCEPT CHANGES"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={reject}
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 py-3 text-base font-semibold text-zinc-200"
                >
                  REJECT
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="w-full rounded-2xl py-3 text-base font-semibold text-zinc-500">
              KEEP CURRENT WEEK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
