---
name: fitness-week-planner
description: >
  Review this fitness app's local training history and recovery, then build a
  reviewable next-week proposal. Use when the user asks to (1) plan their next
  workout week or generate Week 2/3+, (2) review the last week's training,
  recovery, or progression, or (3) adjust their resistance-training program
  based on completed workouts. Do not use for unrelated app coding, styling,
  database maintenance, or general fitness questions without local plan data.
license: MIT
compatibility: Requires this repository's local PostgreSQL database and npm scripts.
metadata:
  author: fitness-planner
  version: 1.0.0
allowed-tools: Read Glob Grep Bash(npm run coach:*)
---

# Fitness week planner

Use the application's coaching domain layer. It calculates training facts from
PostgreSQL and keeps plan writes behind a confirmation boundary.

## Workflow

- [ ] Read only the references relevant to the decision: always `safety.md`,
  then progression, recovery, beginner training, exercise selection, or
  research policy as needed.
- [ ] Run `npm run coach -- context` to inspect the compact structured context.
- [ ] Run `npm run coach -- propose` to create or retrieve the persisted
  proposal. This does **not** create a workout plan.
- [ ] Present only important changes, evidence, recovery context, confidence,
  and any material questions.
- [ ] If questions are present, ask them concisely and stop. Do not approve a
  proposal with `needs-input` confidence.
- [ ] After the user answers, record only that answer with
  `npm run coach -- answer <proposal-id> <question-id> <answer>` and review
  the conservative updated proposal before requesting approval.
- [ ] Ask for explicit approval after the user has reviewed a viable proposal.
- [ ] Only after an unambiguous approval, run
  `npm run coach -- approve <proposal-id> --confirm`.
- [ ] Run `npm run coach -- show <proposal-id>` and confirm that the plan was
  applied exactly once. Never use SQL inserts from this skill.

## Safety and data rules

> **Safety:** meaningful joint/tendon pain blocks automatic progression. Do
> not diagnose injury. Ask whether pain is current and recommend qualified
> medical or physiotherapy assessment for persistent or significant pain.

- ALWAYS use `lib/coach` and the controlled CLI, not ad hoc SQL.
- NEVER treat proposal generation as permission to create an active week.
- NEVER silently edit this skill or its reference knowledge from training data.
- PREFER the deterministic recommendation when the data can decide safely.
- Use web research only under `references/research-policy.md`.

## References

- [Progression](references/progression.md) — load/reps/RPE decisions.
- [Recovery](references/recovery.md) — recovery and missed-session signals.
- [Beginner training](references/beginner-training.md) — return-to-training guardrails.
- [Exercise selection](references/exercise-selection.md) — substitutions and stability.
- [Coaching principles](references/coaching-principles.md) — general programming decisions.
- [Safety](references/safety.md) — pain and scope boundaries. Load every time.
- [Research policy](references/research-policy.md) — when external research is justified.

## Ground rules

- ALWAYS keep the summary visual and short: change, reason, evidence, confidence.
- NEVER add load merely because a workout was completed.
- NEVER make permanent methodology changes from a weekly outcome.
- PREFER conservative holds when data are incomplete but not materially unsafe.
