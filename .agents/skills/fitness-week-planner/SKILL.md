---
name: fitness-week-planner
description: >
  Review this fitness app's local training history and recovery, then build a
  reviewable next-week or first-week proposal, or handle intra-week schedule
  changes. Use when the user asks to (1) plan their next workout week or
  generate Week 2/3+, (2) build a brand-new user's first week from their
  training profile, (3) review last week's training, recovery, or progression,
  (4) adjust their resistance-training program based on completed workouts, or
  (5) change this week's schedule: move/swap a workout, train on a rest day, or
  add an extra session. Do not use for unrelated app coding, styling, database
  maintenance, or general fitness questions without local plan data.
license: MIT
compatibility: Requires this repository's local PostgreSQL database and npm scripts.
metadata:
  author: fitness-planner
  version: 1.2.0
allowed-tools: Read Glob Grep Bash(npm run coach:*)
---

# Fitness week planner

Use the application's coaching domain layer. It calculates training facts from
PostgreSQL and keeps plan writes behind a confirmation boundary. Schedule
changes go through the same proposal → confirmation → apply path as weekly
planning.

> **Runtime AI coach:** In production, an optional GPT-5 reasoner
> (`lib/coach/reasoners/openai.ts`, via the shared `CoachReasoner` interface and
> `lib/coach/ai/runCoach.ts`) augments first-week, next-week and extra-session
> proposals when `OPEN_API_KEY` is set. It is read-only and always falls back to
> the deterministic engine in this skill. The `npm run coach:*` CLI described
> below always drives the deterministic path, so this skill's workflow is
> unchanged.

## Workflow

- [ ] Read only the references relevant to the decision: always `safety.md`,
  then progression, longitudinal adaptation, week feedback and rebuild,
  recovery, beginner training, exercise selection, scheduling, or research
  policy as needed.
- [ ] Run `npm run coach -- users` to find the active user, then pass
  `--user <id|username>` to every command below.
- [ ] Run `npm run coach -- context --user <u>` to inspect the compact structured context.
- [ ] Run `npm run coach -- propose --user <u>` to create or retrieve the persisted
  next-week proposal. This does **not** create a workout plan.
- [ ] Present only important changes, evidence, recovery context, confidence,
  and any material questions.
- [ ] If questions are present, ask them concisely and stop. Do not approve a
  proposal with `needs-input` confidence.
- [ ] After the user answers, record only that answer with
  `npm run coach -- answer <proposal-id> <question-id> <answer> --user <u>` and
  review the conservative updated proposal before requesting approval.
- [ ] Ask for explicit approval after the user has reviewed a viable proposal.
- [ ] Only after an unambiguous approval, run
  `npm run coach -- approve <proposal-id> --confirm --user <u>`.
- [ ] Run `npm run coach -- show <proposal-id> --user <u>` and confirm that the
  plan was applied exactly once. Never use SQL inserts from this skill.

## Moving vs adding — do not confuse them

- **MOVING a workout** is a calendar change. The prescription (exercises, sets,
  reps, RPE, weights, rest) moves intact. Never regenerate a replacement
  workout. A move/swap requires no coaching reasoning and no new training stress.
- **ADDING a workout** creates new training stress and requires coaching
  analysis: adjacent-session overlap, muscle/movement exposure, volume, recovery,
  pain, phase, and adherence. An extra session should complement the week, not
  repeat it. Default to Light; downgrade a Heavy request when recovery, pain,
  phase, or overlap make it inappropriate.

## First-week vs next-week

- A **first-week** proposal (`proposal_type: initial_week`, no source plan) is
  generated from the user's training profile and conservative defaults. There
  is no history to progress from, so every exercise is a starting load.
- A **next-week** proposal is generated from the completed source week. Only
  attempted sets feed progression; see `references/progression.md` for how
  skipped, ended-early, and unattempted work must be interpreted.

## Safety and data rules

> **Safety:** meaningful joint/tendon pain blocks automatic progression. Do
> not diagnose injury. Ask whether pain is current and recommend qualified
> medical or physiotherapy assessment for persistent or significant pain.

- ALWAYS use `lib/coach` and the controlled CLI, not ad hoc SQL.
- NEVER treat proposal generation as permission to create an active week.
- NEVER silently edit this skill or its reference knowledge from training data.
- PREFER the deterministic recommendation when the data can decide safely.
- Use web research only under `references/research-policy.md`.
- The canonical `exercises` table stays authoritative. The external exercise
  catalogue is reference/discovery data only; an approved mapping enriches an
  exercise, it never silently replaces one. See `references/exercise-catalogue.md`.

## References

- [Progression](references/progression.md) — load/reps/RPE decisions and incomplete-session interpretation.
- [Longitudinal adaptation](references/longitudinal-adaptation.md) — performance, tolerance, adaptation rate, and plateau (deterministic analytics the coach interprets).
- [Actual session semantics](references/actual-session-semantics.md) — plan vs actual, added/replaced work, warm-up sets, and measurement types.
- [Week feedback and rebuild](references/week-feedback-and-rebuild.md) — rebuilding the remaining week from structured feedback.
- [Initial programming](references/initial-programming.md) — building a new user's first week.
- [Recovery](references/recovery.md) — recovery and missed-session signals.
- [Beginner training](references/beginner-training.md) — return-to-training guardrails.
- [Exercise selection](references/exercise-selection.md) — substitutions and stability.
- [Exercise catalogue](references/exercise-catalogue.md) — external reference/discovery data and mapping rules.
- [Scheduling](references/scheduling.md) — intra-week flexibility and rest-day sessions.
- [Future-plan reversibility](references/reversibility.md) — Remove Extra vs Skip, move/swap restore, Cancel Start, and Undo Skip; historical states are immutable and reversals are deterministic (never GPT-5).
- [Coaching principles](references/coaching-principles.md) — general programming decisions.
- [Safety](references/safety.md) — pain and scope boundaries. Load every time.
- [Research policy](references/research-policy.md) — when external research is justified.

## Ground rules

- ALWAYS keep the summary visual and short: change, reason, evidence, confidence.
- NEVER add load merely because a workout was completed.
- NEVER make permanent methodology changes from a weekly outcome.
- PREFER conservative holds when data are incomplete but not materially unsafe.
