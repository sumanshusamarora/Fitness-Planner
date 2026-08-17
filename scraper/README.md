# MuscleWiki Scraper

Scrapes exercise data from the public MuscleWiki website using
[scrapling](https://github.com/D4Vinci/Scrapling). No API key or GraphQL is
required.

## How it works

Every exercise has a public, server-rendered page at
`https://musclewiki.com/exercise/<slug>` (there are ~1,940 unique English
exercises). The page embeds:

- a schema.org `ExerciseAction` JSON-LD block (name, instructions HTML,
  exercise type, muscle group, secondary muscle groups, difficulty, equipment),
- demonstration video URLs (male/female, front/side),
- animated GIF and highlighted-muscle "bodymap" image URLs.

We fetch these pages directly and parse the HTML — the internal
`/api-next/*` JSON endpoints are Cloudflare-protected (403) and aren't needed.

## Findings from investigation

| Thing | Result |
| --- | --- |
| GraphQL | None — the site is REST/Next.js |
| Website auth | Cloudflare bot protection + `/api-next/*` routes return `403 Forbidden` to scripted clients |
| Official API (`api.musclewiki.com`) | REST, auth via `X-API-Key` header; paid ($10+/mo), free tier is playground-only |
| Scraping | `scrapling`'s browser-TLS fetcher (`curl_cffi`) returns `200` on the HTML pages |

## Setup

```bash
cd scraper
uv sync          # creates the local .venv and installs deps
```

## Usage

```bash
# one exercise, pretty-printed
.venv/bin/musclewiki --slugs barbell-bench-press

# every exercise, one JSON object per line
.venv/bin/musclewiki --output exercises.jsonl --delay 1.0
```

## Output schema (per record)

```json
{
  "slug": "barbell-bench-press",
  "url": "https://musclewiki.com/exercise/barbell-bench-press",
  "name": "Barbell Bench Press",
  "description_html": "<h1>Detailed How-To</h1>...",
  "exercise_type": "Barbell",
  "muscle_group": ["Chest"],
  "secondary_muscle_groups": ["Triceps", "Lateral Head Triceps", "Medial Head Triceps"],
  "difficulty": "Intermediate",
  "equipment": "Bodyweight",
  "images": ["https://musclewiki.com/api-next/images/og-male-..."],
  "videos": ["https://musclewiki.com/api-next/videos/male-...-front.mp4", "..."],
  "gifs": ["https://musclewiki.com/api-next/images/male-...-front.gif", "..."],
  "bodymap_images": ["https://musclewiki.com/api-next/images/videos/bodymaps/...-front_male.png", "..."]
}
```
