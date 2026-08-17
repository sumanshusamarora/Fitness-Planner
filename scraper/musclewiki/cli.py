"""Command-line interface for the MuscleWiki scraper."""

from __future__ import annotations

import argparse
import json
import sys

from .scraper import fetch_exercise, fetch_exercise_slugs, scrape_all


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="musclewiki",
        description="Scrape MuscleWiki exercise data from the public website.",
    )
    p.add_argument("--output", "-o", default="exercises.jsonl", help="Output JSONL file")
    p.add_argument("--slugs", nargs="*", default=None, help="Specific exercise slugs to fetch")
    p.add_argument("--delay", type=float, default=1.0, help="Seconds to wait between requests")
    p.add_argument("--limit", type=int, default=None, help="Max number of exercises to fetch")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    slugs = args.slugs if args.slugs else fetch_exercise_slugs()
    if args.limit:
        slugs = slugs[: args.limit]

    if args.slugs and len(slugs) == 1:
        print(json.dumps(fetch_exercise(slugs[0]), indent=2, ensure_ascii=False))
        return 0

    def report(i: int, total: int, record: dict) -> None:
        name = record.get("name") or record.get("error") or "?"
        print(f"[{i}/{total}] {record.get('slug')}: {name}", file=sys.stderr)

    with open(args.output, "w", encoding="utf-8") as fh:
        for record in scrape_all(slugs, delay=args.delay, on_exercise=report):
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"Wrote {len(slugs)} records to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
