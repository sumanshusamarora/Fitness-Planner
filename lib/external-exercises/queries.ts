import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  exerciseExternalMappings,
  exercises,
  externalExercises,
} from "@/db/schema";
import { canonicalEquipmentGroup, canonicalMuscleGroup } from "./normalize";
import { matchExternalCandidates, type ExternalExerciseForMatch } from "./matching";
import type {
  CanonicalExerciseSummary,
  CatalogueSearchFilter,
  CatalogueSearchResult,
  ExternalProvider,
  ExerciseMatchCandidate,
  MappingStatus,
} from "./types";

export const DEFAULT_PROVIDER: ExternalProvider = "musclewiki";

type ExternalExerciseRow = typeof externalExercises.$inferSelect;

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toForMatch(row: ExternalExerciseRow): ExternalExerciseForMatch {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    primaryMuscles: asStringList(row.primaryMuscles),
    secondaryMuscles: asStringList(row.secondaryMuscles),
    equipment: asStringList(row.equipment),
    difficulty: row.difficulty,
    exerciseType: row.exerciseType,
  };
}

function toSearchResult(row: ExternalExerciseRow): CatalogueSearchResult {
  return {
    id: row.id,
    provider: row.provider as ExternalProvider,
    externalId: row.externalId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    primaryMuscles: asStringList(row.primaryMuscles),
    secondaryMuscles: asStringList(row.secondaryMuscles),
    equipment: asStringList(row.equipment),
    difficulty: row.difficulty,
    exerciseType: row.exerciseType,
  };
}

/**
 * Search the local catalogue. Queries PostgreSQL only (never the provider).
 * Name matches use ILIKE; muscle/equipment filters canonicalize to groups and
 * match in-process against the (small) reference table.
 */
export async function searchExerciseCatalogue(
  filter: CatalogueSearchFilter = {},
  limit = 25,
): Promise<CatalogueSearchResult[]> {
  let query = db.select().from(externalExercises).$dynamic();

  if (filter.q && filter.q.trim()) {
    query = query.where(ilike(externalExercises.name, `%${filter.q.trim()}%`));
  }

  const rows = await query.limit(1000);

  const muscleGroups = new Set((filter.muscles ?? []).map(canonicalMuscleGroup));
  const equipmentGroups = new Set((filter.equipment ?? []).map(canonicalEquipmentGroup));
  const difficulty = filter.difficulty ?? [];

  const filtered = rows.filter((row) => {
    if (muscleGroups.size > 0) {
      const primary = asStringList(row.primaryMuscles).map(canonicalMuscleGroup);
      const secondary = asStringList(row.secondaryMuscles).map(canonicalMuscleGroup);
      const hit = [...primary, ...secondary].some((g) => muscleGroups.has(g));
      if (!hit) return false;
    }
    if (equipmentGroups.size > 0) {
      const eq = asStringList(row.equipment).map(canonicalEquipmentGroup);
      if (!eq.some((g) => equipmentGroups.has(g))) return false;
    }
    if (difficulty.length > 0 && row.difficulty) {
      if (!difficulty.some((d) => d.toLowerCase() === row.difficulty!.toLowerCase())) return false;
    }
    if (filter.exerciseType && row.exerciseType) {
      if (row.exerciseType.toLowerCase() !== filter.exerciseType.toLowerCase()) return false;
    }
    return true;
  });

  return filtered.slice(0, limit).map(toSearchResult);
}

/**
 * Future substitution foundation: find external exercises by structured
 * criteria, independent of any canonical exercise id.
 */
export async function findExternalExercises(criteria: {
  primaryMuscle?: string;
  equipment?: string[];
  difficulty?: string[];
  exerciseType?: string;
}): Promise<CatalogueSearchResult[]> {
  return searchExerciseCatalogue({
    muscles: criteria.primaryMuscle ? [criteria.primaryMuscle] : undefined,
    equipment: criteria.equipment,
    difficulty: criteria.difficulty,
    exerciseType: criteria.exerciseType,
  });
}

/** Fetch the approved external exercise mapped to a canonical exercise, if any. */
export async function getMappedExternalExercise(
  exerciseId: number,
  provider: ExternalProvider = DEFAULT_PROVIDER,
): Promise<CatalogueSearchResult | null> {
  const rows = await db
    .select({
      id: externalExercises.id,
      provider: externalExercises.provider,
      externalId: externalExercises.externalId,
      name: externalExercises.name,
      sourceUrl: externalExercises.sourceUrl,
      primaryMuscles: externalExercises.primaryMuscles,
      secondaryMuscles: externalExercises.secondaryMuscles,
      equipment: externalExercises.equipment,
      difficulty: externalExercises.difficulty,
      exerciseType: externalExercises.exerciseType,
    })
    .from(exerciseExternalMappings)
    .innerJoin(
      externalExercises,
      eq(exerciseExternalMappings.externalExerciseId, externalExercises.id),
    )
    .where(
      and(
        eq(exerciseExternalMappings.exerciseId, exerciseId),
        eq(exerciseExternalMappings.provider, provider),
        eq(exerciseExternalMappings.status, "approved"),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    provider: row.provider as ExternalProvider,
    externalId: row.externalId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    primaryMuscles: asStringList(row.primaryMuscles),
    secondaryMuscles: asStringList(row.secondaryMuscles),
    equipment: asStringList(row.equipment),
    difficulty: row.difficulty,
    exerciseType: row.exerciseType,
  };
}

/** Rank catalogue candidates for a canonical exercise. */
export async function findExerciseCandidates(
  canonical: CanonicalExerciseSummary,
  provider: ExternalProvider = DEFAULT_PROVIDER,
  limit = 10,
): Promise<ExerciseMatchCandidate[]> {
  const rows = await db
    .select()
    .from(externalExercises)
    .where(eq(externalExercises.provider, provider));
  return matchExternalCandidates(canonical, rows.map(toForMatch), limit);
}

export interface CanonicalExerciseWithMappings {
  exercise: CanonicalExerciseSummary;
  approvedMapping: {
    externalExerciseId: number;
    externalName: string;
    confidence: number | null;
    sourceUrl: string | null;
  } | null;
  suggestedMapping: {
    externalExerciseId: number;
    externalName: string;
    confidence: number | null;
  } | null;
  candidates: ExerciseMatchCandidate[];
}

/** Snapshot used by the review UI: every canonical exercise + its match state. */
export async function listCanonicalExercisesWithMappings(): Promise<{
  total: number;
  mapped: number;
  suggested: number;
  items: CanonicalExerciseWithMappings[];
}> {
  const exRows = await db
    .select()
    .from(exercises)
    .where(eq(exercises.active, true))
    .orderBy(exercises.name);

  const mappingRows = await db
    .select()
    .from(exerciseExternalMappings)
    .where(eq(exerciseExternalMappings.provider, DEFAULT_PROVIDER));

  const externalIds = [...new Set(mappingRows.map((m) => m.externalExerciseId))];
  const externalRows = externalIds.length
    ? await db
        .select({ id: externalExercises.id, name: externalExercises.name, sourceUrl: externalExercises.sourceUrl })
        .from(externalExercises)
        .where(inArray(externalExercises.id, externalIds))
    : [];
  const externalNameById = new Map(externalRows.map((r) => [r.id, r]));

  const byExercise = new Map<number, typeof mappingRows>();
  for (const m of mappingRows) {
    const list = byExercise.get(m.exerciseId) ?? [];
    list.push(m);
    byExercise.set(m.exerciseId, list);
  }

  let mapped = 0;
  let suggested = 0;
  const items: CanonicalExerciseWithMappings[] = [];

  for (const ex of exRows) {
    const mappings = byExercise.get(ex.id) ?? [];
    const approved = mappings.find((m) => m.status === "approved") ?? null;
    const suggestedRow =
      mappings
        .filter((m) => m.status === "suggested")
        .sort((a, b) => (b.matchConfidence ?? 0) - (a.matchConfidence ?? 0))[0] ?? null;

    if (approved) mapped += 1;
    if (suggestedRow && !approved) suggested += 1;

    items.push({
      exercise: {
        id: ex.id,
        name: ex.name,
        primaryMuscle: ex.primaryMuscle,
        equipment: ex.equipment,
        category: ex.category,
      },
      approvedMapping: approved
        ? {
            externalExerciseId: approved.externalExerciseId,
            externalName: externalNameById.get(approved.externalExerciseId)?.name ?? "",
            confidence: approved.matchConfidence,
            sourceUrl: externalNameById.get(approved.externalExerciseId)?.sourceUrl ?? null,
          }
        : null,
      suggestedMapping: suggestedRow
        ? {
            externalExerciseId: suggestedRow.externalExerciseId,
            externalName: externalNameById.get(suggestedRow.externalExerciseId)?.name ?? "",
            confidence: suggestedRow.matchConfidence,
          }
        : null,
      candidates: [],
    });
  }

  return { total: exRows.length, mapped, suggested, items };
}

/** Load ranked candidates for a single canonical exercise (used by the review UI). */
export async function getCandidatesForExercise(
  canonical: CanonicalExerciseSummary,
  limit = 10,
): Promise<ExerciseMatchCandidate[]> {
  return findExerciseCandidates(canonical, DEFAULT_PROVIDER, limit);
}

async function existingMapping(
  exerciseId: number,
  externalExerciseId: number,
  provider: ExternalProvider,
) {
  return db
    .select()
    .from(exerciseExternalMappings)
    .where(
      and(
        eq(exerciseExternalMappings.exerciseId, exerciseId),
        eq(exerciseExternalMappings.externalExerciseId, externalExerciseId),
        eq(exerciseExternalMappings.provider, provider),
      ),
    )
    .limit(1);
}

/** Record a suggested mapping (idempotent — never promotes to approved). */
export async function upsertSuggestedMapping(
  exerciseId: number,
  candidate: ExerciseMatchCandidate,
) {
  const existing = await existingMapping(exerciseId, candidate.externalExerciseId, candidate.provider);
  if (existing.length > 0) {
    const row = existing[0];
    if (row.status === "approved" || row.status === "rejected") return row;
    return (
      await db
        .update(exerciseExternalMappings)
        .set({ matchConfidence: candidate.confidence, matchMethod: "deterministic-v1", updatedAt: new Date() })
        .where(eq(exerciseExternalMappings.id, row.id))
        .returning()
    )[0];
  }
  return (
    await db
      .insert(exerciseExternalMappings)
      .values({
        exerciseId,
        externalExerciseId: candidate.externalExerciseId,
        provider: candidate.provider,
        status: "suggested",
        matchConfidence: candidate.confidence,
        matchMethod: "deterministic-v1",
      })
      .returning()
  )[0];
}

/**
 * Approve a mapping. Demotes any other approved mapping for the same
 * exercise + provider first, so exactly one approved mapping remains.
 */
export async function approveMapping(
  exerciseId: number,
  externalExerciseId: number,
  provider: ExternalProvider = DEFAULT_PROVIDER,
) {
  return db.transaction(async (tx) => {
    await tx
      .update(exerciseExternalMappings)
      .set({ status: "suggested", approvedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(exerciseExternalMappings.exerciseId, exerciseId),
          eq(exerciseExternalMappings.provider, provider),
          eq(exerciseExternalMappings.status, "approved"),
        ),
      );

    const existing = await tx
      .select()
      .from(exerciseExternalMappings)
      .where(
        and(
          eq(exerciseExternalMappings.exerciseId, exerciseId),
          eq(exerciseExternalMappings.externalExerciseId, externalExerciseId),
          eq(exerciseExternalMappings.provider, provider),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return (
        await tx
          .update(exerciseExternalMappings)
          .set({ status: "approved", approvedAt: new Date(), rejectedAt: null, updatedAt: new Date() })
          .where(eq(exerciseExternalMappings.id, existing[0].id))
          .returning()
      )[0];
    }
    return (
      await tx
        .insert(exerciseExternalMappings)
        .values({
          exerciseId,
          externalExerciseId,
          provider,
          status: "approved",
          matchMethod: "manual",
          approvedAt: new Date(),
        })
        .returning()
    )[0];
  });
}

/** Reject a mapping. A rejected mapping must not be auto-reused by the matcher. */
export async function rejectMapping(
  exerciseId: number,
  externalExerciseId: number,
  provider: ExternalProvider = DEFAULT_PROVIDER,
) {
  const existing = await existingMapping(exerciseId, externalExerciseId, provider);
  if (existing.length > 0) {
    return (
      await db
        .update(exerciseExternalMappings)
        .set({ status: "rejected", rejectedAt: new Date(), approvedAt: null, updatedAt: new Date() })
        .where(eq(exerciseExternalMappings.id, existing[0].id))
        .returning()
    )[0];
  }
  return (
    await db
      .insert(exerciseExternalMappings)
      .values({
        exerciseId,
        externalExerciseId,
        provider,
        status: "rejected",
        matchMethod: "manual",
        rejectedAt: new Date(),
      })
      .returning()
  )[0];
}

export interface ExternalExerciseReference {
  exerciseId: number;
  provider: ExternalProvider;
  name: string;
  sourceUrl: string | null;
  instructionsSource: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
}

function pickReferenceMedia(rawMetadata: unknown): { videoUrl: string | null; imageUrl: string | null } {
  if (!rawMetadata || typeof rawMetadata !== "object") return { videoUrl: null, imageUrl: null };
  const meta = rawMetadata as Record<string, unknown>;
  const videos = Array.isArray(meta.videos) ? meta.videos.filter((v): v is string => typeof v === "string") : [];
  const images = Array.isArray(meta.images) ? meta.images.filter((v): v is string => typeof v === "string") : [];
  const gifs = Array.isArray(meta.gifs) ? meta.gifs.filter((v): v is string => typeof v === "string") : [];
  const front = videos.find((v) => /front/i.test(v));
  return {
    videoUrl: front ?? videos[0] ?? null,
    imageUrl: images[0] ?? gifs[0] ?? null,
  };
}

/**
 * Batch-load approved external references for a set of canonical exercise ids.
 * Used to enrich the active-workout screen without ever touching the provider.
 */
export async function getApprovedExternalReferences(
  exerciseIds: number[],
  provider: ExternalProvider = DEFAULT_PROVIDER,
): Promise<Map<number, ExternalExerciseReference>> {
  const map = new Map<number, ExternalExerciseReference>();
  if (exerciseIds.length === 0) return map;

  const rows = await db
    .select({
      exerciseId: exerciseExternalMappings.exerciseId,
      name: externalExercises.name,
      sourceUrl: externalExercises.sourceUrl,
      instructionsSource: externalExercises.instructionsSource,
      rawMetadata: externalExercises.rawMetadata,
    })
    .from(exerciseExternalMappings)
    .innerJoin(
      externalExercises,
      eq(exerciseExternalMappings.externalExerciseId, externalExercises.id),
    )
    .where(
      and(
        inArray(exerciseExternalMappings.exerciseId, exerciseIds),
        eq(exerciseExternalMappings.provider, provider),
        eq(exerciseExternalMappings.status, "approved"),
      ),
    );

  for (const row of rows) {
    const media = pickReferenceMedia(row.rawMetadata);
    map.set(row.exerciseId, {
      exerciseId: row.exerciseId,
      provider,
      name: row.name,
      sourceUrl: row.sourceUrl,
      instructionsSource: row.instructionsSource,
      videoUrl: media.videoUrl,
      imageUrl: media.imageUrl,
    });
  }

  return map;
}

export type { MappingStatus };
