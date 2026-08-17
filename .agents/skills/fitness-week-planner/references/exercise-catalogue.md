# Exercise catalogue (external reference data)

The app keeps a **local external exercise catalogue** (e.g. imported MuscleWiki
data). It is *reference and discovery* data only.

## What is canonical vs external

- **Canonical** — the `exercises` table. This remains the authoritative workout
  model for existing plans, sessions, history and progression. Never replace a
  canonical exercise with an external catalogue entry.
- **External** — `external_exercises`, a shared provider-agnostic catalogue of
  ~1,940 exercises with muscle/equipment/difficulty metadata and media URLs.
  Imported offline from a JSONL snapshot; the app never calls the provider at
  runtime.
- **Mappings** — `exercise_external_mappings` links a canonical exercise to an
  external one. Only `approved` mappings are treated as enrichment. A mapping
  is never authoritative just because a matcher scored it highly.

## When to use the catalogue

The catalogue may be used for:

- exercise **search** and discovery (`searchExerciseCatalogue`)
- reading approved **reference metadata** for a known exercise
  (`getMappedExternalExercise`, `getApprovedExternalReferences`)
- finding **candidate** exercises for future substitutions
  (`findExternalExercises`, `findExerciseCandidates`)

It must **not** be used to:

- silently replace a canonical exercise because an external entry looks similar
- dump thousands of exercises into a coaching prompt/context
- import media into the app or re-host provider assets

## Coach flow

The future coach flow is:

```text
coach identifies a need
  → queries the catalogue (searchExerciseCatalogue / findExerciseCandidates)
  → receives a small candidate set
  → reasons over that set
```

Not: "send the whole catalogue to the LLM".

## Safety

- Same muscle ≠ equivalent exercise. A substitution is a coaching decision, not
  a name match.
- Approved mappings enrich understanding; they do not change a user's plan,
  history, or progression on their own.
- Provider instructions/media are third-party: preserve source attribution and
  do not present provider-derived metadata as if authored locally.
