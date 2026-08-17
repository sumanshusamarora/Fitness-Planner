import "dotenv/config";
import { importJsonlFile } from "@/lib/external-exercises/import";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run exercises:import -- <path-to-jsonl>");
    process.exit(1);
  }

  const stats = await importJsonlFile(path);

  console.log("MuscleWiki import");
  console.log("");
  console.log(`Read:       ${stats.read.toLocaleString()}`);
  console.log(`Inserted:   ${stats.inserted.toLocaleString()}`);
  console.log(`Updated:    ${stats.updated.toLocaleString()}`);
  console.log(`Unchanged:  ${stats.unchanged.toLocaleString()}`);
  console.log(`Invalid:    ${stats.invalid.toLocaleString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
