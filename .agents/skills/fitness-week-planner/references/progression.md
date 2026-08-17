# Progression

The application owns deterministic progression. For each planned exercise it
calculates set completion, rep-range performance, latest/average RPE, load,
and a recent exposure trend.

- Increase load only when all prescribed sets reach the top of the rep range at
  or below target RPE, with no meaningful pain and adequate recovery.
- Keep load when reps remain in range but have not reached the top. This is rep
  progression, not stagnation.
- Keep load when effort is materially above target RPE.
- Reduce load when minimum reps are missed, unless pain/uncertainty requires a
  question instead.
- Use the smallest practical increment. Do not prescribe failure by default.

Current-week performance has priority. Several recent exposures help distinguish
one poor session from a trend, but do not override a clear current safety flag.

## Incomplete sessions must not become false performance signals

Only **actually attempted sets** feed progression. Never infer a failed lift
from work that was never performed.

- **Navigation (next/previous)** — calendar movement only. No performance meaning.
- **Skipped exercise, equipment busy** — no performance judgement; keep the load.
- **Skipped exercise, short on time / work / family** — an adherence or schedule
  signal, not a strength result; do not reduce weight for it.
- **Skipped exercise, pain/discomfort** — a safety signal; ask whether pain is
  current before progressing that movement.
- **Ended early, time / work / family** — do not automatically reduce next week's
  loads; treat as schedule pressure, not fatigue.
- **Ended early, not feeling well** — a recovery context; keep the next week
  conservative.
- **Ended early, pain** — a safety signal; hold or reduce the affected movement
  and seek assessment if it persists.
- **Set attempted but reps below target** — an actual performance signal; apply
  the normal hold/reduce rules.

Skipped and ended-early sessions do not count as completed workouts in progress
indicators, but they remain auditable outcomes the coach can see.
