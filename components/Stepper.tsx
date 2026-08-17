"use client";

interface StepperProps {
  label: string;
  value: number;
  step: number;
  unit: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Stepper({
  label,
  value,
  step,
  unit,
  format,
  onChange,
}: StepperProps) {
  const display = format ? format(value) : String(value);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-400">
        {label}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - step))}
          className="h-14 w-14 shrink-0 rounded-2xl bg-zinc-800 text-3xl font-bold text-zinc-100 transition active:scale-95"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="text-3xl font-bold tabular-nums">
          {display}{" "}
          <span className="text-base font-medium text-zinc-400">{unit}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(value + step)}
          className="h-14 w-14 shrink-0 rounded-2xl bg-zinc-800 text-3xl font-bold text-zinc-100 transition active:scale-95"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
