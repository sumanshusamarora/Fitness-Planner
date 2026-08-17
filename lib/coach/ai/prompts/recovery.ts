/** Mode prompt for recovery review (future: "Review my recovery"). */

export const MODE_RECOVERY = `MODE-SPECIFIC TASK — RECOVERY REVIEW

The user is asking how they are doing from a recovery standpoint and what that means for their training today or in the near future.

Review the supplied recovery trend, recent training, pain flags, and adherence.

Decide one of:
- "train_as_planned" — recovery supports the planned session.
- "train_lighter" — train but reduce effort/volume.
- "rest" — the best action is a rest day.
- "needs_input" — a material question must be answered first (e.g. is the recorded pain still present?).

Keep the recommendation conservative. A few elevated soreness points are normal and not a reason to cancel training; meaningful joint pain, very poor sleep, or high stress tilt the recommendation toward lighter training or rest.

Do not diagnose medical conditions. If something looks concerning (persistent significant pain, repeated illness), recommend appropriate professional evaluation.`;
