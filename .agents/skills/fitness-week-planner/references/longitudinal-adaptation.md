# Longitudinal adaptation

The application computes deterministic progress analytics before the coach
reasons. These are authoritative facts the coach interprets — the coach must
not recalculate them from raw workout rows.

## The four dimensions

- **Performance** — what the user can currently do, per movement (load, reps,
  RPE, estimated capacity where meaningful, exposure count).
- **Training tolerance** — how much useful training they currently appear able
  to recover from (completed sets, adherence, effort vs target, recovery and
  soreness trend, pain, ended-early/skipped context).
- **Adaptation rate** — how quickly performance/tolerance are changing
  (improving fast / improving / improving slowly / flat / declining /
  insufficient data), with a numerical rate only where it is meaningful.
- **Plateau** — a *sustained* lack of improvement after confounders are
  accounted for (none / possible / likely / insufficient data), with reasons.

Only **attempted** sets influence capability. Equipment-busy, work/family and
time-pressure skips carry no performance signal; ended-early and unattempted
work carry none either. Attempted sets that miss target reps are real
performance evidence.

## Rules

- Do not expect indefinite linear progression. Returning and novice trainees
  improve quickly at first; as capability rises, progress becomes less frequent
  and less linear.
- Do not treat one flat week — or one bad session — as a plateau. Require
  multiple valid exposures before concluding anything.
- Do not automatically add volume, frequency, intensity, or proximity to
  failure when progress slows. Slower progress can be normal adaptation.
- Distinguish scheduling / adherence issues from physical stagnation. Missed
  work/family sessions and equipment-busy skips are not poor tolerance.
- Use multiple exposures; prefer trends over individual sessions.
- Deterministic analytics are factual/authoritative. The coach interprets them
  and decides how programming should respond.
- Prefer the minimum effective intervention.
- RPE matters: load + reps + effort together. 20kg × 12 @ RPE 6 is progress
  over 20kg × 10 @ RPE 8 even though the load is unchanged.

## Where it plugs in

Deterministic analytics (training history → performance trend, tolerance,
adaptation rate, plateau evidence) are exposed on the coaching context as
`progress`, alongside the short rolling recovery window and the next-7-days
plan. The coach reads both: the 7–14 day window answers "am I recovered now",
the longitudinal analytics answer "am I actually improving, and is my
recoverability changing".
