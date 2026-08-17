import Link from "next/link";
import { notFound } from "next/navigation";
import { formatShortDate, formatWeight } from "@/lib/dates";
import { getSessionDetail } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getSessionDetail(Number(id));

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
        {detail.energyRating && (
          <p className="mt-1 text-zinc-400">Energy: {detail.energyRating}</p>
        )}
      </div>

      <div className="space-y-3">
        {detail.exercises.map((exercise, i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
          >
            <p className="text-lg font-semibold">{exercise.name}</p>
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
