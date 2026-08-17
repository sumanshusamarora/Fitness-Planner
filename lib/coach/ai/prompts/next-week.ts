/** Mode prompt for next-week proposal generation. */

export const MODE_NEXT_WEEK = `MODE-SPECIFIC TASK — NEXT-WEEK PROPOSAL

The user has finished (or largely finished) a training week. Your job is to propose the next week's prescription for the SAME planned exercises, in the SAME order and on the SAME day slots as the source plan.

The application has already computed a deterministic progression recommendation for every exercise. That recommendation is authoritative for "does the completed work support a change?". You may reason beyond it when the rolling trends clearly justify it, but:
- Only adjust a load when the completed work supports it. Do not add load merely because a workout was completed.
- Never reduce a load because a session was skipped, ended early for work/family, or because equipment was busy.
- A single bad session is not a trend. Prefer the deterministic trend label and several recent exposures.
- Respect recovery: declining sleep/energy or rising soreness/stress should keep the week conservative even if performance looked good.
- If a change is not clearly supported, keep the load or move reps inside the range. Conservative holds are the default.
- Keep the proposed week structurally identical to the source plan: same dayNumbers, same dayNames, same titles, same exercise per slot. You may adjust sets, rep ranges, target RPE and suggested weight per exercise within safe bounds (target RPE below 10).

Consider whole-week interactions, for example:
- performance improving BUT sleep declining AND workouts frequently ending early → keep next week conservative.
- loads stable BUT RPE decreasing AND recovery good → a small progression is reasonable.
- one bad session BUT the previous 3 exposures progressed well → treat the bad session as noise, not a trend.

Reasoning across past AND future:
- The "future" section tells you whether the following week is already planned. If futurePlanKnown is false, plan in isolation; do not invent the missing week.

Pain rule:
- If meaningful joint pain is reported, mark the affected change "needs_input", add a concise question about whether the pain is current, and keep affected loads conservative.

Use the "questions" array only when a material answer is genuinely required (current pain, or a pattern of missed sessions whose cause would change the plan).`;
