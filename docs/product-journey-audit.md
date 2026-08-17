# Product journey audit — Phase 2.6

Severity: P0 corrupts or rewrites actual history; P1 traps a user or gives wrong semantics; P2 confusing with a workaround; P3 polish. “Current” means the current working tree, including uncommitted changes.

## Journey findings

| Journey | Current behavior | Problem / expected behavior | State and data implication | Severity · phase |
|---|---|---|---|---|
| A. First launch / profile selection | Username is held in local storage, resolved to a server session; unknown name offers create | Clear enough; error recovery is generic and profile selection is not visibly confirmed | refresh preserves chosen username; browser restart re-resolves | P3 · 2.6 |
| B. First-week onboarding | Seven-step profile then review-only initial proposal and explicit approval | Good confirmation boundary. Back navigation preserves client state only; network retry can leave uncertain proposal state | proposal is persisted separately and apply is idempotent | P2 · 2.6 |
| C. Before week begins | Full week cards show title, `extra`/`moved` badge, 0/total done | Origin badge says what changed but not where it came from or how to undo it | `origin` is a nullable display marker | P1 · 2.6 |
| D. Start planned workout | Starts a session and copies session-exercise rows | Can start repeatedly and can start a rest day; should resume existing in-progress or reject duplicate | duplicate session/outcome records can corrupt adherence/history | **P0 · 2.6** |
| E. Start extra workout | Same start flow after a rest-day add | Works only after coaching proposal; extra origin remains only on plan day | extra should remain distinguishable as optional after completion | P1 · 2.6 |
| F. Move workout | Draft + explicit apply correctly preserves exercises | Move proposal has no state hash and checks completed-at, not in-progress/any outcome | stale or in-progress move can mutate plan beneath live session | **P0 · 2.6** |
| G. Undo moved workout | No UI/API/domain restore | Expected “Restore original day” before either day starts | source destination/provenance absent | P1 · 2.6 |
| H. Add extra workout | Rest day → effort → coach proposal → explicit add | Correct approval boundary and light default; no duplicate protection beyond current exercise count | future plan is mutated in place | P2 · 2.6 |
| I. Undo extra workout | Card offers Start, Move, Skip only | Skip falsely creates an adherence outcome. Expected Remove extra → Rest | no remove operation or original-rest baseline | **P1 · 2.6** |
| J. Skip workout | Creates a skipped session with reason | Correct intended meaning, but endpoint permits duplicates/skip after completed and no immutable guard | denominator/outcomes can duplicate | **P0 · 2.6** |
| K. Start then end early | Captures reason and marks pending exercises not attempted | Good distinct label and preserved completed work; finalised session still mutable through other endpoints | ended-early history must lock | **P0 · 2.6** |
| L. Resume in-progress | Week card says Resume | Good discoverability; direct start still creates another session rather than resuming | must be idempotent by plan day | P1 · 2.6 |
| M. Navigate exercises | Previous/next and exercise list are client state; “do later” moves locally | Refresh keeps server pending state, but unsaved draft weight/reps are lost; replacement status can render as an actionable exercise | no draft persistence; no robust row identity in client | P2 · 2.6 |
| N. Skip exercise | Reasoned skip, then local “UNDO SKIP” | Undo only changes React state; refresh shows skipped because no server restore exists | false recovery affordance | **P1 · 2.6** |
| O. Replace exercise | Pick reason, broad catalogue search, replace via API | API records provenance/reason; no compatibility guidance yet (appropriate Phase 4), no server state lock | original becomes `replaced`; replacement row links back | P1 · 2.5/2.6 |
| P. Restore replacement | API exists | Not exposed in mobile UI; API deletes replacement sets even after work and does not enforce in-progress | loses actual history | **P0 · 2.6** |
| Q. Add unplanned strength | Phase 2.5 added-strength capture exists | Current active menu does not expose an obvious add/remove lifecycle | `origin='added'` is actual workload, never prescribed adherence | P1 · 2.6 |
| R. Add warm-up/cardio/mobility | Phase 2.5 menu adds persisted activity and totals survive resume/history | Audit whether accidental provisional activity can be visibly edit/remove and whether rich activity details need a Phase 2.6 surface | activity table supports fields beyond current compact capture UI | P1 · 2.6 |
| S. Bodyweight/timed logging | Phase 2.5 hides weight for bodyweight and labels timed holds in seconds | Dead Bug completion is possible. Phase 2.6 must decide how legacy planned duration/distance exercises are represented, and remove misleading `0 kg` display | set schema stores existing semantics; activity table holds cardio detail | P1 · 2.6 |
| T. Correct logging mistake | No visible edit/delete set; APIs only create set | A mistyped weight/reps/RPE has no recovery path | immutable or corrective policy is undefined | **P1 · 2.6** |
| U. Complete workout | Finish writes energy/RPE and marks remaining not attempted | Summary includes activities and actual extras, but no explicit prescribed-vs-performed comparison; endpoint has no in-progress guard | completed record can be repeatedly changed | **P0 · 2.6** |
| V. Edit immediately after completion | History is view-only, but raw APIs still mutate activities/exercises/sets | Decide explicit short correction flow or lock; current invisible mutability is unsafe | historical evidence can be rewritten | **P0 · 2.6** |
| W. Mid-week schedule change | Move/swap and rebuild both exist | Move vs rebuild is conceptually distinguished, but moved/extras are not counted or explained consistently | revision provenance missing | P1 · 2.6 |
| X. Too hard / too easy | Structured follow-up and proposed review | Good review/accept/reject. “too easy” is reasonably cautious | persisted feedback is available for coaching | P2 · 2.6 |
| Y. Too many / too few days | Too many asks absolute target; too few asks “additional +1/+2” | +N compounds pre-existing extras/moves and produced the reported six-day outcome; must ask total days and display breakdown | deterministic rebuild adds relative sessions | **P1 · 2.6** |
| Z. Poor recovery | Structured driver plus conservative rebuild and Phase 2.5 actual summary | Good safety direction; report does not distinguish actual workload from plan in the review | actual summary is compact/context-only | P2 · 2.6 |
| AA. Pain/discomfort | Captures current/not and location, asks needed input | Good non-diagnostic boundary; Phase 4 must later use this structured replacement signal | feedback and replacement reasons are separate but compatible | P2 · 2.6 |
| AB. Rebuild remaining week | Rebuild state hash, validation and idempotent apply are solid | Apply deletes and recreates future plan exercises, clears origin; no applied-revision baseline/restore | legal current/future work changes destructively | P1 · 2.6 |
| AC. Reject rebuild | “Keep current week” closes modal | Correct: it does not apply. Proposal remains draft, not explicitly rejected, so old drafts accumulate | rejection audit/status absent | P2 · 2.6 |
| AD. Undo applied future changes | None | Need named `restoreRemainingWeek(revisionId)` for untouched future days, not generic undo | requires before snapshot/revision linkage | P1 · 2.6 |
| AE. End-of-week review | History and next-week proposal path exist | Completed count and plan title are shown, but prescribed vs actual, extra load, replacements and cardio are not presented as a coherent week review | future coach has partial compact actual context | P1 · 2.5/3 |
| AF. Generate next week | Phase 2.5 rolling actual context and feedback prompt integration exist | Audit context fidelity: actual extra/replacement/cardio must influence coaching without corrupting adherence or becoming fake planned performance | future program may under-read ended-early or non-snapshot context | P1 · 2.6/6 |

## Missing escape hatches

| Entered state | Entry exists | Clean exit now | Required exit |
|---|---|---|---|
| Unstarted extra | Train Today → proposal → Add workout | none (Skip is semantically wrong) | Remove extra → Rest |
| Unstarted moved workout | Move / swap → apply | none | Restore original day |
| Skipped exercise in UI | Skip reason | local-only “UNDO SKIP” | deterministic server restore while session is in progress, or remove the affordance |
| Replacement selected | Replace exercise | API only; unsafe deletion | Restore original while replacement has no actual work; otherwise preserve actual replacement |
| Added strength exercise | API only | none | Remove only while it has no actual work |
| Activity entered | API only / generic add UI | no mobile edit/delete | Edit/remove while session is in progress |
| Accidental session start | Start | End early creates historical outcome | Cancel empty start |
| Logged set mistake | Save set | none | edit/remove provisional set; after finalisation use auditable correction policy |
| Applied rebuild | Accept changes | none | Restore remaining week from revision baseline |

## Mobile-first observations

- Action sheets use 85–90vh scroll containers and fixed bottom nav. Long rebuild/replacement sheets can put primary/close controls behind the browser bar or keyboard; there is no safe-area padding.
- The workout menu mixes reversible actions, destructive outcomes, and navigation with equal visual weight. “End workout early” should be visually separated from routine actions and confirm clearly.
- Important recovery actions are missing where users look: Remove extra and Restore moved day belong in the day sheet; Restore replacement and Add strength belong in the active-exercise/menu flow.
- The week card is a button opening a sheet, which is reasonable one-handed use, but it has no visible indication of the *next* action (Start vs Resume vs View) until opened.
- The replacement search has a keyboard but no persistent selection/back state; unsaved set drafts are React-only and disappear on refresh/navigation.
- “0 kg” appears in prescriptions/history for bodyweight movements, which looks like a broken weight rather than an intentional measurement.

## Error and concurrency audit

| Condition | Current safety | Required behavior |
|---|---|---|
| Double-tap Start / two tabs | unsafe: creates sessions | transaction + active-session uniqueness/lookup; return existing in-progress session |
| Double apply move/add | proposal apply is idempotent after applied | add state hash/transactional current-state validation to all adjustments |
| Rebuild stale | protected by `state_hash` | show “week changed—review again”, retain/reopen context |
| Rebuild invalid/AI unavailable | deterministic fallback and validator exist | surface source/retry; do not persist unusable draft silently |
| Refresh during set entry | saved work survives, draft input lost | preserve draft locally per session or disclose it is unsaved |
| Refresh after local undo skip | server remains skipped | server restore or no local undo |
| Activity/replace after completion | unsafe | reject at domain boundary with intelligible outcome message |
| Another action changes plan | rebuild detects it; move/add do not | version/hash all future-plan mutations |
