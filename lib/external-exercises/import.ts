import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { externalExercises } from "@/db/schema";
import { externalExerciseContentHash } from "./contentHash";
import { normalizeMuscleWikiRecord, isValidMuscleWikiRecord, PROVIDER } from "./providers/musclewiki";
import type { ImportStats, NormalizedExternalExercise, RawExternalRecord } from "./types";

const PROVIDER_NORMALIZERS = {
  [PROVIDER]: {
    normalize: normalizeMuscleWikiRecord,
    validate: isValidMuscleWikiRecord,
  },
} as const;

type ProviderName = keyof typeof PROVIDER_NORMALIZERS;

function normalizeRecord(
  provider: ProviderName,
  raw: RawExternalRecord,
): { normalized: NormalizedExternalExercise; valid: boolean; reason?: string } {
  const normalized = PROVIDER_NORMALIZERS[provider].normalize(raw);
  const check = PROVIDER_NORMALIZERS[provider].validate(raw, normalized);
  return { normalized, valid: check.valid, reason: check.reason };
}

/** Stream a JSONL file line-by-line, tolerating malformed lines. */
export async function* readJsonlFile(
  path: string,
): AsyncGenerator<RawExternalRecord> {
  const rl = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as RawExternalRecord;
    } catch {
      yield { __parseError: true, error: "malformed JSON line" } as unknown as RawExternalRecord;
    }
  }
}

/**
 * Upsert normalized records into `external_exercises`, keyed by
 * (provider, external_id). Returns counts and never deletes records that are
 * absent from the current snapshot.
 */
export async function applyExternalRecords(
  records: NormalizedExternalExercise[],
  provider: ProviderName = PROVIDER,
): Promise<ImportStats> {
  const stats: ImportStats = {
    read: records.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    skipped: 0,
  };

  // Preload existing hashes for the provider to avoid a query per record.
  const existing = await db
    .select({ id: externalExercises.id, externalId: externalExercises.externalId, contentHash: externalExercises.contentHash })
    .from(externalExercises)
    .where(eq(externalExercises.provider, provider));
  const hashByExternalId = new Map(
    existing.map((row) => [row.externalId, row.contentHash]),
  );

  for (const record of records) {
    if (!record.externalId || !record.name) {
      stats.invalid += 1;
      continue;
    }
    const hash = externalExerciseContentHash(record);
    const previousHash = hashByExternalId.get(record.externalId);

    if (previousHash === undefined) {
      await db.insert(externalExercises).values({
        provider: record.provider,
        externalId: record.externalId,
        slug: record.slug,
        name: record.name,
        sourceUrl: record.sourceUrl,
        primaryMuscles: record.primaryMuscles,
        secondaryMuscles: record.secondaryMuscles,
        equipment: record.equipment,
        difficulty: record.difficulty,
        exerciseType: record.exerciseType,
        instructionsSource: record.instructionsSource,
        rawMetadata: record.rawMetadata,
        contentHash: hash,
        fetchedAt: new Date(),
      });
      stats.inserted += 1;
    } else if (previousHash !== hash) {
      await db
        .update(externalExercises)
        .set({
          slug: record.slug,
          name: record.name,
          sourceUrl: record.sourceUrl,
          primaryMuscles: record.primaryMuscles,
          secondaryMuscles: record.secondaryMuscles,
          equipment: record.equipment,
          difficulty: record.difficulty,
          exerciseType: record.exerciseType,
          instructionsSource: record.instructionsSource,
          rawMetadata: record.rawMetadata,
          contentHash: hash,
          fetchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(externalExercises.externalId, record.externalId));
      stats.updated += 1;
    } else {
      stats.unchanged += 1;
    }
  }

  return stats;
}

/**
 * Read, normalize, validate and upsert a JSONL snapshot. This is the single
 * entry point used by the import command.
 */
export async function importJsonlFile(path: string): Promise<ImportStats> {
  const stats: ImportStats = {
    read: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    skipped: 0,
  };

  const normalized: NormalizedExternalExercise[] = [];
  for await (const raw of readJsonlFile(path)) {
    stats.read += 1;
    if ((raw as { __parseError?: boolean }).__parseError) {
      stats.invalid += 1;
      continue;
    }
    const { normalized: record, valid } = normalizeRecord(PROVIDER, raw);
    if (!valid) {
      stats.invalid += 1;
      continue;
    }
    normalized.push(record);
  }

  const result = await applyExternalRecords(normalized, PROVIDER);
  return {
    read: stats.read,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    invalid: stats.invalid + result.invalid,
    skipped: result.skipped,
  };
}
