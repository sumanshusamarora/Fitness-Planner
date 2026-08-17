"""Core scraping logic for MuscleWiki.

Data is extracted from the server-rendered HTML of each public exercise page
(``https://musclewiki.com/exercise/<slug>``).  No API key or GraphQL is
required: the site embeds a schema.org ``ExerciseAction`` JSON-LD block plus
the video/image URLs directly in the page.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Iterator

from scrapling.fetchers import Fetcher

BASE_URL = "https://musclewiki.com"
SITEMAP_URL = f"{BASE_URL}/sitemap.xml"

# The 14 non-default locales appear as path prefixes in the sitemap.
_LOCALES = {
    "pt-br", "ar-sa", "de-de", "es-es", "fa-ir", "fr-fr",
    "hi-in", "it-it", "pl-pl", "tr-tr", "ru-ru", "zh-cn", "ja-jp",
}

_EXERCISE_PATH = re.compile(r"^/exercise/([^/]+)/?$")


def _get_text(url: str, timeout: int = 30) -> str:
    """Fetch a URL with scrapling (browser TLS impersonation) and return HTML text."""
    resp = Fetcher.get(url, timeout=timeout)
    body = resp.html_content or resp.text or ""
    if isinstance(body, bytes):
        body = body.decode("utf-8", "replace")
    return body


def fetch_exercise_slugs() -> list[str]:
    """Return the list of English exercise slugs from the sitemap."""
    sitemap = _get_text(SITEMAP_URL, timeout=60)
    slugs: list[str] = []
    for loc in re.findall(r"<loc>([^<]+)</loc>", sitemap):
        path = loc.split(BASE_URL, 1)[-1].split("?")[0]
        m = _EXERCISE_PATH.match(path)
        if m:
            slugs.append(m.group(1))
    return sorted(set(slugs))


def _extract_jsonld(html: str) -> dict[str, Any] | None:
    """Extract the schema.org ``ExerciseAction`` JSON-LD block (the core exercise data)."""
    start = html.find('"exerciseType"')
    if start == -1:
        return None
    script_start = html.rfind("<script", 0, start)
    script_end = html.find("</script>", start)
    if script_start == -1 or script_end == -1:
        return None
    block = html[script_start:script_end]
    json_start = block.find(">") + 1
    try:
        return json.loads(block[json_start:].strip())
    except json.JSONDecodeError:
        return None


def _abs(path: str) -> str:
    return path if path.startswith("http") else BASE_URL + path


def _extract_urls(html: str, pattern: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in re.findall(pattern, html):
        url = _abs(m)
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def fetch_exercise(slug: str, timeout: int = 30) -> dict[str, Any]:
    """Fetch a single exercise page and return a structured dict."""
    url = f"{BASE_URL}/exercise/{slug}"
    html = _get_text(url, timeout=timeout)

    record: dict[str, Any] = {
        "slug": slug,
        "url": url,
        "name": None,
        "description_html": None,
        "exercise_type": None,
        "muscle_group": [],
        "secondary_muscle_groups": [],
        "difficulty": None,
        "equipment": None,
        "images": [],
        "videos": [],
        "gifs": [],
        "bodymap_images": [],
    }

    ld = _extract_jsonld(html)
    if ld:
        record["name"] = ld.get("name")
        record["description_html"] = ld.get("description")
        record["exercise_type"] = ld.get("exerciseType")
        record["muscle_group"] = ld.get("muscleGroup") or []
        record["secondary_muscle_groups"] = ld.get("secondaryMuscleGroups") or []
        record["difficulty"] = ld.get("difficulty")
        record["equipment"] = ld.get("equipment")
        record["images"] = [_abs(i) for i in (ld.get("image") or [])]

    # Demonstration videos (male/female, front/side) referenced in <video> tags.
    record["videos"] = _extract_urls(
        html, r'/api-next/videos/[A-Za-z0-9_\-]+\.mp4'
    )
    # Animated exercise GIFs.
    record["gifs"] = _extract_urls(
        html, r'/api-next/images/[A-Za-z0-9_\-]+\.gif'
    )
    # Highlighted muscle diagrams.
    record["bodymap_images"] = _extract_urls(
        html, r'/(?:api-next/)?images/videos/bodymaps/[A-Za-z0-9_\-]+\.png'
    )

    if not record["name"]:
        m = re.search(r"<title>([^<]+?)\s*\|?\s*MuscleWiki", html)
        if m:
            record["name"] = m.group(1).strip()

    return record


def scrape_all(
    slugs: list[str] | None = None,
    delay: float = 1.0,
    on_exercise: Any | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield a structured dict for every exercise, with a polite delay between requests."""
    if slugs is None:
        slugs = fetch_exercise_slugs()
    for i, slug in enumerate(slugs, 1):
        try:
            record = fetch_exercise(slug)
        except Exception as exc:  # keep going on transient failures
            record = {"slug": slug, "url": f"{BASE_URL}/exercise/{slug}", "error": str(exc)}
        if on_exercise:
            on_exercise(i, len(slugs), record)
        yield record
        if delay:
            time.sleep(delay)
