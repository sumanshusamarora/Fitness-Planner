"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatWeight } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { smallestIncrement } from "@/lib/progression";
import { Stepper } from "@/components/Stepper";
import { ExerciseMedia, type ExerciseMediaData } from "@/components/ExerciseMedia";

interface LoggedSet {
  id: number;
  setNumber: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  setType: string;
}

interface SessionActivity {
  id: number;
  activityType: string;
  activityRole: string;
  nameSnapshot: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  speed: number | null;
  inclinePercent: number | null;
  effortRpe: number | null;
  notes: string | null;
}

function normalizeActivity(input: Partial<SessionActivity>): SessionActivity {
  return {
    id: Number(input.id ?? 0),
    activityType: String(input.activityType ?? "other"),
    activityRole: String(input.activityRole ?? "other"),
    nameSnapshot: input.nameSnapshot ?? null,
    durationSeconds: input.durationSeconds == null ? null : Number(input.durationSeconds),
    distanceMeters: input.distanceMeters == null ? null : Number(input.distanceMeters),
    speed: input.speed == null ? null : Number(input.speed),
    inclinePercent: input.inclinePercent == null ? null : Number(input.inclinePercent),
    effortRpe: input.effortRpe == null ? null : Number(input.effortRpe),
    notes: input.notes ?? null,
  };
}

type ExerciseStatus = "pending" | "completed" | "skipped" | "not_attempted" | "replaced";

interface Exercise {
  sessionExerciseId: number;
  exerciseId: number;
  name: string;
  measurementType: string;
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
  externalReference: {
    provider: string;
    name: string;
    sourceUrl: string | null;
    instructionsHtml: string | null;
    videoUrl: string | null;
    imageUrl: string | null;
  } | null;
  loggedSets: LoggedSet[];
  status: ExerciseStatus;
  origin: "planned" | "added" | "replacement";
  replacementReason: string | null;
  skipReason: string | null;
  /** For a replacement: the exercise id of the original it replaced. */
  replacedExerciseId: number | null;
  /** For a replacement: prescribed name of the original exercise. */
  replacesName: string | null;
  /** For a replaced original: name of the active replacement. */
  replacedByName: string | null;
}

export interface ActiveWorkoutData {
  sessionId: number;
  title: string;
  status: "in_progress" | "completed" | "ended_early" | "skipped";
  exercises: Exercise[];
  hasActualWork: boolean;
}

interface ActiveWorkoutNav {
  weekId: number;
  dayId: number;
}

type Phase = "setup" | "rpe" | "rest" | "done";

const RPE_OPTIONS = [5, 6, 7, 8, 9, 10];

const SKIP_REASONS: { key: string; label: string }[] = [
  { key: "equipment_busy", label: "Equipment busy" },
  { key: "not_feeling_well", label: "Not feeling well" },
  { key: "pain", label: "Pain / discomfort" },
  { key: "short_on_time", label: "Short on time" },
  { key: "other", label: "Other" },
];

const END_EARLY_REASONS: { key: string; label: string }[] = [
  { key: "not_feeling_well", label: "Not feeling well" },
  { key: "pain", label: "Pain / discomfort" },
  { key: "short_on_time", label: "Short on time" },
  { key: "work_family", label: "Work / family" },
  { key: "other", label: "Other" },
];

function phaseFor(ex: Exercise): Phase {
  return ex.status === "completed" ||
    ex.status === "skipped" ||
    ex.status === "replaced"
    ? "done"
    : "setup";
}

export function ActiveWorkout({ data, nav }: { data: ActiveWorkoutData; nav?: ActiveWorkoutNav }) {
  const router = useRouter();
  const { sessionId, title, exercises: initialExercises } = data;

  const [exercises, setExercises] = useState(initialExercises);
  const [index, setIndex] = useState(() => {
    const idx = initialExercises.findIndex((e) => e.status === "pending");
    return idx === -1 ? 0 : idx;
  });
  const [phase, setPhase] = useState<Phase>(() => {
    const idx = initialExercises.findIndex((e) => e.status === "pending");
    return phaseFor(initialExercises[idx === -1 ? 0 : idx]);
  });
  const [drafts, setDrafts] = useState<Record<number, { weight: number; reps: number }>>(() => {
    const init: Record<number, { weight: number; reps: number }> = {};
    for (const e of initialExercises) {
      init[e.exerciseId] = {
        weight: e.suggestedWeightKg ?? e.lastTime?.weightKg ?? 0,
        reps: e.maxReps,
      };
    }
    return init;
  });
  const [restLeft, setRestLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [endEarlyOpen, setEndEarlyOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [cancelStartOpen, setCancelStartOpen] = useState(false);
  const [warmup, setWarmup] = useState(false);
  const [addActivityOpen, setAddActivityOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [activityKind, setActivityKind] = useState<"warmup" | "cardio" | "mobility" | "cooldown" | null>(null);
  const [activityMinutes, setActivityMinutes] = useState(10);
  const [replaceReason, setReplaceReason] = useState<string | null>(null);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [replaceResults, setReplaceResults] = useState<{ id: number; name: string; primaryMuscle: string }[]>([]);
  const [setMenu, setSetMenu] = useState<LoggedSet | null>(null);
  const [setEditor, setSetEditor] = useState<LoggedSet | null>(null);
  const [setEditorWeight, setSetEditorWeight] = useState(0);
  const [setEditorReps, setSetEditorReps] = useState(0);
  const [setEditorRpe, setSetEditorRpe] = useState<number | null>(null);
  const [setEditorType, setSetEditorType] = useState<"warmup" | "working">("working");
  const [activities, setActivities] = useState<SessionActivity[]>([]);
  const [activityMenu, setActivityMenu] = useState<SessionActivity | null>(null);
  const [activityEditor, setActivityEditor] = useState<SessionActivity | null>(null);
  const [activityName, setActivityName] = useState("");
  const [activityMinutesDraft, setActivityMinutesDraft] = useState(10);
  const [activityEffortDraft, setActivityEffortDraft] = useState<number | "">("");
  const [activityDistanceDraft, setActivityDistanceDraft] = useState<number | "">("");
  const [activitySpeedDraft, setActivitySpeedDraft] = useState<number | "">("");
  const [activityInclineDraft, setActivityInclineDraft] = useState<number | "">("");
  const [activityNotesDraft, setActivityNotesDraft] = useState("");

  const exercisesRef = useRef(exercises);
  const indexRef = useRef(index);
  useEffect(() => {
    exercisesRef.current = exercises;
    indexRef.current = index;
  }, [exercises, index]);

  useEffect(() => {
    let cancelled = false;
    async function loadActivities() {
      const res = await fetch(`/api/sessions/${sessionId}/activities`);
      const data = await res.json().catch(() => ({}));
      if (!cancelled) {
        setActivities(
          Array.isArray(data.activities)
            ? data.activities.map((item: Partial<SessionActivity>) => normalizeActivity(item))
            : [],
        );
      }
    }
    void loadActivities();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (phase !== "rest") return;
    if (restLeft <= 0) {
      const ex = exercisesRef.current[indexRef.current];
      const workingCount = ex.loggedSets.filter((s) => s.setType === "working").length;
      setPhase(workingCount < ex.targetSets ? "setup" : "done");
      return;
    }
    const t = setTimeout(() => setRestLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, restLeft]);

  if (initialExercises.length === 0) {
    return <p className="text-lg text-zinc-400">No exercises in this workout.</p>;
  }

  const ex = exercises[index];
  const draft = drafts[ex.exerciseId] ?? { weight: ex.suggestedWeightKg ?? ex.lastTime?.weightKg ?? 0, reps: ex.maxReps };
  const measurement = ex.measurementType;
  const isWeighted = measurement === "weighted_reps";
  const isTimed = measurement === "timed_hold";
  const workingCount = ex.loggedSets.filter((s) => s.setType === "working").length;
  const setNumber = ex.loggedSets.length + 1;
  const weightStep = smallestIncrement(draft.weight) || 2.5;
  const allDone = exercises.every((e) => e.status !== "pending");
  const completedCount = exercises.filter((e) => e.status === "completed").length;
  const skippedCount = exercises.filter((e) => e.status === "skipped").length;
  const replacedCount = exercises.filter((e) => e.status === "replaced").length;

  function updateDraft(patch: Partial<{ weight: number; reps: number }>) {
    setDrafts((prev) => ({
      ...prev,
      [ex.exerciseId]: { ...(prev[ex.exerciseId] ?? draft), ...patch },
    }));
  }

  function goTo(i: number) {
    const next = Math.max(0, Math.min(i, exercises.length - 1));
    setIndex(next);
    setPhase(phaseFor(exercises[next]));
    setError(null);
  }

  function nextPending(from: number): number {
    for (let i = from + 1; i < exercises.length; i++) {
      if (exercises[i].status === "pending") return i;
    }
    for (let i = 0; i <= from; i++) {
      if (exercises[i].status === "pending") return i;
    }
    return -1;
  }

  async function saveSet(rpe: number) {
    setSaving(true);
    setError(null);
    try {
      const setType = warmup ? "warmup" : "working";
      const res = await fetch(`/api/sessions/${sessionId}/sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exerciseId: ex.exerciseId,
          weightKg: isWeighted ? draft.weight : 0,
          reps: draft.reps,
          rpe,
          setType,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const payload = (await res.json().catch(() => ({}))) as {
        set?: { id: number; setNumber: number; weightKg: number; reps: number; rpe: number | null; setType: string };
      };

      const isLastSet = !warmup && workingCount + 1 >= ex.targetSets;
      const newSet: LoggedSet = {
        id: payload.set?.id ?? Date.now(),
        setNumber: payload.set?.setNumber ?? ex.loggedSets.length + 1,
        weightKg: payload.set?.weightKg ?? (isWeighted ? draft.weight : 0),
        reps: payload.set?.reps ?? draft.reps,
        rpe: payload.set?.rpe ?? rpe,
        setType: payload.set?.setType ?? setType,
      };
      setExercises((prev) =>
        prev.map((e, i) =>
          i === index
            ? {
                ...e,
                loggedSets: [...e.loggedSets, newSet],
                status: isLastSet ? ("completed" as ExerciseStatus) : e.status,
              }
            : e,
        ),
      );

      if (isLastSet) {
        await fetch(`/api/sessions/${sessionId}/exercises/${ex.exerciseId}/complete`, {
          method: "POST",
        });
      }

      setWarmup(false);
      setRestLeft(ex.restSeconds);
      setPhase("rest");
    } catch {
      setError("Could not save this set. Try again.");
      setPhase("setup");
    } finally {
      setSaving(false);
    }
  }

  async function skipExercise(reason: string) {
    setSkipOpen(false);
    setSaving(true);
    const res = await fetch(`/api/sessions/${sessionId}/exercises/${ex.exerciseId}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setSaving(false);
    if (res.ok) {
      setExercises((prev) =>
        prev.map((e, i) =>
          i === index ? { ...e, status: "skipped" as ExerciseStatus, skipReason: reason } : e,
        ),
      );
      const np = nextPending(index);
      if (np !== -1) goTo(np);
    }
  }

  async function undoSkip() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/exercises/${ex.exerciseId}/restore-skip`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not restore this exercise.");
      }
      setExercises((prev) =>
        prev.map((e, i) =>
          i === index
            ? { ...e, status: "pending" as ExerciseStatus, skipReason: null }
            : e,
        ),
      );
      setPhase("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore this exercise.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelStart() {
    setCancelStartOpen(false);
    setSaving(true);
    const res = await fetch(`/api/sessions/${sessionId}/cancel`, {
      method: "POST",
    });
    setSaving(false);
    if (res.ok) {
      router.push("/week");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not cancel this workout start.");
    }
  }

  async function addActivity() {
    if (!activityKind) return;
    const type = activityKind === "mobility" ? "mobility" : activityKind === "cooldown" ? "stretching" : "cardio";
    const role = activityKind === "warmup" ? "warmup" : activityKind === "cooldown" ? "cooldown" : activityKind === "mobility" ? "mobility" : "cardio";
    setSaving(true);
    const res = await fetch(`/api/sessions/${sessionId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityType: type,
        activityRole: role,
        nameSnapshot: activityKind === "warmup" ? "Treadmill" : activityKind === "cardio" ? "Cardio" : activityKind === "mobility" ? "Mobility" : "Cool-down",
        durationSeconds: activityMinutes * 60,
        effortRpe: null,
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { activity?: SessionActivity };
      if (data.activity) setActivities((prev) => [...prev, normalizeActivity(data.activity as SessionActivity)]);
    }
    setSaving(false);
    setAddActivityOpen(false);
    setActivityKind(null);
    setActivityMinutes(10);
  }

  function openSetEditor(set: LoggedSet) {
    setSetEditor(set);
    setSetEditorWeight(set.weightKg);
    setSetEditorReps(set.reps);
    setSetEditorRpe(set.rpe);
    setSetEditorType(set.setType === "warmup" ? "warmup" : "working");
  }

  async function saveSetEdit() {
    if (!setEditor) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/sets/${setEditor.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightKg: setEditorWeight,
          reps: setEditorReps,
          rpe: setEditorRpe,
          setType: setEditorType,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        set?: { id: number; setNumber: number; weightKg: number; reps: number; rpe: number | null; setType: string };
      };
      if (!res.ok || !data.set) throw new Error(data.error ?? "Could not edit this set.");

      setExercises((prev) =>
        prev.map((exercise, i) =>
          i === index
            ? {
                ...exercise,
                loggedSets: exercise.loggedSets.map((set) =>
                  set.id === setEditor.id
                    ? {
                        ...set,
                        weightKg: data.set!.weightKg,
                        reps: data.set!.reps,
                        rpe: data.set!.rpe,
                        setType: data.set!.setType,
                      }
                    : set,
                ),
              }
            : exercise,
        ),
      );
      setSetEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not edit this set.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSetById(setId: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/sets/${setId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not remove this set.");

      setExercises((prev) =>
        prev.map((exercise, i) => {
          if (i !== index) return exercise;
          const kept = exercise.loggedSets.filter((set) => set.id !== setId);
          return {
            ...exercise,
            loggedSets: kept.map((set, idx) => ({ ...set, setNumber: idx + 1 })),
            status: "pending",
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this set.");
    } finally {
      setSaving(false);
      setSetMenu(null);
    }
  }

  function openActivityEditor(activity: SessionActivity) {
    setActivityEditor(activity);
    setActivityName(activity.nameSnapshot ?? "");
    setActivityMinutesDraft(Math.max(1, Math.round((activity.durationSeconds ?? 600) / 60)));
    setActivityEffortDraft(activity.effortRpe ?? "");
    setActivityDistanceDraft(activity.distanceMeters ?? "");
    setActivitySpeedDraft(activity.speed ?? "");
    setActivityInclineDraft(activity.inclinePercent ?? "");
    setActivityNotesDraft(activity.notes ?? "");
  }

  async function saveActivityEdit() {
    if (!activityEditor) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/activities/${activityEditor.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameSnapshot: activityName || null,
          durationSeconds: Math.max(1, activityMinutesDraft) * 60,
          effortRpe: activityEffortDraft === "" ? null : Number(activityEffortDraft),
          distanceMeters: activityDistanceDraft === "" ? null : Number(activityDistanceDraft),
          speed: activitySpeedDraft === "" ? null : Number(activitySpeedDraft),
          inclinePercent: activityInclineDraft === "" ? null : Number(activityInclineDraft),
          notes: activityNotesDraft || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; activity?: SessionActivity };
      if (!res.ok || !data.activity) throw new Error(data.error ?? "Could not update activity.");

      setActivities((prev) => prev.map((item) => (item.id === activityEditor.id ? normalizeActivity(data.activity as SessionActivity) : item)));
      setActivityEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update activity.");
    } finally {
      setSaving(false);
    }
  }

  async function removeActivityById(activityId: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/activities/${activityId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not remove activity.");
      setActivities((prev) => prev.filter((item) => item.id !== activityId));
      setActivityMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove activity.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAddedExercise() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/exercises/${ex.exerciseId}/remove-added`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not remove this added exercise.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this added exercise.");
    } finally {
      setSaving(false);
      setMenuOpen(false);
    }
  }

  async function searchReplace(query: string) {
    const res = await fetch(`/api/exercises/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setReplaceResults(data.exercises ?? []);
  }

  async function doReplace(replacementExerciseId: number) {
    setSaving(true);
    const res = await fetch(`/api/sessions/${sessionId}/exercises/${ex.exerciseId}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replacementExerciseId, reason: replaceReason ?? "other" }),
    });
    setSaving(false);
    if (res.ok) {
      setReplaceOpen(false);
      setReplaceReason(null);
      setReplaceQuery("");
      router.refresh();
    } else {
      setError("Could not replace this exercise.");
    }
  }

  async function restoreOriginal() {
    if (!ex.replacedExerciseId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/exercises/${ex.replacedExerciseId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not restore the original exercise.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore the original exercise.");
      setSaving(false);
    }
  }

  async function endEarly(reason: string | null) {
    setEndEarlyOpen(false);
    setSaving(true);
    await fetch(`/api/sessions/${sessionId}/end-early`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (nav) {
      router.push(routes.sessionComplete(nav.weekId, nav.dayId, sessionId));
      return;
    }
    router.push(`/workout/${sessionId}/complete`);
  }

  function finish() {
    setFinishOpen(false);
    if (nav) {
      router.push(routes.sessionComplete(nav.weekId, nav.dayId, sessionId));
      return;
    }
    router.push(`/workout/${sessionId}/complete`);
  }

  return (
    <div className="pb-24">
      <header className="mb-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{title}</h1>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-300"
            aria-label="Workout menu"
          >
            •••
          </button>
        </div>
        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="mt-3 text-sm font-semibold text-emerald-400"
        >
          Exercise {index + 1} of {exercises.length}
        </button>
        <div className="mt-2 flex gap-1">
          {exercises.map((e, i) => (
            <span
              key={e.exerciseId}
              className={`h-1 flex-1 rounded-full ${
                e.status === "completed"
                  ? "bg-emerald-500"
                  : e.status === "replaced"
                    ? "bg-violet-500"
                    : e.status === "skipped"
                      ? "bg-amber-500"
                      : i === index
                        ? "bg-zinc-300"
                        : "bg-zinc-800"
              }`}
            />
          ))}
        </div>
      </header>

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

            {ex.externalReference && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-400">
                  More about this exercise
                </summary>
                <div className="mt-3 space-y-3 text-zinc-300">
                  {ex.externalReference.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ex.externalReference.imageUrl}
                      alt={ex.externalReference.name}
                      className="w-full rounded-2xl border border-zinc-800"
                      loading="lazy"
                    />
                  )}
                  {ex.externalReference.videoUrl && (
                    <a
                      href={ex.externalReference.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-2xl bg-zinc-800 py-3 text-center text-sm font-semibold text-zinc-100"
                    >
                      Watch demonstration
                    </a>
                  )}
                  {ex.externalReference.instructionsHtml && (
                    <div
                      className="external-instructions text-sm leading-relaxed text-zinc-300"
                      dangerouslySetInnerHTML={{
                        __html: ex.externalReference.instructionsHtml,
                      }}
                    />
                  )}
                  <p className="text-xs text-zinc-500">
                    Source:{" "}
                    <a
                      href={ex.externalReference.sourceUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {ex.externalReference.provider}
                    </a>
                  </p>
                </div>
              </details>
            )}

            {ex.lastTime && (
              <div className="mt-4 rounded-2xl bg-zinc-800/60 p-4">
                <p className="text-xs uppercase tracking-widest text-zinc-400">Last time</p>
                <p className="mt-1 text-lg font-semibold">
                  {formatWeight(ex.lastTime.weightKg)} kg · {ex.lastTime.reps} reps
                  {ex.lastTime.rpe != null && ` · RPE ${ex.lastTime.rpe}`}
                </p>
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs uppercase tracking-widest text-zinc-400">Today</p>
              <p className="mt-1 text-lg font-semibold">
                {formatWeight(ex.suggestedWeightKg)} kg · {ex.targetSets} set
                {ex.targetSets > 1 ? "s" : ""} × {ex.minReps}–{ex.maxReps} reps · RPE{" "}
                {ex.targetRpe}
              </p>
              {ex.recommendationReason && (
                <p className="mt-1 text-sm text-zinc-500">{ex.recommendationReason}</p>
              )}
            </div>

            {ex.loggedSets.length > 0 && (
              <div className="mt-4 space-y-2 rounded-2xl bg-zinc-800/50 p-4">
                <p className="text-xs uppercase tracking-widest text-zinc-400">Logged sets</p>
                {ex.loggedSets.map((set) => (
                  <div key={set.id} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-sm">
                    <span>
                      Set {set.setNumber} · {set.setType === "warmup" ? "Warm-up" : "Working"} · {formatWeight(set.weightKg)} kg × {set.reps}
                      {set.rpe != null && ` @ RPE ${set.rpe}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSetMenu(set)}
                      className="h-10 w-10 rounded-xl bg-zinc-800 text-zinc-300"
                      aria-label="Set options"
                    >
                      •••
                    </button>
                  </div>
                ))}
              </div>
            )}

            {ex.origin === "replacement" && ex.replacesName && (
              <div className="mt-4 rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4">
                <p className="text-sm text-violet-300">
                  Replacing {ex.replacesName}
                  {ex.replacementReason ? ` · ${reasonLabel(ex.replacementReason)}` : ""}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="mb-4 text-center text-sm font-semibold uppercase tracking-[0.3em] text-zinc-400">
              Set {setNumber} of {ex.targetSets}
            </p>
            <div className="space-y-4">
              {isWeighted && (
                <Stepper
                  label="Weight"
                  value={draft.weight}
                  step={weightStep}
                  unit="kg"
                  format={formatWeight}
                  onChange={(v) => updateDraft({ weight: v })}
                />
              )}
              {!isWeighted && !isTimed && (
                <p className="rounded-2xl bg-zinc-800/60 p-3 text-sm text-zinc-400">
                  Bodyweight — no external load needed.
                </p>
              )}
              {isTimed && (
                <p className="rounded-2xl bg-zinc-800/60 p-3 text-sm text-zinc-400">
                  Timed hold — record seconds.
                </p>
              )}
              <Stepper
                label={isTimed ? "Seconds" : "Reps"}
                value={draft.reps}
                step={isTimed ? 5 : 1}
                unit={isTimed ? "sec" : "reps"}
                onChange={(v) => updateDraft({ reps: v })}
              />
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-800/60 p-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={warmup}
                  onChange={(e) => setWarmup(e.target.checked)}
                  className="h-5 w-5 accent-emerald-500"
                />
                Mark this set as warm-up
              </label>
            </div>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={() => setPhase("rpe")}
              disabled={saving || draft.reps <= 0 || (isWeighted && draft.weight <= 0)}
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
            {isWeighted ? `${formatWeight(draft.weight)} kg × ${draft.reps} reps` : isTimed ? `${draft.reps} seconds` : `${draft.reps} reps`}
            {warmup && " · warm-up"}
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
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">Rest</p>
          <p className="mt-4 text-7xl font-bold tabular-nums">{Math.ceil(restLeft)}</p>
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
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl font-bold text-zinc-950">
            {ex.status === "skipped" ? "–" : ex.status === "replaced" ? "↷" : "✓"}
          </div>
          <h2 className="mt-6 text-3xl font-bold">
            {ex.status === "skipped"
              ? "Skipped"
              : ex.status === "replaced"
                ? "Replaced"
                : "Exercise complete"}
          </h2>
          <p className="mt-1 text-zinc-400">
            {ex.name}
            {ex.status === "skipped" && ex.skipReason && ` · ${reasonLabel(ex.skipReason)}`}
            {ex.status === "replaced" && ex.replacedByName && (
              <span className="block text-sm">→ performed as {ex.replacedByName}</span>
            )}
          </p>
          {ex.loggedSets.length > 0 && (
            <div className="mt-4 space-y-2 text-zinc-300">
              {ex.loggedSets.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-zinc-800 px-3 py-2 text-sm">
                  <span>
                    Set {s.setNumber} · {s.setType === "warmup" ? "Warm-up" : "Working"} · {formatWeight(s.weightKg)} kg × {s.reps}
                    {s.rpe != null && ` @ RPE ${s.rpe}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSetMenu(s)}
                    className="h-10 w-10 rounded-xl bg-zinc-900 text-zinc-300"
                    aria-label="Set options"
                  >
                    •••
                  </button>
                </div>
              ))}
            </div>
          )}
          {ex.status === "skipped" && (
            <button
              type="button"
              onClick={undoSkip}
              disabled={saving}
              className="mt-5 rounded-2xl bg-zinc-800 px-5 py-3 font-semibold text-zinc-100 disabled:opacity-60"
            >
              UNDO SKIP
            </button>
          )}
          {ex.status === "replaced" && ex.origin === "replacement" && (
            <button
              type="button"
              onClick={restoreOriginal}
              disabled={saving || ex.loggedSets.length > 0}
              className="mt-5 rounded-2xl bg-zinc-800 px-5 py-3 font-semibold text-zinc-100 disabled:opacity-40"
            >
              RESTORE ORIGINAL{ex.loggedSets.length > 0 ? " (locked: sets logged)" : ""}
            </button>
          )}
        </div>
      )}

      {allDone && (
        <button
          type="button"
          onClick={() => setFinishOpen(true)}
          className="mt-5 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
        >
          FINISH WORKOUT
        </button>
      )}

      {activities.length > 0 && (
        <section className="mt-5 rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 text-xl font-bold">Activities</h2>
          <div className="space-y-2">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between rounded-xl bg-zinc-800 px-3 py-3 text-sm">
                <span>
                  {(activity.nameSnapshot ?? roleLabel(activity.activityRole)) || "Activity"}
                  {activity.durationSeconds != null && ` · ${Math.max(1, Math.round(activity.durationSeconds / 60))} min`}
                </span>
                <button
                  type="button"
                  onClick={() => setActivityMenu(activity)}
                  className="h-10 w-10 rounded-xl bg-zinc-900 text-zinc-300"
                  aria-label="Activity options"
                >
                  •••
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sticky navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-3 px-4 py-3 sm:max-w-lg lg:max-w-xl">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="flex-1 rounded-2xl bg-zinc-800 py-4 text-lg font-bold text-zinc-100 disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === exercises.length - 1}
            className="flex-1 rounded-2xl bg-zinc-800 py-4 text-lg font-bold text-zinc-100 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </nav>

      {listOpen && (
        <Overlay onClose={() => setListOpen(false)}>
          <h2 className="mb-3 text-2xl font-bold">Workout</h2>
          <div className="space-y-2">
            {exercises.map((e, i) => (
              <button
                key={e.exerciseId}
                type="button"
                onClick={() => {
                  setListOpen(false);
                  goTo(i);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left ${
                  i === index ? "bg-zinc-700" : "bg-zinc-800"
                }`}
              >
                <span className="font-semibold text-zinc-100">
                  {statusIcon(e.status)} {e.name}
                </span>
                <span className="text-sm text-zinc-400">
                  {e.status === "completed"
                    ? `${e.loggedSets.length} sets`
                    : e.status === "replaced"
                      ? "replaced"
                      : e.status === "skipped"
                        ? "skipped"
                        : ""}
                </span>
              </button>
            ))}
          </div>
          <CloseRow onClose={() => setListOpen(false)} />
        </Overlay>
      )}

      {menuOpen && (
        <Overlay onClose={() => setMenuOpen(false)}>
          <h2 className="mb-3 text-2xl font-bold">{title}</h2>
          <div className="space-y-3">
            <SheetButton onClick={() => { setMenuOpen(false); setListOpen(true); }}>
              Exercise list
            </SheetButton>
            <SheetButton onClick={() => { setMenuOpen(false); setAddActivityOpen(true); }}>
              Add activity
            </SheetButton>
            {ex.origin === "planned" && ex.status === "pending" && (
              <SheetButton onClick={() => { setMenuOpen(false); setReplaceOpen(true); }}>
                Replace exercise
              </SheetButton>
            )}
            {ex.origin === "planned" && ex.status === "pending" && (
              <SheetButton onClick={() => { setMenuOpen(false); setSkipOpen(true); }}>
                Skip exercise
              </SheetButton>
            )}
            {ex.origin === "added" && ex.status === "pending" && ex.loggedSets.length === 0 && (
              <SheetButton onClick={() => void removeAddedExercise()}>
                Remove added exercise
              </SheetButton>
            )}
            <SheetButton onClick={() => { setMenuOpen(false); setFinishOpen(true); }}>
              Finish workout
            </SheetButton>
            <SheetButton onClick={() => { setMenuOpen(false); setEndEarlyOpen(true); }}>
              End workout early
            </SheetButton>
            {!data.hasActualWork && (
              <SheetButton onClick={() => { setMenuOpen(false); setCancelStartOpen(true); }}>
                Cancel workout start
              </SheetButton>
            )}
          </div>
          <CloseRow onClose={() => setMenuOpen(false)} />
        </Overlay>
      )}

      {skipOpen && (
        <Overlay onClose={() => setSkipOpen(false)}>
          <h2 className="mb-1 text-2xl font-bold">Skip {ex.name}?</h2>
          <p className="mb-3 text-sm text-zinc-400">Why are you skipping?</p>
          <div className="space-y-2">
            <SheetButton primary onClick={() => { setSkipOpen(false); goTo(index + 1); }}>
              DO LATER — move on without skipping
            </SheetButton>
            {SKIP_REASONS.map((r) => (
              <SheetButton key={r.key} onClick={() => skipExercise(r.key)}>
                {r.label}
              </SheetButton>
            ))}
            <SheetButton onClick={() => skipExercise("no_reason")}>Skip without reason</SheetButton>
          </div>
          <CloseRow onClose={() => setSkipOpen(false)} />
        </Overlay>
      )}

      {endEarlyOpen && (
        <Overlay onClose={() => setEndEarlyOpen(false)}>
          <h2 className="mb-1 text-2xl font-bold">End workout?</h2>
          <p className="mb-3 text-sm text-zinc-400">
            Your completed sets will be saved. Remaining exercises stay unperformed.
          </p>
          <div className="space-y-2">
            {END_EARLY_REASONS.map((r) => (
              <SheetButton key={r.key} onClick={() => endEarly(r.key)}>
                {r.label}
              </SheetButton>
            ))}
            <SheetButton onClick={() => endEarly("no_reason")}>No reason</SheetButton>
            <SheetButton primary onClick={() => setEndEarlyOpen(false)}>
              KEEP TRAINING
            </SheetButton>
          </div>
        </Overlay>
      )}

      {finishOpen && (
        <Overlay onClose={() => setFinishOpen(false)}>
          <h2 className="mb-3 text-2xl font-bold">Finish workout?</h2>
          <p className="text-zinc-300">
            {completedCount} completed · {skippedCount} skipped
            {replacedCount > 0 && ` · ${replacedCount} replaced`} ·{" "}
            {exercises.length - completedCount - skippedCount - replacedCount} not performed
          </p>
          <div className="mt-5 space-y-3">
            <SheetButton primary onClick={finish}>
              FINISH
            </SheetButton>
            <SheetButton onClick={() => setFinishOpen(false)}>GO BACK</SheetButton>
          </div>
        </Overlay>
      )}

      {cancelStartOpen && (
        <Overlay onClose={() => setCancelStartOpen(false)}>
          <h2 className="mb-1 text-2xl font-bold">Cancel this workout start?</h2>
          <p className="mb-3 text-sm text-zinc-400">
            No training has been logged yet. This returns the day to its normal
            unstarted state and removes the workout.
          </p>
          <div className="mt-5 space-y-3">
            <SheetButton primary onClick={cancelStart}>
              CANCEL START
            </SheetButton>
            <SheetButton onClick={() => setCancelStartOpen(false)}>KEEP WORKOUT OPEN</SheetButton>
          </div>
        </Overlay>
      )}

      {addActivityOpen && (
        <Overlay onClose={() => setAddActivityOpen(false)}>
          <h2 className="mb-3 text-2xl font-bold">Add activity</h2>
          {!activityKind ? (
            <div className="space-y-2">
              {[
                { key: "warmup", label: "Warm-up" },
                { key: "cardio", label: "Cardio" },
                { key: "mobility", label: "Mobility / Stretching" },
                { key: "cooldown", label: "Cool-down" },
              ].map((option) => (
                <SheetButton key={option.key} onClick={() => setActivityKind(option.key as never)}>
                  {option.label}
                </SheetButton>
              ))}
              <CloseRow onClose={() => setAddActivityOpen(false)} />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-lg font-semibold capitalize">{activityKind}</p>
              <div className="flex items-center justify-center gap-6">
                <button type="button" onClick={() => setActivityMinutes((m) => Math.max(1, m - 5))} className="h-14 w-14 rounded-2xl bg-zinc-800 text-2xl font-bold">−</button>
                <p className="text-4xl font-bold tabular-nums">{activityMinutes} min</p>
                <button type="button" onClick={() => setActivityMinutes((m) => m + 5)} className="h-14 w-14 rounded-2xl bg-zinc-800 text-2xl font-bold">+</button>
              </div>
              <SheetButton primary onClick={addActivity}>ADD</SheetButton>
              <CloseRow onClose={() => { setAddActivityOpen(false); setActivityKind(null); }} />
            </div>
          )}
        </Overlay>
      )}

      {replaceOpen && (
        <Overlay onClose={() => setReplaceOpen(false)}>
          <h2 className="mb-3 text-2xl font-bold">Replace {ex.name}</h2>
          {!replaceReason ? (
            <div className="space-y-2">
              <p className="mb-2 text-sm text-zinc-400">Why replace it?</p>
              {[
                { key: "equipment_busy", label: "Equipment busy" },
                { key: "equipment_unavailable", label: "Equipment unavailable" },
                { key: "pain_discomfort", label: "Pain / discomfort" },
                { key: "preference", label: "Prefer something else" },
                { key: "other", label: "Other" },
              ].map((r) => (
                <SheetButton key={r.key} onClick={() => setReplaceReason(r.key)}>
                  {r.label}
                </SheetButton>
              ))}
              <CloseRow onClose={() => setReplaceOpen(false)} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={replaceQuery}
                  onChange={(e) => { setReplaceQuery(e.target.value); searchReplace(e.target.value); }}
                  placeholder="Search exercises"
                  className="flex-1 rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100"
                />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {replaceResults.map((r) => (
                  <button key={r.id} type="button" onClick={() => doReplace(r.id)} className="flex w-full items-center justify-between rounded-2xl bg-zinc-800 px-4 py-3 text-left">
                    <span className="font-semibold text-zinc-100">{r.name}</span>
                    <span className="text-sm text-zinc-400">{r.primaryMuscle}</span>
                  </button>
                ))}
              </div>
              <CloseRow onClose={() => { setReplaceOpen(false); setReplaceReason(null); }} />
            </div>
          )}
        </Overlay>
      )}

      {setMenu && (
        <Overlay onClose={() => setSetMenu(null)}>
          <h2 className="mb-3 text-2xl font-bold">Set {setMenu.setNumber}</h2>
          <div className="space-y-2">
            <SheetButton
              onClick={() => {
                openSetEditor(setMenu);
                setSetMenu(null);
              }}
            >
              Edit set
            </SheetButton>
            <SheetButton onClick={() => void removeSetById(setMenu.id)}>Remove set</SheetButton>
          </div>
          <CloseRow onClose={() => setSetMenu(null)} />
        </Overlay>
      )}

      {setEditor && (
        <Overlay onClose={() => setSetEditor(null)}>
          <h2 className="mb-3 text-2xl font-bold">Edit set</h2>
          <div className="space-y-4">
            <Stepper
              label="Weight"
              value={setEditorWeight}
              step={smallestIncrement(setEditorWeight) || 2.5}
              unit="kg"
              format={formatWeight}
              onChange={setSetEditorWeight}
            />
            <Stepper
              label={measurement === "timed_hold" ? "Seconds" : "Reps"}
              value={setEditorReps}
              step={measurement === "timed_hold" ? 5 : 1}
              unit={measurement === "timed_hold" ? "sec" : "reps"}
              onChange={setSetEditorReps}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSetEditorType("warmup")}
                className={`rounded-2xl py-3 text-sm font-semibold ${setEditorType === "warmup" ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
              >
                Warm-up
              </button>
              <button
                type="button"
                onClick={() => setSetEditorType("working")}
                className={`rounded-2xl py-3 text-sm font-semibold ${setEditorType === "working" ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
              >
                Working
              </button>
            </div>
            <div>
              <p className="mb-2 text-sm text-zinc-400">RPE</p>
              <div className="grid grid-cols-3 gap-2">
                {RPE_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSetEditorRpe(value)}
                    className={`rounded-xl py-2 text-lg font-bold ${setEditorRpe === value ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <SheetButton primary onClick={() => void saveSetEdit()}>Save set</SheetButton>
            <CloseRow onClose={() => setSetEditor(null)} />
          </div>
        </Overlay>
      )}

      {activityMenu && (
        <Overlay onClose={() => setActivityMenu(null)}>
          <h2 className="mb-3 text-2xl font-bold">Activity</h2>
          <div className="space-y-2">
            <SheetButton
              onClick={() => {
                openActivityEditor(activityMenu);
                setActivityMenu(null);
              }}
            >
              Edit
            </SheetButton>
            <SheetButton onClick={() => void removeActivityById(activityMenu.id)}>Remove</SheetButton>
          </div>
          <CloseRow onClose={() => setActivityMenu(null)} />
        </Overlay>
      )}

      {activityEditor && (
        <Overlay onClose={() => setActivityEditor(null)}>
          <h2 className="mb-3 text-2xl font-bold">Edit activity</h2>
          <div className="space-y-3">
            <input
              value={activityName}
              onChange={(e) => setActivityName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100"
            />
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-800 p-3">
              <span className="text-sm text-zinc-300">Duration (min)</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setActivityMinutesDraft((m) => Math.max(1, m - 1))} className="h-10 w-10 rounded-xl bg-zinc-900">−</button>
                <span className="w-10 text-center font-semibold tabular-nums">{activityMinutesDraft}</span>
                <button type="button" onClick={() => setActivityMinutesDraft((m) => m + 1)} className="h-10 w-10 rounded-xl bg-zinc-900">+</button>
              </div>
            </div>
            <input value={activityEffortDraft} onChange={(e) => setActivityEffortDraft(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Effort RPE (optional)" className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100" />
            <input value={activityDistanceDraft} onChange={(e) => setActivityDistanceDraft(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Distance meters (optional)" className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100" />
            <input value={activitySpeedDraft} onChange={(e) => setActivitySpeedDraft(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Speed (optional)" className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100" />
            <input value={activityInclineDraft} onChange={(e) => setActivityInclineDraft(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Incline % (optional)" className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100" />
            <textarea value={activityNotesDraft} onChange={(e) => setActivityNotesDraft(e.target.value)} placeholder="Notes (optional)" rows={2} className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 p-3 text-zinc-100" />
            <SheetButton primary onClick={() => void saveActivityEdit()}>Save</SheetButton>
            <CloseRow onClose={() => setActivityEditor(null)} />
          </div>
        </Overlay>
      )}
    </div>
  );
}

function statusIcon(status: ExerciseStatus) {
  if (status === "completed") return "✓";
  if (status === "skipped") return "–";
  if (status === "replaced") return "↷";
  return "○";
}

function reasonLabel(key: string) {
  const all = [
    ...SKIP_REASONS,
    ...END_EARLY_REASONS,
    { key: "equipment_busy", label: "Equipment busy" },
    { key: "equipment_unavailable", label: "Equipment unavailable" },
    { key: "pain_discomfort", label: "Pain / discomfort" },
    { key: "preference", label: "Prefer something else" },
    { key: "coach_adjustment", label: "Coach adjustment" },
    { key: "other", label: "Other" },
  ];
  return all.find((r) => r.key === key)?.label ?? key;
}

function roleLabel(role: string) {
  if (role === "warmup") return "Warm-up";
  if (role === "cooldown") return "Cool-down";
  if (role === "mobility") return "Mobility";
  if (role === "cardio") return "Cardio";
  return "Activity";
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-zinc-800 bg-zinc-900 p-5 pb-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function SheetButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}) {
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
    <button
      type="button"
      onClick={onClose}
      className="mt-3 w-full rounded-2xl py-3 text-base font-semibold text-zinc-500"
    >
      CLOSE
    </button>
  );
}
