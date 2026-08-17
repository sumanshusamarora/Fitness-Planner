# Phase 2.6 product journey and state-hardening investigation

Date: 2026-08-17  
Scope: investigation only. No product, schema, migration, prompt, component, or test behavior was changed. The repository was already dirty with the verified, complete Phase 2.5 work and the Phase 2.6 investigation files listed in `git status`; findings describe that on-disk worktree rather than an earlier report.

Related references: [state map](../product-state-map.md) and [journey audit](../product-journey-audit.md).

## Baseline and audit method

| Check | Result |
|---|---|
| `npm test` | PASS — 88/88 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Safe product data inspection | `fitness-test` profile has Week 1 with two planned sessions and bodyweight Dead Bug/Glute Bridge; no data was seeded, reset, or changed |
| Runtime/mobile inspection | Existing server occupied port 8881; unauthenticated requests redirected to profile flow. In-app browser automation was unavailable, so no visual screenshots were added. Component/layout and route-contract inspection supplied the mobile observations. |

## Executive findings

### P0 — protect actual history and prevent duplicate outcomes

1. **Sessions are not state-safe.** `POST /api/sessions` calls `createSession` without verifying that the day is a workout, without returning an existing in-progress session, and without preventing duplicate start attempts. `finishSession`, `endSessionEarly`, set logging, activity CRUD, exercise completion/skip, added exercise, and replacement only check ownership in several paths—not that the session is `in_progress`.

2. **Moving can mutate an in-progress day.** Scheduling considers a day immutable only when `completedAt` is set. A live session has no `completedAt`, so a move/swap can change the plan content under the session that is recording actual activity. Move/add proposals also have no state hash.

3. **Restore replacement can delete actual work.** `restoreSessionExercise` deletes the replacement row and its sets with no check that the replacement is empty or the session remains in progress. Its API is present, but no mobile restore action exists.

4. **Finalised history is mutable through hidden APIs.** A user cannot edit from History UI, but mutations remain accepted after completed/ended-early. This is more dangerous than an explicit correction flow because it is invisible, unaudited, and can poison progression.

### P1 — users get trapped or receive wrong semantics

1. **Extra cannot be removed.** Case A is confirmed: an extra day is just a plan day with `origin='extra'`; the day sheet offers Start, Move, Skip. Skip creates a `workout_sessions.status='skipped'` outcome and changes adherence/history instead of returning to Rest.

2. **No restore for moved days or applied rebuilds.** `origin='moved'` is neither a source reference nor a revision. A rebuild destructively rewrites future plan exercises and then clears `origin`, so it cannot reconstruct “before.”

3. **“Undo skip” is deceptive.** Active Workout changes the client card to pending but never asks the server to reverse the skip. A refresh returns to skipped.

4. **Newly complete Phase 2.5 capabilities need Phase 2.6 escape hatches.** Added strength, activities, and replacement capture are implemented and persisted. The hardening question is whether a user can visibly remove/recover from a provisional added exercise, activity, or replacement; those actions are absent or unsafe in the current mobile flow.

5. **Relative “+1/+2” is confirmed.** The `too_few_days` follow-up is `additional_days` with `+1/+2`; the deterministic rebuild adds those days relative to the current remaining plan, including an existing extra. This causes the reported compound six-day result.

6. **Measurement-aware capture is complete; legacy plan semantics still need a Phase 2.6 decision.** The helper correctly classifies bodyweight and timed holds; UI now omits the weight control for those types and progress e1RM filters to `weighted_reps`. Legacy `duration`/`distance_duration` exercises can still sit in the set-based planned-workout structure, where their current interaction is not semantically clear. Decide in Phase 2.6 whether to support that prescribed form explicitly or constrain those types to actual activity capture until a later cardio model.

## Phase 2.5 status — complete, now under Phase 2.6 audit

Phase 2.5 is **COMPLETE**. The current worktree contains the verified migration, domain, UI, history, analytics, coach-context, prompt, and skill-reference foundations listed in the task update: plan-vs-actual rows, added/replacement work, activity capture, warm-up/working sets, measurement-aware bodyweight/timed logging, summaries/context, and feedback injection.

| Completed capability now being audited | Phase 2.6 hardening question (not a claim that Phase 2.5 is unimplemented) |
|---|---|
| Plan versus actual resistance rows | Does a started session retain a prescription snapshot when future planning changes, and can History explain prescribed versus performed? |
| Warm-up/cardio/mobility/cool-down activities | Can a user edit/remove an accidental provisional activity, then clearly see the final factual activity after completion? |
| Added strength | Can the user add it from the intended mobile flow and remove it only before it has actual work? |
| Manual replacement | Can the user restore it only before work; after work, does the recorded replacement/reason remain immutable and understandable? |
| Warm-up versus working sets | Are their visual meaning, correction rules, and analytics boundaries clear? |
| Measurement-aware logging | Are bodyweight/timed states clear, and what is the explicit policy for legacy prescribed `duration`/`distance_duration` work? |
| Actual-work coach context | Does it receive actual extras/replacements/activity dose without changing adherence or losing ended-early work? |
| Recent feedback in initial/next AI context | Complete: `OpenAICoachReasoner.proposeInitialWeek` and `.proposeNextWeek` call `getRecentWeekFeedbackSummary`; prompts include the v3 plan-vs-actual and measurement cores. |

## Adherence policy and current defects

Recommended metric: **prescribed-intent adherence = completed prescribed sessions / prescribed sessions whose scheduled opportunity has passed or has a recorded outcome**. Exclude future days, Rest days, and optional extras from the denominator. Show extra activity beside—not inside—the percentage. Do not cap a separate extra-activity count; simply do not use it to make adherence exceed 100%.

| Outcome | Recommended adherence | Actual workload / coach context |
|---|---|---|
| Planned completed | numerator and denominator | planned working sets performed |
| Planned skipped | denominator only; reason is context | no performance failure inferred |
| Planned moved then completed | follows prescribed session once | same prescription, different date |
| Extra added then removed | no effect | no actual work |
| Extra skipped | no prescribed denominator; record optional intent separately if useful | scheduling preference signal only |
| Extra completed | no numerator; label “extra session completed” | actual workload increases |
| Replacement completed | preserves planned-session adherence if session completes; do not mark original failed | actual replacement/muscle exposure + reason |
| Exercise skipped, equipment | no strength failure; session adherence is independent | equipment signal |
| Exercise skipped, pain | no strength failure; safety signal | pain flag |
| Ended early, work/family | no session numerator | actual completed work + schedule constraint |
| Ended early, unwell/pain | no session numerator | recovery/safety signal |
| Added sets | no adherence change | actual workload increases |

Current `assembleTolerance` first derives adherence from finished sessions (`completed / finished`) while it displays a different planned denominator. It cannot implement the policy above reliably, especially with extras and duplicate outcomes. This blocks trustworthy Phase 3 adherence visualization and Phase 6 tolerance inference.

## Plan versus actual policy

The product must retain two records:

- **Prescription snapshot at start:** planned day/exercise identity, ordered prescription, plan revision ID/version, and origin context.
- **Actual session:** status, actual resistance rows, set role/measurement fields, activities, reasons, and summary.

The plan can then change on future days without altering what was prescribed for a started/completed session. Current session rows preserve exercise and suggested weight, but `getActiveWorkoutData` reads target sets/reps/RPE/live plan entries; a move/rebuild race can therefore alter a running session’s apparent prescription. History mainly displays actual work and badges—not a prescribed-versus-performed comparison.

## State forensic matrix

This is the compact answer to “what happens when a user gets here?” It uses the proposed policy as the expected column. GPT-5 sees only compact factual context after the deterministic transition; it never owns the transition.

| State | How it is reached / what user sees now | Current DB and metric effect | Expected recovery, refresh, and concurrent-plan behavior |
|---|---|---|---|
| Rest | Original rest card; Train Today / Move here | plan day has zero exercises, no session; no adherence denominator | Add extra is reviewable. Refresh unchanged. An accepted extra must be removable until any session exists. |
| Scheduled planned day | Generated plan or restored content; Start / Move / Skip | plan exercises exist, `origin=null`; denominator intent exists | Start must atomically resume-or-create one session. A stale adjustment must reject/review again. |
| Extra unstarted | Rest-day proposal applied; `extra` badge; Start / Move / Skip | exercises inserted and `origin='extra'`; today it is incorrectly counted as an ordinary workout by several aggregations | **Remove extra** deletes only future addition and restores Rest without session/adherence history. GPT sees no extra after removal. |
| Moved unstarted | Move/swap applied; `moved` badge | exercises move between existing day IDs; `origin` does not say source | **Restore original day** must use revision provenance, not guess from badge. If any affected day starts, restore refuses and explains. |
| In-progress, empty | Start created session rows; card Resume | session `in_progress`; no terminal outcome; current API permits duplicates/moves | Cancel start may delete the provisional session only when no actual row/outcome exists. Refresh resumes. Competing start returns same session. |
| In-progress with actual work | Set/activity/replacement/addition written | actual history already exists, but current APIs still allow plan mutations/history writes | Freeze plan snapshot and block plan-day reversal/rebuild on this day. Resume after refresh. GPT sees factual actual work, not mutable prescription. |
| Completed | Finish flow; View workout | session completed and remaining pending marked not attempted; current hidden APIs can still mutate it | Immutable. Corrections need a distinct audited feature, never delete/update rows. Progress reads working sets only. |
| Ended early | End Early reason; View outcome | terminal session + remaining not attempted; actual completed sets retained | Immutable. No automatic strength penalty for schedule reasons; recovery/pain reason affects coach context. |
| Skipped session | Skip reason from day sheet | inserted terminal `skipped` session; current route permits duplicate/after-complete skip | Immutable prescribed outcome. Extra skip is optional-intent data, not adherence denominator. |
| Planned exercise pending | Session created | session-exercise `planned/pending` | Replace/skip/log only in-progress. Refresh restores actual server state and unsaved drafts need persistence/disclosure. |
| Replacement selected, no work | Replace route marks original `replaced`, inserts linked replacement | provenance/reason exists; current UI has no Restore | Restore original is legal only here. It must not delete a non-empty replacement. GPT later sees replacement only once actual work exists. |
| Replacement with work | At least one replacement set | actual movement performed; original correctly remains planned/replaced | Becomes history; Restore is not available. Progress/exposure belongs to actual exercise; planned adherence remains session-level. |
| Added exercise, no work | Added-strength capture is implemented; the current visible workout menu does not expose its addition/removal lifecycle | `origin='added'`, pending | Mobile should offer it. Remove is legal before a set; it never changes prescribed adherence. |
| Warm-up / cardio / mobility activity | Generic add-activity sheet | activity row; current UI sends duration-only defaults | Edit/remove while in progress. At finalisation immutable; present separately from working resistance and send factual dose to coach. |
| Rebuild draft/awaiting input | Feedback modal; review questions | feedback + proposal persisted; no plan change | Keep Current Week should set/reveal rejected (or safely retire). Recompute answers against latest state. |
| Rebuild stale | Any future change after proposal generation | state hash mismatch blocks apply | Clear “week changed” message and one-tap new review. No partial apply. |
| Rebuild applied | Accept Changes | current service deletes/recreates future exercise rows and clears origin | Persist before/after revision snapshot. Restore Remaining Week touches only untouched future days and reports exclusions. |

## GPT-5 context gaps in the current state

`buildRecentActualSummary` is supplied to rolling/rebuild context and captures completed-session activity minutes, added/replacement working sets, and replacement patterns. It is a useful start, but cannot answer “how far did actual workload exceed prescription this week?” because it omits ended-early work and is not paired with per-session prescribed totals. The next-week training context also derives its exercise model from current plan exercises and completed sessions, not a start-time prescription snapshot. This can misrepresent moved/rebuilt plans and undercount actual extra/cardio dose. The deterministic state/data slices must fix that before expanding GPT-5 prompts.

## Week rebuild assessment

Strengths: structured feedback, explicit review/acceptance, deterministic validator/fallback, preserve in-progress/completed/ended/skipped days, transaction/idempotence, and `state_hash` stale protection are sound foundations. “Keep current week” safely closes without applying.

Required hardening:

- Replace `too_few_days: additional_days +1/+2` with total training days. Show current total broken down as prescribed/moved/extra and show the proposed total before acceptance.
- Make “too many days” similarly explain its current count and distinguish reduce planned days from remove optional extras.
- Preserve a before snapshot and `plan_revision` record for every accepted rebuild. `restoreRemainingWeek` should only affect still-future, unstarted days; it must refuse or partially explain an intervening day that became historical.
- Make rejection explicit (`status='rejected'`), or retire draft proposals deterministically. Drafts should not silently accumulate.
- Show what is preserved, what becomes Rest, which additions are optional extras, and whether actual workload already exceeded plan. Do not use a rebuild to compound implicit modifications.

## GPT-5 boundary assessment

Appropriate current use: initial/next-week reasoning, extra-session prescription (new training stress), and feedback-driven rebuild proposal. Each has deterministic constraints/validation and an approval boundary. Future intelligent substitution belongs in Phase 4.

Must remain deterministic: Start/resume-or-create session, remove extra, move/swap/restore day, restore original exercise, activity/set correction validation, adherence calculation, measurement validation, state hashing, stale detection, and history ownership. GPT-5 should never be called to perform those operations.

## Fitness planner skill alignment

The skill now explicitly documents actual-vs-planned, warm-up, replacement, measurement types, feedback/rebuild, longitudinal adaptation, safety, and schedule/add distinction. It does **not** yet fully specify:

1. the lifecycle/immutability threshold for accidental starts, provisional activity, and corrections;
2. remove-extra and restore-move operations and their exact adherence meaning;
3. a non-destructive replacement-restore rule;
4. the authoritative prescribed-intent adherence formula and extra-session reporting;
5. applied rebuild revision/restore semantics and compounding prevention; or
6. measurement storage/contracts for assisted reps, duration, and distance-duration.

Those should be added after this product policy is approved, not inferred by an agent while implementing.

## Minimum schema and domain recommendations

Do **not** add universal event sourcing. Explicit domain operations fit this app better: `removeExtraSession`, `restoreMovedWorkout`, `restoreSkippedExercise` (only in-progress), `restoreReplacedExercise`, `cancelEmptySession`, and `restoreRemainingWeek`.

Minimum durable additions to evaluate in Slice A/B:

| Need | Recommended minimum |
|---|---|
| Reversible future plan mutations | `plan_revisions` (or an equivalent revision snapshot on applied adjustment) with `before_snapshot`, `after_snapshot`, kind, plan, state hash/version, applied time, and restored time. Link `workout_plan_days` to provenance/original day or retain it in revision snapshot. |
| Session snapshot | snapshot of prescription/origin/revision when a session starts, either columns/JSON on session and session exercises or a narrow `session_plan_snapshot`. Do not re-read live plan for an active/historical prescription. |
| Concurrency | plan `revision/version` and active-session uniqueness/transaction rule. PostgreSQL partial unique index for one `in_progress` session per plan day is desirable; terminal duplicate outcomes still need a domain rule. |
| Actual immutable lock | no new table needed: state-aware domain guards first. If corrections are required later, add an append-only `session_corrections` audit rather than deleting historical rows. |
| Measurement | extend enum/type to `assisted_reps`; make the recorded value model semantic (e.g. `reps`, `duration_seconds`, `assistance_kg`, cardio fields) rather than asserting every set has non-null weight/reps. Migration/backfill must preserve existing sets. |

## Prioritized implementation slices for DeepSeek

| Slice | Scope | Dependencies / likely files | Schema impact | Tests required | Risk |
|---|---|---|---|---|---|
| A. State safety and history lock | One active session per day; start resumes; reject rest start; all session mutations require in-progress; terminal outcomes immutable; cancel empty start; transaction/state checks for skip/end/finish | `lib/workouts.ts`, `lib/session-activities.ts`, all `app/api/sessions/**`, `ActiveWorkout`, Week/Home views | likely partial unique active-session index; no broad rewrite | duplicate/double-tap, rest start, all terminal mutation rejections, refresh/resume, ownership | M, high-value |
| B. Reversible future day actions | remove extra, restore move/swap, plan mutation version/hash, card actions and copy | `lib/schedule.ts`, adjustment routes, `WeekPlanner`, `week-view`, schema/revision helper | revision/baseline minimal design | extra remove no adherence record; move restore; stale/race; cannot touch started day | L |
| C. Actual capture usability and correction policy | Add strength UI; activity list/add named details/edit/remove; set edit/remove while in progress; safe-area/mobile sheets | `ActiveWorkout`, session activity/set routes/domain, summary/history | possibly no new schema except set correction decision | full activity lifecycle, added work, draft refresh, keyboard/sheet viewport | L |
| D. Measurement semantics | Canonical types including assisted; semantic controls/validation/formatting; preserve e1RM exclusions and working-set filters | `exercise-measurement`, schema/migration, sets API, active/history, progress/context | measurement fields migration | Dead Bug, Plank, Push-up, assisted machine, treadmill, bike, mobility; no false e1RM | XL; **Phase 3 blocker** |
| E. Replacement lifecycle and plan snapshot | Restore only unperformed replacement, selection state/UI; snapshot prescription at session start; show prescribed vs performed | `session-activities`, `workouts`, active/history, coach context | session snapshot or narrow tables | replacement with/without set; final-state lock; plan changes after start; reasons to context | L |
| F. Rebuild revision and absolute frequency UX | total-day question, visible count breakdown, explicit reject/stale, restore remaining week | feedback/deterministic/buildContext/service/modal/schema | applied-revision snapshot/version | extras+moves + target totals, stale/reject, partial restore boundaries | L |
| G. Adherence/context consolidation | prescribed-intent denominator, extras separate, ended-early actual inclusion, per-session plan-vs-actual coach facts | `progress/tolerance`, `buildTrainingContext`, AI context, rebuild context, review UI | none if snapshots exist | mixed outcomes/extras/replacements/cardio; user scope | M; **Phase 3/6 blocker** |

Recommended order: A → B → C → D → E → F → G. Slice A prevents new corrupted facts before adding richer capture. D/E/G must land before any Phase 3 visualization claims trends are trustworthy.

## Roadmap preserved after hardening

| Roadmap | Status / prerequisite |
|---|---|
| Phase 1 — Longitudinal adaptation | ✅ complete; its signals must be protected by Slices A/D/G |
| Phase 2 — Week feedback + adaptive rebuild | ✅ core flow complete; Slice F hardens revision/reversibility and absolute frequency UX |
| Phase 2.5 — Actual session capture | ✅ complete; Slices C/D/E/G are Phase 2.6 hardening of escape hatches, legacy semantics, snapshots, and context integrity |
| Phase 2.6 — Product journey + state hardening | investigation complete; Slices A/B/F provide the core escape hatches and state safety |
| Phase 3 — Progress visualization | blocked by working-vs-warm-up correctness, semantic measurements, immutable actual history, actual-vs-plan clarity, added/replacement workload, and prescribed-intent adherence (A/D/E/G) |
| Phase 4 — Intelligent exercise substitution | needs preserved planned exercise + actual replacement, reason, movement/muscle/equipment metadata, pain signal, replacement frequency, and safe restore semantics (E; catalogue foundation already exists). Do not implement recommendation intelligence in Phase 2.6. |
| Phase 5 — Nutrition data + coaching | no food design now. Reuse structured feedback, proposal lifecycle, actual-vs-target, trend/immutability patterns from A/F/G. |
| Phase 6 — Long-term adaptive programming | requires reliable performance, tolerance, recovery, planned/actual workload, adherence, extra activity, replacement/schedule patterns. Current mutable history and mixed denominator would poison these signals; resolve A/D/E/G first. |
