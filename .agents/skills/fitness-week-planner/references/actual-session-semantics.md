# Actual session semantics

The workout plan describes intended training. The workout session describes
actual training. When they differ, the session is authoritative for what the
user performed; the plan remains authoritative for what was prescribed.

## Rules

- The **session-start snapshot** (`session_plan_snapshots` + `session_plan_snapshot_exercises`)
  freezes the exact prescription a workout began with (day, exercises, targets,
  recommended weights). It is written once at session start and never updated.
  The live plan is mutable future intent: once a session has started, later plan
  edits can never retroactively change what that session prescribed. When a
  snapshot is absent (legacy sessions), the live plan stands in.
- Added exercises are real training — they count as actual resistance exposure.
- Replacements count toward the actual exercise performed, not the planned one.
  The original planned entry is preserved (status "replaced"), never deleted and
  never marked failed.
- A replacement records the original it substituted via
  `replaces_session_exercise_id`, and its reason via `replacement_reason`
  (equipment_busy, equipment_unavailable, pain_discomfort, preference,
  coach_adjustment, other). The original row itself carries no replacement data.
- A replaced original can never receive sets — any set is logged on the
  replacement instead. Replace only a pending, zero-work planned exercise.
- **Restore Original** is allowed only while the session is in progress AND the
  replacement has zero actual sets (no warm-up, no working set). If the
  replacement has any set, restore is rejected and that logged work is never
  deleted. A replaced original with its own logged work is also not restorable.
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
