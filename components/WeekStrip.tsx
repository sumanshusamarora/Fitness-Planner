"use client";

import type { WeekDayView } from "@/lib/week-view";

const ABBR = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function stateDot(status: WeekDayView["status"], isToday: boolean) {
  if (status === "completed") return "completed";
  if (isToday) return "today";
  if (status === "in-progress") return "in-progress";
  if (status === "ended_early") return "ended-early";
  if (status === "skipped") return "skipped";
  if (status === "missed") return "missed";
  if (status === "rest") return "rest";
  return "scheduled";
}

function labelFor(day: WeekDayView): string {
  if (day.origin === "extra") return "+";
  if (day.origin === "moved") return "↔";
  if (day.status === "ended_early") return "!";
  if (day.status === "skipped") return "–";
  if (day.exerciseCount === 0) return "·";
  const t = day.title.trim().toUpperCase();
  if (t.endsWith("A")) return "A";
  if (t.endsWith("B")) return "B";
  return t[0];
}

export function WeekStrip({
  days,
  onSelect,
}: {
  days: WeekDayView[];
  onSelect?: (day: WeekDayView) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((day) => {
        const dot = stateDot(day.status, day.isToday);
        return (
          <button
            key={day.planDayId}
            type="button"
            onClick={() => onSelect?.(day)}
            className="flex flex-col items-center gap-1.5 rounded-xl py-2"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {ABBR[day.dayNumber]}
            </span>
            <span className="flex h-7 w-7 items-center justify-center">
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                  dot === "completed" && "bg-emerald-500 text-zinc-950",
                  dot === "today" && "ring-2 ring-emerald-400 text-zinc-100",
                  dot === "in-progress" && "bg-emerald-500/30 ring-2 ring-emerald-400 text-emerald-300",
                  dot === "scheduled" && "bg-zinc-800 text-zinc-300",
                  dot === "rest" && "text-zinc-600",
                  dot === "missed" && "text-zinc-500",
                  dot === "ended-early" && "bg-amber-500/20 text-amber-300",
                  dot === "skipped" && "text-zinc-500",
                ].join(" ")}
              >
                {dot === "completed" ? "✓" : labelFor(day)}
              </span>
            </span>
            <span
              className={[
                "h-1 w-1 rounded-full",
                dot === "completed" && "bg-emerald-500",
                dot === "today" && "bg-emerald-400",
                dot === "in-progress" && "bg-emerald-400",
                dot === "scheduled" && "bg-zinc-600",
                dot === "rest" && "bg-transparent",
                dot === "missed" && "bg-zinc-700",
                dot === "ended-early" && "bg-amber-400",
                dot === "skipped" && "bg-zinc-700",
              ].join(" ")}
            />
          </button>
        );
      })}
    </div>
  );
}
