import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import {
  findExerciseCandidates,
  upsertSuggestedMapping,
} from "@/lib/external-exercises";

const DEFAULT_MIN_CONFIDENCE = 80;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const minConfidenceIdx = process.argv.indexOf("--min-confidence");
  const minConfidence =
    minConfidenceIdx !== -1 && process.argv[minConfidenceIdx + 1]
      ? Number(process.argv[minConfidenceIdx + 1])
      : DEFAULT_MIN_CONFIDENCE;

  const rows = await db
    .select()
    .from(exercises)
    .where(eq(exercises.active, true))
    .orderBy(asc(exercises.name));

  let suggested = 0;
  let skipped = 0;
  let best = 0;
  let worst = 100;
  const uncertain: string[] = [];

  for (const ex of rows) {
    const canonical = {
      id: ex.id,
      name: ex.name,
      primaryMuscle: ex.primaryMuscle,
      equipment: ex.equipment,
      category: ex.category,
    };
    const candidates = await findExerciseCandidates(canonical);
    if (candidates.length === 0) {
      console.log(`${ex.name}: NO CATALOGUE MATCHES`);
      skipped += 1;
      continue;
    }
    const top = candidates[0];
    best = Math.max(best, top.confidence);
    worst = Math.min(worst, top.confidence);

    if (top.confidence >= minConfidence) {
      if (dryRun) {
        console.log(`${ex.name} -> ${top.name} (${top.confidence}%) [dry-run]`);
      } else {
        await upsertSuggestedMapping(ex.id, top);
      }
      suggested += 1;
    } else {
      uncertain.push(`${ex.name}: top ${top.name} (${top.confidence}%)`);
      skipped += 1;
    }
  }

  console.log("");
  console.log(`Exercises matched: ${rows.length}`);
  console.log(`Suggested (>= ${minConfidence}%): ${suggested}${dryRun ? " [dry-run]" : ""}`);
  console.log(`Uncertain / skipped: ${skipped}`);
  console.log(`Best confidence: ${best}%`);
  console.log(`Worst confidence: ${worst}%`);
  if (uncertain.length) {
    console.log("");
    console.log("Uncertain matches:");
    for (const line of uncertain) console.log(`  ${line}`);
  }
  console.log("");
  console.log(
    "Suggested mappings are NOT approved. Review and approve them under More → Exercise catalogue.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
