"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { routes } from "@/lib/routes";

const METRICS = [
  { key: "sleep", label: "Sleep", low: "poor", high: "great" },
  { key: "energy", label: "Energy", low: "low", high: "high" },
  { key: "soreness", label: "Soreness", low: "none", high: "very sore" },
  { key: "jointPain", label: "Joint pain", low: "none", high: "severe" },
  { key: "stress", label: "Stress", low: "low", high: "high" },
] as const;

type RatingKey = (typeof METRICS)[number]["key"];

export function RecoveryCheck({ planDayId }: { planDayId: number | null }) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Partial<Record<RatingKey, number>>>({});
  const [busy, setBusy] = useState(false);

  const allDone = METRICS.every((m) => ratings[m.key] != null);

  async function submit(includeRatings: boolean) {
    if (!planDayId) return;
    setBusy(true);
    const endpoint = includeRatings ? "/api/recovery" : "/api/sessions";
    const body = includeRatings
      ? JSON.stringify({ planDayId, ratings })
      : JSON.stringify({ planDayId });
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = (await res.json()) as {
      sessionId?: number;
      weekId?: number | null;
      dayId?: number | null;
    };
    if (data.sessionId) {
      if (data.weekId != null && data.dayId != null) {
        router.push(routes.session(data.weekId, data.dayId, data.sessionId));
        return;
      }
      router.push(`/workout/${data.sessionId}`);
    } else {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">How are you today?</h1>
        <p className="mt-1 text-zinc-400">Quick check before you lift.</p>
      </div>

      {METRICS.map((m) => (
        <div
          key={m.key}
          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-lg font-semibold">{m.label}</p>
            <p className="text-xs text-zinc-500">
              {m.low} · {m.high}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRatings((r) => ({ ...r, [m.key]: n }))}
                className={`h-11 rounded-xl border text-base font-semibold transition active:scale-95 ${
                  ratings[m.key] === n
                    ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                    : "border-zinc-700 bg-zinc-800 text-zinc-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => submit(true)}
        disabled={!allDone || busy}
        className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
      >
        CONTINUE
      </button>
      <button
        type="button"
        onClick={() => submit(false)}
        disabled={busy}
        className="w-full rounded-2xl py-3 text-base font-semibold text-zinc-400"
      >
        Skip for now
      </button>
    </div>
  );
}
