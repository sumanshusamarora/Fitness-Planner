import Link from "next/link";
import { notFound } from "next/navigation";
import { formatShortDate, formatWeight } from "@/lib/dates";
import { requireCurrentUser } from "@/lib/session";
import { getSessionDetail } from "@/lib/workouts";

export const dynamic = "force-dynamic";

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

      <div className="space-y-3">
        {detail.exercises.map((exercise, i) => (
          <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">{exercise.name}</p>
              {exercise.status === "skipped" && (
                <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400">
                  skipped{exercise.skipReason ? ` · ${exercise.skipReason}` : ""}
                </span>
              )}
              {exercise.status === "not_attempted" && (
                <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-500">not performed</span>
              )}
            </div>
            <div className="mt-2 space-y-1">
              {exercise.sets.map((set) => (
                <p key={set.setNumber} className="text-zinc-300">
                  {formatWeight(set.weightKg)} kg × {set.reps}
                  {set.rpe != null && ` @ RPE ${set.rpe}`}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
