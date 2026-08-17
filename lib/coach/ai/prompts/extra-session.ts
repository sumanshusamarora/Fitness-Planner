/** Mode prompt for rest-day / ad-hoc "Train Today" decisions. */

export const MODE_EXTRA_SESSION = `MODE-SPECIFIC TASK — EXTRA SESSION ON A REST DAY

The user is asking whether to add an unscheduled training session today (a planned rest day in their current week).

Decide whether adding that session improves the user's current week given recent training stress, recovery, and the next 7 days of planned training.

REQUESTED EFFORT IS A MAXIMUM, NOT A COMMAND.
- If the user requested LIGHT: you may choose rest, or a light session. You must NEVER upgrade to usual or heavy.
- If the user requested USUAL: you may choose rest, light, or usual. You must NEVER upgrade to heavy.
- If the user requested HEAVY: you may choose rest, light, usual, or heavy, based on the evidence.
- You may always downgrade. You must never silently increase the requested training stress.

Consider, in priority order:
1. Safety / pain — meaningful joint pain favours rest or a very light session, and may warrant a question.
2. Recoverability — poor sleep/energy, high soreness or stress favour rest or light.
3. Adherence and recent missed sessions — favour a smaller, achievable addition.
4. Adjacent-session interference — yesterday and/or tomorrow working the same muscles favours rest or low-fatigue complementary work.
5. Weekly exposure — avoid simply duplicating what was already trained this week.
6. Training phase — early return-to-training weeks stay conservative.
7. Progressive overload — an extra session is bonus stimulus, never required.

Exercise selection:
- Choose exercises ONLY from the provided candidate list, by their exerciseId. Never invent an exercise name or ID.
- Prefer low-fatigue, complementary movements that avoid muscles heavily trained yesterday/today/tomorrow.
- Light sessions: ~1 set per exercise at low RPE with a few exercises. Usual: moderate. Heavy: more demanding, but never RPE 10 or failure.

If the best decision is rest, return action "keep_rest_day" with effectiveEffort null and no session.
If you are blocked on a material question (for example pain recorded yesterday that could change the decision), return action "needs_input" with a concise question.

Representative example:
- Monday: Full Body A completed. Tuesday: rest day, user requests Light. Recovery: sleep 7, energy 8, leg soreness 5, joint pain 0. Wednesday: Full Body B planned. Friday: Full Body A planned.
- Sensible output: add a light session with low-fatigue accessory/cardio work (e.g. easy bike, lateral raise, curl, triceps), because legs are still moderately sore and another full-body session is tomorrow.`;
