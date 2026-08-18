"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatWeight } from "@/lib/dates";
import { routes } from "@/lib/routes";
import type { WeekDayView, WeekView } from "@/lib/week-view";
import { CoachDecisionCard } from "./CoachDecisionCard";
import { Loader } from "./Loader";
import { WeekRebuildModal } from "./WeekRebuildModal";
import type { RebuildFollowUp, RebuildReasonOption } from "./WeekRebuildModal";

interface MoveSwapData {
  kind: "move" | "swap";
  sourceDayId: number;
  targetDayId: number;
  sourceDayName: string;
  targetDayName: string;
  sourceTitle: string;
  targetTitle: string;
}

interface AddWorkoutExercise {
  exerciseId: number;
  name: string;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
}

interface AddWorkoutData {
  kind: "add";
  dayId: number;
  effort: "light" | "usual" | "heavy";
  title: string;
  reason: string;
  note: string | null;
  exercises: AddWorkoutExercise[];
  aiMetadata?: { provider?: string; model: string };
  aiRationale?: string[];
  confidence?: string;
  safetyFlags?: string[];
}

interface StoredAdjustment {
  id: number;
  type: string;
  proposal: MoveSwapData | AddWorkoutData;
}

type Sheet =
  | { kind: "day"; day: WeekDayView }
  | { kind: "move"; source: WeekDayView | null; target: WeekDayView | null }
  | { kind: "effort"; day: WeekDayView }
  | { kind: "skip-session"; day: WeekDayView }
  | { kind: "confirm-move"; adjustment: StoredAdjustment }
  | { kind: "confirm-add"; adjustment: StoredAdjustment }
  | { kind: "remove-extra"; day: WeekDayView }
  | { kind: "restore-move"; day: WeekDayView }
  | { kind: "cancel-start"; day: WeekDayView }
  | null;

type Effort = "light" | "usual" | "heavy";

const EFFORTS: { key: Effort; label: string; hint: string }[] = [
  { key: "light", label: "LIGHT", hint: "Low-fatigue extras" },
  { key: "usual", label: "USUAL", hint: "Like a normal session" },
  { key: "heavy", label: "HEAVY", hint: "More demanding" },
];

const SKIP_SESSION_REASONS = [
  { key: "not_feeling_well", label: "Not feeling well" },
  { key: "pain", label: "Pain" },
  { key: "work_family", label: "Work / family" },
  { key: "no_time", label: "No time" },
  { key: "other", label: "Other" },
];

export function WeekPlanner({
  week,
  focusDayId,
  rebuildReasons,
  rebuildFollowUps,
}: {
  week: WeekView;
  focusDayId?: number;
  rebuildReasons?: RebuildReasonOption[];
  rebuildFollowUps?: Record<string, RebuildFollowUp[]>;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [coachingAdd, setCoachingAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const openedFocus = useRef(false);

  useEffect(() => {
    if (focusDayId && !openedFocus.current) {
      openedFocus.current = true;
      const day = week.days.find((d) => d.planDayId === Number(focusDayId));
      if (day) setSheet({ kind: "day", day });
    }
  }, [focusDayId, week.days]);

  async function proposeMove(source: WeekDayView, target: WeekDayView) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/plan-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move",
        planId: week.planId,
        sourceDayId: source.planDayId,
        targetDayId: target.planDayId,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.error) {
      setError(data.error);
      return;
    }
    setSheet({ kind: "confirm-move", adjustment: data });
  }

  async function proposeAdd(day: WeekDayView, effort: Effort) {
    setBusy(true);
    setCoachingAdd(true);
    setError(null);
    const res = await fetch("/api/plan-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", planId: week.planId, dayId: day.planDayId, effort }),
    });
    const data = await res.json();
    setCoachingAdd(false);
    setBusy(false);
    if (data.error) {
      setError(data.error);
      return;
    }
    setSheet({ kind: "confirm-add", adjustment: data });
  }

  async function skipSession(day: WeekDayView, reason: string | null) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sessions/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planDayId: day.planDayId, reason }),
    });
    const data = await res.json();
    if (data.sessionId) {
      setSheet(null);
      setBusy(false);
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not skip.");
    setBusy(false);
  }

  async function apply(id: number) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/plan-adjustments/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "approve" }),
    });
    const data = await res.json();
    if (data.ok) {
      setSheet(null);
      setBusy(false);
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not apply.");
    setBusy(false);
  }

  async function removeExtra(day: WeekDayView) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/plan-days/${day.planDayId}/remove-extra`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.ok) {
      setSheet(null);
      router.refresh();
    } else {
      setError(data.error ?? "Could not remove this extra workout.");
    }
    setBusy(false);
  }

  async function restoreMove(day: WeekDayView) {
    if (day.restoreRevisionId == null) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/plan-revisions/${day.restoreRevisionId}/restore`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.restored) {
      setSheet(null);
      router.refresh();
    } else {
      setError(data.error ?? "Could not restore this change.");
    }
    setBusy(false);
  }

  async function cancelEmptyStart(day: WeekDayView) {
    if (day.sessionId == null) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sessions/${day.sessionId}/cancel`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.cancelled) {
      setSheet(null);
      router.refresh();
    } else {
      setError(data.error ?? "Could not cancel this workout start.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Week {week.weekNumber}</h1>
        <p className="text-sm text-zinc-400">
          {week.completedCount} / {week.workoutCount} done
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {rebuildReasons && rebuildFollowUps && (
        <button
          type="button"
          onClick={() => setRebuildOpen(true)}
          className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 py-4 text-center text-base font-bold text-zinc-100 transition active:scale-[0.98]"
        >
          ADJUST / REBUILD WEEK
        </button>
      )}

      <div className="space-y-3">
        {week.days.map((day) => {
          const isRest = day.exerciseCount === 0;
          const status = day.status;
          return (
            <button
              key={day.planDayId}
              type="button"
              onClick={() => setSheet({ kind: "day", day })}
              className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                day.isToday ? "border-emerald-500/60 bg-zinc-900" : "border-zinc-800 bg-zinc-900"
              }`}
            >
              <div>
                <p className={`text-xs font-semibold uppercase tracking-widest ${day.isToday ? "text-emerald-400" : "text-zinc-500"}`}>
                  {day.dayName}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {isRest ? "Rest" : day.title}
                  {day.origin === "moved" && <span className="ml-2 text-xs text-amber-400">moved</span>}
                  {day.origin === "extra" && <span className="ml-2 text-xs text-sky-400">extra</span>}
                </p>
                {!isRest && (
                  <p className="text-sm text-zinc-500">
                    {day.exerciseCount} exercises · ~{day.durationMinutes} min
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {status === "completed" ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-lg font-bold text-zinc-950">✓</span>
                ) : status === "in-progress" ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/30 text-sm font-bold text-emerald-300">▶</span>
                ) : status === "ended_early" ? (
                  <span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm text-amber-400">Ended early</span>
                ) : status === "skipped" ? (
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-400">Skipped</span>
                ) : isRest ? (
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-500">Rest</span>
                ) : status === "missed" ? (
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-400">Missed</span>
                ) : (
                  <span className="h-3 w-3 rounded-full bg-zinc-700" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {week.weekComplete && !week.nextWeekExists && (
        <Link
          href={routes.weekNext()}
          className="block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
        >
          PLAN NEXT WEEK
        </Link>
      )}

      {sheet && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60"
          onClick={() => !busy && setSheet(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-zinc-800 bg-zinc-900 p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <SheetBody
              sheet={sheet}
              week={week}
              busy={busy}
              coachingAdd={coachingAdd}
              onClose={() => setSheet(null)}
              onMove={proposeMove}
              onAdd={proposeAdd}
              onApply={apply}
              onEffort={(day) => setSheet({ kind: "effort", day })}
              onMoveTo={(day) => setSheet({ kind: "move", source: day, target: null })}
              onMoveHere={(day) => setSheet({ kind: "move", source: null, target: day })}
              onSkipSession={(day) => setSheet({ kind: "skip-session", day })}
              onConfirmSkip={skipSession}
              onRemoveExtra={(day) => setSheet({ kind: "remove-extra", day })}
              onRestoreMove={(day) => setSheet({ kind: "restore-move", day })}
              onCancelStart={(day) => setSheet({ kind: "cancel-start", day })}
              onConfirmRemoveExtra={removeExtra}
              onConfirmRestoreMove={restoreMove}
              onConfirmCancelStart={cancelEmptyStart}
            />
          </div>
        </div>
      )}

      {rebuildReasons && rebuildFollowUps && rebuildOpen && (
        <WeekRebuildModal
          planId={week.planId}
          week={week}
          reasons={rebuildReasons}
          followUps={rebuildFollowUps}
          onClose={() => setRebuildOpen(false)}
        />
      )}
    </div>
  );
}

function SheetBody(props: {
  sheet: NonNullable<Sheet>;
  week: WeekView;
  busy: boolean;
  coachingAdd: boolean;
  onClose: () => void;
  onMove: (source: WeekDayView, target: WeekDayView) => void;
  onAdd: (day: WeekDayView, effort: Effort) => void;
  onApply: (id: number) => void;
  onEffort: (day: WeekDayView) => void;
  onMoveTo: (day: WeekDayView) => void;
  onMoveHere: (day: WeekDayView) => void;
  onSkipSession: (day: WeekDayView) => void;
  onConfirmSkip: (day: WeekDayView, reason: string | null) => void;
  onRemoveExtra: (day: WeekDayView) => void;
  onRestoreMove: (day: WeekDayView) => void;
  onCancelStart: (day: WeekDayView) => void;
  onConfirmRemoveExtra: (day: WeekDayView) => void;
  onConfirmRestoreMove: (day: WeekDayView) => void;
  onConfirmCancelStart: (day: WeekDayView) => void;
}) {
  const { sheet } = props;

  if (sheet.kind === "day") {
    const day = sheet.day;
    const isRest = day.exerciseCount === 0;
    const isUnstarted =
      day.status === "scheduled" || day.status === "missed";
    const isTerminal =
      day.status === "completed" ||
      day.status === "ended_early" ||
      day.status === "skipped";
    return (
      <div>
        <SheetTitle>{day.dayName}</SheetTitle>
        <p className="mb-4 text-lg font-semibold">{isRest ? "Recovery day" : day.title}</p>
        <div className="space-y-3">
          {day.status === "completed" && day.sessionId != null && (
            <Link href={routes.historySession(day.sessionId)} className="block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950">
              VIEW WORKOUT
            </Link>
          )}
          {(day.status === "ended_early" || day.status === "skipped") && day.sessionId != null && (
            <Link href={routes.historySession(day.sessionId)} className="block w-full rounded-2xl bg-zinc-800 py-4 text-center text-lg font-semibold text-zinc-100">
              VIEW OUTCOME
            </Link>
          )}
          {day.status === "in-progress" && day.sessionId != null && (
            <>
              <Link href={routes.session(props.week.planId, day.planDayId, day.sessionId)} className="block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950">
                RESUME
              </Link>
              {!day.sessionHasActualWork && (
                <SheetButton onClick={() => props.onCancelStart(day)}>CANCEL WORKOUT START</SheetButton>
              )}
            </>
          )}
          {isUnstarted && !isRest && (
            <>
              <Link href={routes.recovery(day.planDayId)} className="block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950">
                START
              </Link>
              {day.origin === "extra" ? (
                <>
                  <SheetButton onClick={() => props.onMoveTo(day)}>MOVE TO ANOTHER DAY</SheetButton>
                  <SheetButton onClick={() => props.onRemoveExtra(day)}>REMOVE EXTRA</SheetButton>
                </>
              ) : day.origin === "moved" && day.restoreRevisionId != null ? (
                <>
                  <SheetButton onClick={() => props.onMoveTo(day)}>MOVE AGAIN</SheetButton>
                  <SheetButton onClick={() => props.onRestoreMove(day)}>RESTORE ORIGINAL DAY</SheetButton>
                </>
              ) : (
                <>
                  <SheetButton onClick={() => props.onMoveTo(day)}>MOVE TO ANOTHER DAY</SheetButton>
                  <SheetButton onClick={() => props.onSkipSession(day)}>SKIP SESSION</SheetButton>
                </>
              )}
            </>
          )}
          {isRest && (
            <>
              <SheetButton primary onClick={() => props.onEffort(day)}>TRAIN TODAY</SheetButton>
              <SheetButton onClick={() => props.onMoveHere(day)}>MOVE A WORKOUT HERE</SheetButton>
            </>
          )}
        </div>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "remove-extra") {
    return (
      <div>
        <SheetTitle>Remove this extra workout?</SheetTitle>
        <p className="mb-3 text-sm text-zinc-400">
          The day returns to Rest. No workout is recorded and nothing counts as
          a missed or skipped session.
        </p>
        <div className="space-y-3">
          <SheetButton primary onClick={() => props.onConfirmRemoveExtra(sheet.day)}>
            REMOVE EXTRA
          </SheetButton>
          <SheetButton onClick={props.onClose}>KEEP IT</SheetButton>
        </div>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "restore-move") {
    return (
      <div>
        <SheetTitle>Restore original day?</SheetTitle>
        <p className="mb-3 text-sm text-zinc-400">
          The unchanged workout and schedule return to how they were before this
          move. Only still-unstarted days are restored.
        </p>
        <div className="space-y-3">
          <SheetButton primary onClick={() => props.onConfirmRestoreMove(sheet.day)}>
            RESTORE ORIGINAL DAY
          </SheetButton>
          <SheetButton onClick={props.onClose}>KEEP CURRENT PLACEMENT</SheetButton>
        </div>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "cancel-start") {
    return (
      <div>
        <SheetTitle>Cancel this workout start?</SheetTitle>
        <p className="mb-3 text-sm text-zinc-400">
          No training has been logged yet. This returns the day to its normal
          unstarted state.
        </p>
        <div className="space-y-3">
          <SheetButton primary onClick={() => props.onConfirmCancelStart(sheet.day)}>
            CANCEL START
          </SheetButton>
          <SheetButton onClick={props.onClose}>KEEP WORKOUT OPEN</SheetButton>
        </div>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "skip-session") {
    return (
      <div>
        <SheetTitle>Skip {sheet.day.title}?</SheetTitle>
        <p className="mb-3 text-sm text-zinc-400">
          The planned workout stays on your schedule. Why are you skipping?
        </p>
        <div className="space-y-2">
          {SKIP_SESSION_REASONS.map((r) => (
            <SheetButton key={r.key} onClick={() => props.onConfirmSkip(sheet.day, r.key)}>
              {r.label}
            </SheetButton>
          ))}
          <SheetButton onClick={() => props.onConfirmSkip(sheet.day, null)}>Skip without reason</SheetButton>
        </div>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "move") {
    const { source, target } = sheet;
    const candidates = source
      ? props.week.days.filter((d) => d.planDayId !== source.planDayId)
      : props.week.days.filter((d) => d.exerciseCount > 0 && d.planDayId !== target!.planDayId);
    return (
      <div>
        <SheetTitle>{source ? "Move to…" : "Move which workout here?"}</SheetTitle>
        <p className="mb-4 text-sm text-zinc-400">
          {source ? `Moving ${source.title}` : `Destination: ${target!.dayName}`}
        </p>
        <div className="space-y-2">
          {candidates.map((d) => (
            <button
              key={d.planDayId}
              type="button"
              disabled={props.busy}
              onClick={() => props.onMove(source ?? d, target ?? d)}
              className="flex w-full items-center justify-between rounded-2xl bg-zinc-800 px-4 py-3 text-left text-zinc-100 transition active:scale-[0.99]"
            >
              <span className="font-semibold">{d.dayName}</span>
              <span className="text-sm text-zinc-400">{d.exerciseCount === 0 ? "Rest" : d.title}</span>
            </button>
          ))}
          {candidates.length === 0 && <p className="text-sm text-zinc-500">No other workouts to move.</p>}
        </div>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "effort") {
    return (
      <div>
        <SheetTitle>How hard should today be?</SheetTitle>
        <p className="mb-4 text-sm text-zinc-400">Light is the safe default.</p>
        {props.coachingAdd ? (
          <Loader context="extra-session" />
        ) : (
          <div className="space-y-2">
            {EFFORTS.map((e, i) => (
              <button
                key={e.key}
                type="button"
                disabled={props.busy}
                onClick={() => props.onAdd(sheet.day, e.key)}
                className={`w-full rounded-2xl px-4 py-4 text-left transition active:scale-[0.99] ${
                  i === 0 ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"
                }`}
              >
                <span className="text-lg font-bold">{e.label}</span>
                <span className={`ml-2 text-sm ${i === 0 ? "text-zinc-800" : "text-zinc-400"}`}>{e.hint}</span>
              </button>
            ))}
          </div>
        )}
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  if (sheet.kind === "confirm-move") {
    const p = sheet.adjustment.proposal as MoveSwapData;
    const isSwap = p.kind === "swap";
    return (
      <div>
        <SheetTitle>{isSwap ? "Swap days" : `Move ${p.sourceTitle}`}</SheetTitle>
        <p className="my-3 text-zinc-300">
          {p.sourceDayName} → {p.targetDayName}
        </p>
        {!isSwap && <p className="mb-4 text-sm text-zinc-400">{p.sourceDayName} will become a rest day.</p>}
        {isSwap && <p className="mb-4 text-sm text-zinc-400">The two workouts will trade places.</p>}
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.onApply(sheet.adjustment.id)}
          className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
        >
          {props.busy ? <Loader compact /> : isSwap ? "SWAP DAYS" : "CONFIRM MOVE"}
        </button>
        <CloseRow onClose={props.onClose} />
      </div>
    );
  }

  const p = sheet.adjustment.proposal as AddWorkoutData;
  const exerciseList = (
    <div className="space-y-2">
      {p.exercises.map((ex) => (
        <div key={ex.exerciseId} className="flex items-center justify-between rounded-xl bg-zinc-800 px-3 py-2">
          <span className="font-semibold">{ex.name}</span>
          <span className="text-sm text-zinc-400">
            {ex.targetSets} × {ex.minReps}–{ex.maxReps} · {formatWeight(ex.suggestedWeightKg)} kg
          </span>
        </div>
      ))}
    </div>
  );
  return (
    <div>
      <SheetTitle>{p.title}</SheetTitle>
      <p className="mb-1 mt-1 text-sm text-zinc-400">{p.reason}</p>
      {p.note && <p className="mb-3 text-sm text-amber-300">{p.note}</p>}
      {p.aiMetadata ? (
        <div className="my-3">
          <CoachDecisionCard
            model={p.aiMetadata.model}
            confidence={p.confidence}
            rationale={p.aiRationale}
            safetyFlags={p.safetyFlags}
          >
            {exerciseList}
          </CoachDecisionCard>
        </div>
      ) : (
        <div className="my-3">{exerciseList}</div>
      )}
      <button
        type="button"
        disabled={props.busy}
        onClick={() => props.onApply(sheet.adjustment.id)}
        className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
      >
        {props.busy ? <Loader compact /> : "ADD WORKOUT"}
      </button>
      <CloseRow onClose={props.onClose} />
    </div>
  );
}

function SheetTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 text-2xl font-bold">{children}</h2>;
}

function SheetButton({ children, onClick, primary }: { children: React.ReactNode; onClick?: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl py-4 text-lg font-bold transition active:scale-[0.98] ${
        primary ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="mt-3 w-full rounded-2xl py-3 text-base font-semibold text-zinc-500">
      CLOSE
    </button>
  );
}
