import Link from "next/link";
import { notFound } from "next/navigation";
import { formatShortDate, formatWeight } from "@/lib/dates";
import { requireCurrentUser } from "@/lib/session";
import { getSessionDetail } from "@/lib/workouts";

export const dynamic = "force-dynamic";

const ACTIVITY_ROLE_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  cardio: "Cardio",
  mobility: "Mobility",
  cooldown: "Cool-down",
  other: "Activity",
};

function minutes(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "";
  return ` · ${Math.round(seconds / 60)} min`;
}

const REPLACEMENT_REASON_LABELS: Record<string, string> = {
  equipment_busy: "Equipment busy",
  equipment_unavailable: "Equipment unavailable",
  pain_discomfort: "Pain / discomfort",
  preference: "Prefer something else",
  coach_adjustment: "Coach adjustment",
  other: "Other",
};

function reasonLabel(key: string): string {
  return REPLACEMENT_REASON_LABELS[key] ?? key;
}

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const detail = await getSessionDetail(user.id, Number(id));

  if (!detail) notFound();

  return (
    <div>
      <Link href="/history" className="text-sm text-zinc-400">
        ← History
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold">{detail.title}</h1>
        <p className="mt-2 text-zinc-400">
          {formatShortDate(new Date(detail.startedAt))} · {detail.durationText}
        </p>
        {detail.status !== "completed" && (
          <p className={`mt-1 font-semibold ${detail.status === "ended_early" ? "text-amber-400" : "text-zinc-500"}`}>
            {detail.status === "ended_early" ? "Ended early" : "Skipped"}
            {detail.endReason && ` · ${detail.endReason}`}
          </p>
        )}
        {detail.energyRating && <p className="mt-1 text-zinc-400">Energy: {detail.energyRating}</p>}
      </div>

      {detail.activities.length > 0 && (
        <div className="mb-4 space-y-2">
          {detail.activities.map((activity) => (
            <div key={activity.id} className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-400">
                  {ACTIVITY_ROLE_LABEL[activity.activityRole] ?? activity.activityRole}
                </span>
                <span className="font-semibold">{activity.name}</span>
              </div>
              <span className="text-sm text-zinc-400">{minutes(activity.durationSeconds)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {detail.exercises.map((exercise, i) => (
          <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold">{exercise.name}</p>
                {exercise.replacesName && (
                  <p className="text-sm text-violet-400">
                    Replaced {exercise.replacesName}
                    {exercise.replacementReason ? ` · ${reasonLabel(exercise.replacementReason)}` : ""}
                  </p>
                )}
                {exercise.replacedByName && (
                  <p className="text-sm text-zinc-500">
                    Replaced by {exercise.replacedByName} — didn&apos;t run
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {exercise.origin === "added" && (
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-400">Added</span>
                )}
                {exercise.origin === "replacement" && (
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-400">
                    Replaced
                  </span>
                )}
                {exercise.status === "replaced" && (
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">replaced</span>
                )}
                {exercise.status === "skipped" && (
                  <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400">
                    skipped{exercise.skipReason ? ` · ${exercise.skipReason}` : ""}
                  </span>
                )}
                {exercise.status === "not_attempted" && (
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-500">not performed</span>
                )}
              </div>
            </div>
            <div className="mt-2 space-y-1">
              {exercise.sets.map((set) => (
                <p key={set.setNumber} className="text-zinc-300">
                  {formatWeight(set.weightKg)} kg × {set.reps}
                  {set.rpe != null && ` @ RPE ${set.rpe}`}
                  {set.setType === "warmup" && <span className="ml-2 text-xs text-zinc-500">warm-up</span>}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
