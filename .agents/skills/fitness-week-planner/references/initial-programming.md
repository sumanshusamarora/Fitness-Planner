# First-week / initial programming

A brand-new user has no training history. The first-week proposal is built from
their training profile (goal, experience, availability, session length,
equipment, limitations) plus conservative defaults — never from fake history.

Programming inputs, in priority order:

1. **Goal** — shapes emphasis, not load. General fitness, muscle, strength,
   fat loss, or sport performance all start with a conservative base.
2. **Experience** — beginners and returning trainees get fewer sets and lower
   RPE. "Returning" with a long layoff is treated like a beginner.
3. **Availability** — more days is not automatically better. A returning user
   who asks for 5–6 days should be offered 3 resistance days plus recovery or
   optional cardio, with a brief explanation.
4. **Session length** — controls exercises per session (fewer for short
   sessions), not load.
5. **Equipment** — full gym, home, or limited equipment determines exercise
   selection. Never prescribe movements the user cannot perform.
6. **Limitations** — noted limitations are carried into the plan and surfaced
   for review. They are not diagnosed and are not auto-interpreted into
   anatomy-level substitutions.

Beginner/returning programming is deliberately conservative:

- manageable exercise count and sets
- submaximal RPE (roughly 5–6)
- no routine training to failure
- baseline loads to establish technique and realistic starting weights
- consistency over optimisation
- room to progress and minimal severe DOMS

The first-week proposal has no source plan (`source_week_id` is null,
`proposal_type` is `initial_week`). It must still be a reviewable,
human-confirmed proposal — drafting it never creates an active plan.
