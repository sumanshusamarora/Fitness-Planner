import Link from "next/link";
import { formatShortDate } from "@/lib/dates";
import { getSessionHistory, getSessionSummary } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const entries = await getSessionHistory();

  if (entries.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold">No workouts yet</h1>
        <p className="mt-2 text-zinc-400">
          Complete a workout and it will appear here.
        </p>
      </div>
    );
  }

  const summaries = await Promise.all(
    entries.map((entry) => getSessionSummary(entry.id)),
  );

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">History</h1>
      <div className="space-y-3">
        {summaries.map((summary) =>
          summary ? (
            <Link
              key={summary.id}
              href={`/history/${summary.id}`}
              className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">{summary.title}</p>
                <p className="text-sm text-zinc-500">
                  {formatShortDate(new Date(summary.startedAt))}
                </p>
              </div>
              <p className="mt-1 text-sm text-zinc-400">
                {summary.exerciseCount} exercises · {summary.setCount} sets ·{" "}
                {summary.durationText}
              </p>
            </Link>
          ) : null,
        )}
      </div>
    </div>
  );
}
