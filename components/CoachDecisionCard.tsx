"use client";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  needs_input: "Needs your input",
  "needs-input": "Needs your input",
};

export function CoachDecisionCard({
  confidence,
  rationale,
  safetyFlags,
  model,
  children,
}: {
  confidence?: string | null;
  rationale?: string[] | null;
  safetyFlags?: string[] | null;
  model?: string | null;
  children?: React.ReactNode;
}) {
  const bullets = rationale?.filter(Boolean).slice(0, 3) ?? [];
  const safety = safetyFlags?.filter(Boolean)[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          Coach suggestion
        </p>
        {model && <p className="text-xs text-zinc-500">{model}</p>}
      </div>

      {confidence && (
        <span className="inline-block rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
          {CONFIDENCE_LABEL[confidence] ?? confidence}
        </span>
      )}

      {bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
          {bullets.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      )}

      {safety && (
        <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-300">{safety}</p>
      )}

      {children}
    </div>
  );
}
