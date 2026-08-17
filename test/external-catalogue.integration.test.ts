import "dotenv/config";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  exerciseExternalMappings,
  exercises,
  externalExercises,
} from "@/db/schema";
import { importJsonlFile } from "@/lib/external-exercises/import";
import {
  approveMapping,
  DEFAULT_PROVIDER,
  getMappedExternalExercise,
  rejectMapping,
  upsertSuggestedMapping,
} from "@/lib/external-exercises";

const stamp = Date.now();
const externalIds = [`test-press-${stamp}`, `test-row-${stamp}`, `test-curl-${stamp}`];
const fixture = { exerciseId: 0, mappingExternalId: 0 };

after(async () => {
  for (const id of externalIds) {
    const rows = await db.select({ id: externalExercises.id }).from(externalExercises).where(eq(externalExercises.externalId, id));
    for (const row of rows) {
      await db.delete(exerciseExternalMappings).where(eq(exerciseExternalMappings.externalExerciseId, row.id));
    }
    await db.delete(externalExercises).where(eq(externalExercises.externalId, id));
  }
  if (fixture.exerciseId) {
    await db.delete(exerciseExternalMappings).where(eq(exerciseExternalMappings.exerciseId, fixture.exerciseId));
    await db.delete(exercises).where(eq(exercises.id, fixture.exerciseId));
  }
});

function jsonl(records: unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

test("import: valid records import, malformed lines are skipped without corrupting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mw-import-"));
  const file = join(dir, "sample.jsonl");
  const valid = [
    {
      slug: externalIds[0],
      url: "https://musclewiki.com/exercise/test",
      name: "Test Press",
      description_html: "<p>push</p>",
      exercise_type: "Machine",
      muscle_group: ["Chest"],
      secondary_muscle_groups: ["Triceps"],
      difficulty: "Beginner",
      equipment: "Machine",
      videos: ["https://musclewiki.com/api-next/videos/male-test-front.mp4"],
    },
    {
      slug: externalIds[1],
      url: "https://musclewiki.com/exercise/test-row",
      name: "Test Row",
      muscle_group: ["Back"],
      equipment: "Cable",
    },
    { slug: externalIds[2], name: "Test Curl", muscle_group: ["Biceps"], equipment: "Dumbbell" },
  ];
  writeFileSync(
    file,
    jsonl([
      valid[0],
      "this is not json",
      valid[1],
      { slug: `missing-name-${stamp}`, muscle_group: ["Chest"] }, // invalid: no name
      valid[2],
    ]),
  );

  const stats = await importJsonlFile(file);
  assert.equal(stats.read, 5);
  assert.equal(stats.inserted, 3);
  assert.equal(stats.invalid, 2);

  // Re-importing the identical content leaves everything unchanged.
  const again = await importJsonlFile(file);
  assert.equal(again.inserted, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.unchanged, 3);

  rmSync(dir, { recursive: true, force: true });
});

test("import: raw provider metadata is preserved", async () => {
  const row = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[0]))
    .limit(1);
  assert.equal(row.length, 1);
  assert.equal(row[0].name, "Test Press");
  assert.equal(row[0].provider, "musclewiki");
  assert.deepEqual(row[0].primaryMuscles, ["Chest"]);
  assert.equal(row[0].instructionsSource, "<p>push</p>");
  const meta = row[0].rawMetadata as Record<string, unknown>;
  assert.equal(meta.slug, externalIds[0]);
});

test("import: unchanged record is not rewritten (stable updated_at)", async () => {
  const before = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[1]))
    .limit(1);
  const dir = mkdtempSync(join(tmpdir(), "mw-import-"));
  const file = join(dir, "sample.jsonl");
  writeFileSync(
    file,
    jsonl([{ slug: externalIds[1], url: "https://musclewiki.com/exercise/test-row", name: "Test Row", muscle_group: ["Back"], equipment: "Cable" }]),
  );
  const stats = await importJsonlFile(file);
  assert.equal(stats.unchanged, 1);
  const afterRow = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[1]))
    .limit(1);
  assert.equal(before[0].updatedAt.getTime(), afterRow[0].updatedAt.getTime());
  rmSync(dir, { recursive: true, force: true });
});

test("mapping: suggested can be approved, persists, and only one approved per exercise", async () => {
  const [ex] = await db
    .insert(exercises)
    .values({ name: `Catalogue test press ${stamp}`, category: "strength", primaryMuscle: "Chest", equipment: "Machine" })
    .returning();
  fixture.exerciseId = ex.id;

  const press = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[0]))
    .limit(1);
  const row = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[1]))
    .limit(1);

  await upsertSuggestedMapping(ex.id, {
    externalExerciseId: press[0].id,
    externalId: press[0].externalId,
    provider: DEFAULT_PROVIDER,
    name: press[0].name,
    confidence: 97,
    reasons: ["exact name match"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: [],
    equipment: ["Machine"],
    difficulty: "Beginner",
    exerciseType: null,
    sourceUrl: null,
  });

  // Not approved yet.
  assert.equal(await getMappedExternalExercise(ex.id, DEFAULT_PROVIDER), null);

  await approveMapping(ex.id, press[0].id, DEFAULT_PROVIDER);
  const mapped = await getMappedExternalExercise(ex.id, DEFAULT_PROVIDER);
  assert.equal(mapped?.externalId, externalIds[0]);

  // Approving a different candidate demotes the first.
  await approveMapping(ex.id, row[0].id, DEFAULT_PROVIDER);
  const remapped = await getMappedExternalExercise(ex.id, DEFAULT_PROVIDER);
  assert.equal(remapped?.externalId, externalIds[1]);

  const approvedCount = await db
    .select()
    .from(exerciseExternalMappings)
    .where(eq(exerciseExternalMappings.exerciseId, ex.id));
  assert.equal(approvedCount.filter((m) => m.status === "approved").length, 1);
});

test("mapping: rejected mapping is not auto-reused by approval", async () => {
  const press = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[0]))
    .limit(1);

  await rejectMapping(fixture.exerciseId, press[0].id, DEFAULT_PROVIDER);
  const rows = await db
    .select()
    .from(exerciseExternalMappings)
    .where(eq(exerciseExternalMappings.externalExerciseId, press[0].id));
  const rejected = rows.find((r) => r.status === "rejected");
  assert.ok(rejected, "rejection should be persisted");

  // Re-approving the rejected candidate is an explicit action and works, but
  // the rejected status was recorded first.
  const pressAgain = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[0]))
    .limit(1);
  await approveMapping(fixture.exerciseId, pressAgain[0].id, DEFAULT_PROVIDER);
  const afterApprove = await db
    .select()
    .from(exerciseExternalMappings)
    .where(eq(exerciseExternalMappings.externalExerciseId, pressAgain[0].id));
  assert.ok(afterApprove.some((r) => r.status === "approved"));
});

test("isolation: importing the catalogue does not alter canonical exercise history", async () => {
  // The canonical exercise created above is untouched by catalogue imports.
  const [ex] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, fixture.exerciseId))
    .limit(1);
  assert.equal(ex.name, `Catalogue test press ${stamp}`);
  assert.equal(ex.primaryMuscle, "Chest");

  // external_exercises is shared reference data: no user_id column.
  const sample = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.externalId, externalIds[0]))
    .limit(1);
  assert.equal(sample.length, 1);
  assert.equal("userId" in sample[0], false);
});
