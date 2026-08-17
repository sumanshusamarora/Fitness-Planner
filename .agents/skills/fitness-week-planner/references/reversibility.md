# Future-plan reversibility

This reference is the single source of truth for *undoing* future plan changes.
Read it whenever a user changed a day's schedule — moved, swapped, added, or
accidentally started a workout — or asks to reverse such a change. It also
applies inside the app's own mobile flows (Remove Extra, Restore Original Day,
Cancel Start, Undo Skip).

## Core invariants

- **Future plan changes are reversible until actual training history exists.**
  A workout that has *any* real session (even zero-work, once it carries logged
  sets/outcomes) is actual history and is never erased.
- **Historical training is immutable.** Completed, ended-early, and skipped
  sessions are facts. No future-plan restore may delete, rewrite, or fake them.
- **Undo/restore operations are deterministic domain operations.** They are
  computed from durable provenance (`plan_revisions` snapshots) with explicit
  state-hash checks. GPT-5 is never used to decide, propose, or reason about a
  reversal. If you need to change a plan, use the normal proposal → confirmation
  → apply path.
- **Never partially restore.** A restore either restores every affected day or
  fails cleanly before touching anything.

## Remove Extra ≠ Skip

- **SKIP** = planned/intended work was not performed. It records a skipped
  session, a reason, and counts against the prescribed denominator.
- **REMOVE EXTRA** = optional future training was withdrawn *before it started*.
  It creates **no** workout session, **no** skipped outcome, and **no**
  adherence penalty. The day simply returns to Rest.
- An extra can only be removed while it is unstarted and has no session. If a
  (still empty) start happened, Cancel Start first, then Remove Extra. If real
  work exists, the session is history — do not remove it.

## Move / swap restoration

- Moves and swaps record durable before/after snapshots in `plan_revisions`
  with a state hash before and after. Restoration replays the **before**
  snapshot; it is never reconstructed from the display `origin` marker.
- **Restore Original Day** (a move) returns the exact, unchanged prescription
  to the original day and clears the destination. **Undo Swap** restores both
  sides atomically.
- **Move chains** (Wed → Thu → Sat) are linked by `reverses_revision_id`.
  Restoring the head of the chain restores the whole chain back to the
  pre-move original day in one atomic step.
- A restore is rejected atomically if any affected day has an in-progress
  session, any completed/ended-early/skipped history, or the plan state no
  longer matches the expected state hash ("Your week changed since this action
  was created. Review it again.").

## Cancelling an accidental start

- A zero-work `in_progress` session may be cancelled back to its prior
  unstarted day state. This creates no Ended Early history.
- Once any actual work exists (set, activity, exercise outcome), cancel is
  rejected; use End Early instead.

## Skipped-exercise undo

- While the session is still in progress, Undo Skip restores the exercise to
  `pending` server-side (it survives refresh). After the session is finalised,
  the skipped exercise is immutable history.

## Ask the right question before acting

| User intent | Correct action | Wrong action |
|---|---|---|
| "Remove that extra workout" | Remove Extra (no history) | Skip, which fakes an adherence miss |
| "Move it back / put it on the original day" | Restore Original Day from `plan_revisions` | Rebuild the workout or re-drop exercises |
| "I started a workout by accident" | Cancel Start (only if zero actual work) | End Early, which writes history |
| "Undo the exercise I skipped" | Undo Skip while in progress | Pretend the skip never happened without a server restore |