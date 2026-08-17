# Lift Log

A local-first, mobile-first personal fitness tracker for one user returning to
gym-based resistance training.

The philosophy is simple:

> Show me only what I need to do right now.

It is a Next.js + TypeScript + PostgreSQL (Drizzle ORM) app that runs on your
laptop and is accessed from your phone over Tailscale. PostgreSQL is **not**
exposed to the phone — the phone talks to Next.js, and Next.js talks to
PostgreSQL.

```
Phone → Tailscale → Next.js → PostgreSQL
```

No authentication, no cloud, no AI. Everything is deterministic and local.

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
  page.tsx          Today
  recovery          Pre-workout recovery check
  workout/[id]      Active workout (one exercise at a time)
  workout/[id]/complete   Workout summary + energy/effort
  week               Weekly layout + "create next week"
  week/next          Review next-week proposal
  history            Past workouts
  history/[id]       Workout detail with sets
  tools              Export data + links
  tools/media        Exercise reference editor
  api/               Mutations (sessions, sets, recovery, media, plans, export)
components/          UI components (client)
db/
  schema.ts          Drizzle schema
  migrations/        Generated SQL migrations
  seed.ts            Seed data
lib/
  progression.ts     Deterministic, recovery-aware progression engine
  coach/             Weekly context, analysis, proposal and approval services
  generation.ts      Confirmation-only compatibility helpers
  workouts.ts        DB queries / helpers
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

This creates one user, 19 exercises, and a conservative Week 1 plan
(Mon = Full Body A, Wed = Full Body B, Fri = Full Body A).

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

---

## Available scripts

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm run dev`          | Dev server on port 8881                   |
| `npm run build`        | Production build                          |
| `npm start`            | Start the production server (port 3000)   |
| `npm run lint`         | ESLint                                    |
| `npm run typecheck`    | TypeScript checks                         |
| `npm run db:generate`  | Generate Drizzle migrations from schema   |
| `npm run db:migrate`   | Apply Drizzle migrations                  |
| `npm run db:seed`      | Reset and seed the database               |
| `npm run coach -- propose` | Create/read a reviewable weekly proposal |
| `npm run coach -- show ID` | Show a persisted proposal                |
| `npm run coach -- approve ID --confirm` | Explicitly apply an approved proposal |

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
- `users` and `exercises` are shared reference tables.
- `exercise_media` holds curated reference links (image / YouTube / article)
  per exercise.
- `recovery_logs` records a pre-workout check (sleep, energy, soreness, joint
  pain, stress on a 1–10 scale) and feeds the progression engine.

When you start a workout, a `workout_session` is created and each planned
exercise is copied into `workout_session_exercises` with a suggested weight
computed by the progression engine. Logged sets never modify the plan.

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

## Export

Under **More → Export Data** (`/tools`), or by visiting `/api/export`, you can
download a full JSON backup (users, exercises, media, plans, days, planned
exercises, sessions, session exercises, sets, recovery logs).

---

## Recommended next steps

1. **Exercise substitution** — allow swapping an exercise in the next-week
   proposal before accepting.
2. **Rest timer notification** — a beep/vibration when the timer ends.
3. **Notes & problems flag** — let a set be marked "too easy / too hard" to feed
   clearer progression reasons.
4. **Import/restore** — a counterpart to JSON export.
5. **Single sign-in** — add a lightweight local auth only if you later expose it
   beyond Tailscale.
