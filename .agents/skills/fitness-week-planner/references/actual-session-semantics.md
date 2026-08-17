# Actual session semantics

The workout plan describes intended training. The workout session describes
actual training. When they differ, the session is authoritative for what the
user performed; the plan remains authoritative for what was prescribed.

## Rules

- Added exercises are real training — they count as actual resistance exposure.
- Replacements count toward the actual exercise performed, not the planned one.
  The original planned entry is preserved (status "replaced"), never deleted and
  never marked failed.
- Equipment-driven replacement is not performance failure.
- Pain-driven replacement is a safety signal.
- Warm-up sets are not working-set progression evidence; they never become the
  "latest performance" for an exercise.
- General warm-up, cardio, mobility and cool-down are not identical training
  stress. A 10-minute easy treadmill warm-up is not a 30-minute hard cardio
  session.
- Actual training history is authoritative for what the user performed.
- Planned history remains authoritative for what was prescribed.

## Measurement types

Not every exercise requires weight:

- `weighted_reps` — external load + reps.
- `bodyweight_reps` — no external load; reps are sufficient.
- `timed_hold` — seconds (e.g. plank).
- `duration` — time (mobility/stretching).
- `distance_duration` — duration with optional distance/speed/incline (treadmill).

Never block completion of a bodyweight or timed-hold movement because weight is
zero. Never run weighted e1RM estimates for bodyweight, timed-hold, duration or
cardio.
