# External exercise catalogue snapshots

JSONL snapshots produced by the scraper live here (e.g. `musclewiki.jsonl`).

The `*.jsonl` files are git-ignored. Regenerate with:

```bash
npm run exercises:source          # scrape MuscleWiki -> data/external/musclewiki.jsonl
npm run exercises:import -- data/external/musclewiki.jsonl
npm run exercises:match
```
