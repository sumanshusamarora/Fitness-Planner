# Week feedback and rebuild

Rebuilding the current week is normal adaptive coaching, not user failure.
Completed sessions are immutable history; only legal current/future plan days
may change, and only after explicit approval.

## Principles

- Distinguish schedule issues from recovery/performance issues. "I can't train
  Friday" is a move; "I can only train Saturday and Sunday" is a rebuild.
- Use structured feedback plus actual data (completed sets, RPE, recovery,
  progress analytics) — never feedback alone.
- Preserve successful elements of the existing plan where possible.
- Prefer the minimum effective change.
- Do not treat a rebuild request as a reason to re-plan everything.
- Do not map "too difficult" to "reduce every weight" — consider volume,
  frequency, session length, exercise complexity, recovery and schedule.
- Do not map "too easy" to "make everything heavy" — check RPE, rep completion,
  recovery, adaptation rate and training stage first.
- Consider longitudinal adaptation analytics (performance, tolerance,
  adaptation rate, plateau) when deciding how to respond.
- Use feedback patterns cautiously over time — one old complaint must not
  permanently dominate programming.
- Require explicit user approval before any week rebuild is applied.

## Feedback categories

`too_difficult`, `too_easy`, `too_many_days`, `too_few_days`,
`sessions_too_long`, `schedule_changed`, `poor_recovery`, `pain`,
`exercise_preference`, `equipment_problem`, `other`.

Pain is a safety signal: avoid aggressive progression, identify affected work,
ask for clarification when materially necessary, and never diagnose.

## Flow

feedback → week rebuild context → GPT-5 (or deterministic fallback) →
structured `WeekRebuildProposal` → hard deterministic validation → user review →
explicit approval → controlled apply.

Completed training is immutable. GPT-5 may only propose changes to legal
current/future training. The user must approve before any week rebuild is
applied.
