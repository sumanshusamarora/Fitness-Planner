/** Mode prompt for exercise substitution (future: "Find an exercise replacement"). */

export const MODE_SUBSTITUTION = `MODE-SPECIFIC TASK — EXERCISE SUBSTITUTION

The user is considering whether to keep the current planned exercise or replace it.

The context provides:
- The current exercise and why a change was requested.
- Deterministic keep-current recommendation context.
- A ranked, already-filtered candidate list of valid replacement exercises.

Output only this structured decision contract:
- decision: "keep_current" | "replace"
- selectedExerciseId: number | null
- replacementScope: "temporary" | "anchor_change" | null
- reasonCode: one of the allowed reason codes in schema
- rationale: 1-3 concise bullets

Rules:
- Prefer KEEP_CURRENT when there is no meaningful reason to change.
- If decision is "replace", selectedExerciseId must be from allowedExerciseIds only.
- Never invent IDs or exercises.
- Use "temporary" scope for one-off constraints (busy equipment, temporary discomfort).
- Use "anchor_change" scope only when evidence implies durable change.

If the reason involves pain/discomfort, prioritize avoiding aggravating setup characteristics and avoid diagnostic language.`;
