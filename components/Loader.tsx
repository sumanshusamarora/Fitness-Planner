"use client";

import { useEffect, useState } from "react";

export type LoaderContext =
  | "initial-week"
  | "next-week"
  | "extra-session"
  | "week-rebuild"
  | "saving";

const LOADER_MESSAGES: Record<LoaderContext, string[]> = {
  "initial-week": [
    "Reading your goals…",
    "Selecting your movements…",
    "Balancing your training week…",
    "Writing your plan…",
  ],
  "next-week": [
    "Reviewing last week…",
    "Checking your recovery…",
    "Applying progression…",
    "Drafting next week…",
  ],
  "extra-session": [
    "Planning your extra session…",
    "Picking the right exercises…",
    "Setting the effort…",
  ],
  "week-rebuild": [
    "Reading your feedback…",
    "Reworking your schedule…",
    "Rebalancing volume…",
    "Drafting your revised week…",
  ],
  saving: ["Saving your plan…"],
};

export function Loader({
  variant = "inline",
  context = "saving",
  messages,
  message,
  title,
  compact = false,
  intervalMs = 2000,
}: {
  variant?: "inline" | "overlay";
  context?: LoaderContext;
  messages?: string[];
  message?: string;
  title?: string;
  compact?: boolean;
  intervalMs?: number;
}) {
  const sequence = messages ?? LOADER_MESSAGES[context];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (message || sequence.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % sequence.length), intervalMs);
    return () => clearInterval(timer);
  }, [message, sequence, intervalMs]);

  const text = message ?? sequence[index % sequence.length];

  if (variant === "overlay") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      >
        <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          {title && <h2 className="mb-5 text-xl font-bold text-zinc-100">{title}</h2>}
          <Spinner size="lg" />
          <p key={text} className="loader-message mt-5 text-base font-semibold text-zinc-200">
            {text}
          </p>
          <p className="mt-2 text-xs text-zinc-500">Your coach is thinking</p>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <span role="status" className="inline-flex items-center justify-center">
        <Spinner size="sm" />
      </span>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-2">
      <Spinner size="md" />
      <p key={text} className="loader-message text-sm font-semibold text-zinc-300">
        {text}
      </p>
    </div>
  );
}

function Spinner({ size }: { size: "sm" | "md" | "lg" }) {
  const dims =
    size === "lg" ? "h-12 w-12 border-4" : size === "md" ? "h-6 w-6 border-2" : "h-4 w-4 border-2";
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-emerald-500 border-t-transparent ${dims}`}
    />
  );
}
