# Lift Log

A local-first, mobile-first personal fitness tracker for returning to
gym-based resistance training. Multiple people can use it independently — each
has their own plans, history, and recovery — with no passwords or accounts.

The philosophy is simple:

> Show me only what I need to do right now.

It is a Next.js + TypeScript + PostgreSQL (Drizzle ORM) app that runs on your
laptop and is accessed from your phone over Tailscale. PostgreSQL is **not**
exposed to the phone — the phone talks to Next.js, and Next.js talks to
PostgreSQL.

```
Phone → Tailscale → Next.js → PostgreSQL
```

No passwords, no cloud. Profile selection is a lightweight browser/cookie
handshake; training decisions are deterministic and local. An optional runtime
AI coach can augment proposals when configured (see below) but never writes to
your plan.

---

## Tech stack

- Next.js (App Router) + TypeScript
- PostgreSQL 16 (Docker)
- Drizzle ORM
- Tailwind CSS
- Docker Compose

## Project structure

```
app/                Next.js routes and screens
  page.tsx          Home (Mon–Sun strip + today hero)
  profile           Profile selection (no auth)
  recovery          Pre-workout recovery check
  workout/[id]      Active workout (one exercise at a time)
  workout/[id]/complete   Workout summary + energy/effort
  week               Interactive weekly planner (move/swap/train today)
  week/next          Review next-week proposal
  history            Past workouts
  history/[id]       Workout detail with sets
  tools              Profile, export, exercise references
  tools/media        Exercise reference editor
  api/               Mutations (profile, sessions, recovery, media, plans,
                     plan adjustments, export)
components/          UI components (client)
db/
  schema.ts          Drizzle schema
  migrations/        Generated SQL migrations
  seed.ts            Idempotent seed (never deletes real data)
  seed-test.ts       Dedicated `fitness-test` fixture
lib/
  progression.ts     Deterministic, recovery-aware progression engine
  coach/             Weekly context, analysis, proposal + approval services
  schedule.ts        Move/swap/adjust proposal + apply
  initial-week.ts    Conservative Week 1 builder
  week-view.ts       User-scoped week view (Mon–Sun)
  session.ts         Profile cookie helpers (getCurrentUser etc.)
  username.ts        Username normalization/validation
  generation.ts      Confirmation-only compatibility helpers
  workouts.ts        User-scoped DB queries / helpers
  recovery.ts        Recovery log helpers
  media.ts           YouTube URL/ID parsing
  dates.ts           Date helpers
docker-compose.yml
Dockerfile
```

---

## Local setup

### Prerequisites

- Node.js 20+
- Docker with Docker Compose

> Port `5432` is assumed to be taken on your host, so the database is mapped to
> host port **5434**. The app runs on **8881**.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the database URL

```bash
cp .env.example .env
```

The default is:

```
DATABASE_URL=postgresql://fitness:fitness@localhost:5434/fitness
```

### 3. Start PostgreSQL

```bash
docker compose up -d db
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Seed the database

```bash
npm run db:seed
```

This is **idempotent** — it adds any missing exercises and, only if no users
exist yet, creates the default `Sam` profile with a conservative Week 1 plan.
It never deletes existing data. To create a dedicated test profile instead:

```bash
npm run db:seed:test
```

### 6. Start the app

Local dev (hot reload):

```bash
npm run dev
```

Or run app + database together with Docker Compose (builds the app image and
runs both services on the same network):

```bash
docker compose up --build
```

### 7. Open

- **On your laptop:** <http://localhost:8881>
- **On your phone (via Tailscale):** `http://<your-laptop-tailscale-ip>:8881`

On first visit you are asked for a username. Existing usernames are matched
case-insensitively; unknown ones require an explicit "create profile" before
anything is written.

---

## Available scripts

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm run dev`          | Dev server on port 8881                   |
| `npm run build`        | Production build                          |
| `npm start`            | Start the production server (port 3000)   |
| `npm run lint`         | ESLint                                    |
| `npm run typecheck`    | TypeScript checks                         |
| `npm test`             | Domain, integration, isolation and schedule tests |
| `npm run db:generate`  | Generate Drizzle migrations from schema   |
| `npm run db:migrate`   | Apply Drizzle migrations                  |
| `npm run db:seed`      | Idempotent seed (never deletes data)      |
| `npm run db:seed:test` | Ensure the `fitness-test` profile exists  |
| `npm run coach -- users` | List users                               |
| `npm run coach -- propose --user U` | Create/read a reviewable weekly proposal |
| `npm run coach -- approve ID --confirm --user U` | Explicitly apply an approved proposal |
| `npm run coach:smoke` | One bounded AI-coach request (requires `OPEN_API_KEY`) |
| `npm run exercises:source` | Scrape MuscleWiki → `data/external/musclewiki.jsonl` (offline, explicit) |
| `npm run exercises:import -- <jsonl>` | Import a catalogue snapshot into `external_exercises` |
| `npm run exercises:match` | Rank + preselect mappings (`--dry-run` to only inspect) |

When running the app inside Docker Compose, migrations and seeding can also be
run against the containerized database:

```bash
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:seed
```

---

## Data model

- **Planned data** (`workout_plans`, `workout_plan_days`,
  `workout_plan_exercises`) is kept separate from **actual data**
  (`workout_sessions`, `workout_session_exercises`, `workout_sets`).
- `users` and `exercises` are shared reference tables. `users` now carries a
  unique `username` / `username_normalized` (case-insensitive).
- `exercise_media` holds curated reference links (image / YouTube / article)
  per exercise.
- `recovery_logs` records a pre-workout check (sleep, energy, soreness, joint
  pain, stress on a 1–10 scale) and feeds the progression engine.
- `weekly_plan_proposals` and `plan_adjustment_proposals` are reviewable
  JSONB drafts that only mutate the plan when explicitly applied.

When you start a workout, a `workout_session` is created and each planned
exercise is copied into `workout_session_exercises` with a suggested weight
computed by the progression engine. Logged sets never modify the plan.

## Profiles & user scoping

Profile selection is a lightweight handshake, not authentication:

- The browser remembers the username in `localStorage` (`fitness-planner.username`).
- After the username resolves, the server sets a `fitness_profile_id` cookie.
- One canonical helper (`lib/session.ts`) provides `getCurrentUser()`,
  `requireCurrentUser()`, and `getCurrentUserId()`.
- Every personal query takes a `userId` (`getActivePlan(userId)`,
  `getLastCompletedSets(userId, exerciseId)`, `getSessionHistory(userId)`,
  `getLatestRecoverySnapshot(userId)`, …). Nothing reads "the global active plan".
- Every mutation API verifies the target resource belongs to the selected user,
  so changing an ID in the URL can never cross into another profile.
- `exercises` and `exercise_media` remain shared; everything else is user-owned,
  including exports.

## Home screen & weekly planner

The home screen shows a Mon–Sun strip (completed / today / scheduled / rest /
moved / extra), the current week's progress, and a large today card with one
primary action. Secondary actions (move a workout, train on a rest day) open the
interactive **Week** planner.

From the Week planner you can:

- **Move** a workout to another day (the prescription moves intact; the source
  day becomes rest).
- **Swap** two workout days (with explicit confirmation — nothing is merged).
- **Train today** on a rest day — choose Light (default), Usual, or Heavy. The
  coach examines adjacent sessions, muscle overlap, recovery, pain, and phase;
  it may downgrade a Heavy request and always explains why.

A completed workout cannot be moved. All schedule changes go through a
proposal → confirmation → idempotent apply path with an audit trail.

## First-week onboarding

A new profile starts with no plan. **BUILD MY FIRST WEEK** opens a short,
one-question-per-screen onboarding (goal, experience, availability, session
length, environment, limitations, optional profile info) that persists a
per-user `user_training_profiles` row. The coach (`proposeFirstWeek`) then
builds a conservative Week 1 — fewer resistance days for beginners/returning
trainees, submaximal RPE, and a plain explanation when a requested schedule is
downgraded. You review the week, then **ACCEPT WEEK 1** applies it exactly once.
Edit it later under **More → Training profile**.

## Active workout control

The workout screen no longer forces linear progress:

- **Previous / Next** navigate freely and never complete or skip an exercise;
  entered set data is preserved.
- Tap **Exercise X of Y** for a quick-jump list (completed / current / pending /
  skipped).
- **Skip exercise** records a reason. "Equipment busy" carries no performance
  judgement; "pain" is a safety signal the coach sees.
- **End workout early** preserves completed sets and marks remaining exercises
  as not performed, with a recorded reason.
- **Skip session** (from Today/Week) records an auditable outcome without
  deleting the planned workout.

Sessions carry a `status` (`in_progress`, `completed`, `ended_early`,
`skipped`); exercises carry `pending`, `completed`, `skipped`, or
`not_attempted`. Only actually attempted sets feed progression — skipped and
ended-early work never becomes a false "failed lift" signal. In-progress
workouts persist and resume across browser/app restarts.

## Progression engine

`lib/progression.ts` is a pure, deterministic function. It inspects the most
recent completed session for an exercise and:

- Increases weight by the smallest practical increment (2.5 kg, or 1.25 kg for
  light loads) when all sets were completed, reps hit the top of the range, and
  RPE stayed at or below target.
- Holds weight when reps were within range but not at the top.
- Holds weight when RPE was considerably above target.
- Reduces or holds weight when the minimum rep target was missed.

It is also **recovery-aware**. Recovery can only *block* an increase — it never
forces one:

- Meaningful joint pain (≥ 7) holds the weight.
- Poor overall recovery (sleep ≤ 4, energy ≤ 4, soreness ≥ 8, or stress ≥ 8)
  holds the weight.
- Actual set performance remains the primary signal.

It never prescribes training to failure and never changes the plan without your
confirmation — it only returns `recommendedWeight` and a short `reason`.

## Weekly coaching

`lib/coach` builds a compact context from planned and completed workouts, set
history, RPE, recovery logs, pain flags, and recent exercise exposures. It uses
the deterministic progression engine for calculable facts, then persists a
validated JSONB proposal in `weekly_plan_proposals`. A proposal is not an
active plan. Only `applyProposal()` (or the explicit UI/CLI confirmation path)
creates the next `workout_plan`; applying it again returns the same plan.

The repo-local Codex skill lives at `.agents/skills/fitness-week-planner`. It
uses `npm run coach` rather than SQL and stops for material safety or adherence
questions before approval.

## Optional runtime AI coach

When `OPEN_API_KEY` is set (and `NODE_ENV` is not `test`), the coach can
augment first-week, next-week, and rest-day (extra-session) proposals with a
GPT-5 reasoner (`lib/coach/reasoners/openai.ts`) behind the shared
`CoachReasoner` interface. All runtime calls go through
`lib/coach/ai/runCoach.ts` using the OpenAI Responses API with Zod structured
outputs.

The AI coach is **read-only**:

- It only proposes. `applyProposal()` and `applyPlanAdjustment()` remain the
  only write paths and still require explicit approval.
- It selects only from the controlled candidate exercise set — it never invents
  exercise IDs.
- It cannot prescribe RPE 10 / failure, and a requested effort is treated as a
  maximum (Light/Usual/Heavy are never silently upgraded).
- Any missing key, API error, or invalid output falls back to the deterministic
  engine automatically.

Configuration lives in `lib/coach/ai/client.ts`: `OPEN_API_KEY` enables it and
`OPENAI_COACH_MODEL` overrides the model (default `gpt-5`). Normal `npm test`
and `npm run build` do not require the key; the manual smoke test does:

```bash
npm run coach:smoke
```

## Recovery check

Before starting a resistance workout you are shown a quick "How are you today?"
screen with five 1–10 scales (Sleep, Energy, Soreness, Joint pain, Stress).
You can fill it in under 20 seconds, or skip it. Ratings are saved to
`recovery_logs` and used to gate next-week progression.

## Week 2+ generation

When every resistance day of the active week has a completed session, the Week
screen shows **PLAN NEXT WEEK**. This:

1. Reads the current week's completed sessions.
2. Runs the progression engine (with recovery) on each planned exercise.
3. Persists a reviewable proposal, never an active plan.
4. Shows each proposed change (last week vs. next week, the delta, evidence,
   and a short reason), including material questions when needed.
5. Lets you **Use change** or **Keep load** individually.
6. Only on **ACCEPT WEEK** creates a new `workout_plan` (next week number,
   next Monday start) and marks the old plan `completed`.

The previous week is never overwritten — all weeks remain in history.

## Exercise references


Each exercise can have an image, a YouTube video, and an article link. Edit them
under **More → Exercise references** (`/tools/media`). Standard YouTube URLs
(`watch?v=`, `youtu.be`, `shorts`, `embed`) are supported; the video ID is
extracted and stored so the app can embed it or open YouTube cleanly. During a
workout the exercise screen shows the image (tap to enlarge), a **Watch
technique** button, and a **More info** link when present. Exercises with no
media still work normally.

## External exercise catalogue

The app keeps a **local external exercise catalogue** (e.g. imported MuscleWiki
data) that is *reference/discovery data only* — `exercises` remains the
canonical workout model.

```text
scraper → JSONL snapshot → external_exercises → matching → exercise_external_mappings (approved only) → UI/coach enrichment
```

The app never calls the provider at runtime; the scraper is an offline utility.

**Workflow**

```bash
npm run exercises:source                              # scrape → data/external/musclewiki.jsonl
npm run exercises:import -- data/external/musclewiki.jsonl
npm run exercises:match -- --dry-run                  # inspect first
npm run exercises:match                               # preselect "suggested" mappings
```

Then review and approve matches under **More → Exercise catalogue**
(`/tools/catalogue`). Only `approved` mappings enrich an exercise; a match is
never authoritative just because a matcher scored it highly.

- `external_exercises` — normalized, provider-agnostic catalogue rows with
  `provider` + `external_id` uniqueness, `raw_metadata` for the full source
  record, and a `content_hash` for change detection.
- `exercise_external_mappings` — links a canonical exercise to a catalogue row
  (`suggested` / `approved` / `rejected`), with a partial unique index enforcing
  one approved mapping per exercise + provider.
- `lib/external-exercises/` — import, normalization, deterministic explainable
  matching, sanitization, and query helpers (`searchExerciseCatalogue`,
  `getMappedExternalExercise`, `findExerciseCandidates`, …) for future
  substitutions and coach reasoning.

## Export

Under **More → Export Data** (`/tools`), or by visiting `/api/export`, you can
download a JSON backup scoped to your profile (user, exercises, media, plans,
days, planned exercises, sessions, session exercises, sets, recovery logs). It
never includes another user's data.

## Rest-day workout generation

`lib/coach/restDay.ts` builds a reviewable extra session that complements the
week: it avoids muscles trained yesterday/tomorrow, skips exercises already in
the plan, and applies Light/Usual/Heavy presets. Heavy is downgraded when
recovery is poor, joint pain is reported, the user is in the early
return-to-training phase, or adjacent sessions overlap.

---

## Recommended next steps

1. **Exercise substitution** — allow swapping an exercise in the next-week
   proposal before accepting.
2. **Rest timer notification** — a beep/vibration when the timer ends.
3. **Notes & problems flag** — let a set be marked "too easy / too hard" to feed
   clearer progression reasons.
4. **Import/restore** — a counterpart to JSON export.
5. **Optional profile fields** — let a user fill in DOB/height after creation.
