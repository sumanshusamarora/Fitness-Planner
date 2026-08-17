import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  planRevisions,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessions,
} from "@/db/schema";
import { DomainError } from "./errors";
import type { Queryable } from "./session-guards";

/**
 * Deterministic provenance for reversible future-plan actions.
 *
 * A `plan_revisions` row records the exact day-level state before and after a
 * move / swap / add-extra / remove-extra. Restore re-reads the live plan,
 * verifies the stored `state_hash_after` still matches, checks no affected day
 * has live or historical training, then replays the before snapshot in one
 * transaction. Historical training is never erased: any session on an affected
 * day makes a restore fail atomically.
 */

export type PlanRevisionKind = "move" | "swap" | "add_extra" | "remove_extra";

export const RESTORABLE_REVISION_KINDS: PlanRevisionKind[] = ["move", "swap"];

export interface PlanRevisionExercise {
  exerciseId: number;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
  notes: string | null;
}

export interface PlanRevisionDay {
  dayId: number;
  dayNumber: number;
  dayName: string;
  title: string;
  origin: string | null;
  exercises: PlanRevisionExercise[];
}

export interface PlanRevisionSnapshot {
  days: PlanRevisionDay[];
}

export interface PlanRevisionRecord {
  id: number;
  userId: number;
  workoutPlanId: number;
  kind: PlanRevisionKind;
  beforeSnapshot: PlanRevisionSnapshot;
  afterSnapshot: PlanRevisionSnapshot;
  stateHashBefore: string;
  stateHashAfter: string;
  reversesRevisionId: number | null;
  restoredAt: Date | null;
}

/**
 * Deterministic hash of the full plan state (session outcomes + exercise
 * prescriptions). Mirrors the week-rebuild hash so revisions and rebuild
 * proposals share the same stale-state definition. Accepts a transaction
 * handle so it can run inside a mutation context.
 */
export async function computePlanStateHash(
  planId: number,
  q: Queryable = db,
): Promise<string> {
  const days = await q
    .select({ id: workoutPlanDays.id, dayNumber: workoutPlanDays.dayNumber })
    .from(workoutPlanDays)
    .where(eq(workoutPlanDays.workoutPlanId, planId))
    .orderBy(asc(workoutPlanDays.dayNumber));
  const dayIds = days.map((d) => d.id);

  const [sessions, exerciseRows] = await Promise.all([
    q
      .select({
        workoutPlanDayId: workoutSessions.workoutPlanDayId,
        status: workoutSessions.status,
      })
      .from(workoutSessions)
      .where(inArray(workoutSessions.workoutPlanDayId, dayIds)),
    q
      .select({
        dayId: workoutPlanExercises.workoutPlanDayId,
        exerciseId: workoutPlanExercises.exerciseId,
        targetSets: workoutPlanExercises.targetSets,
        minReps: workoutPlanExercises.minReps,
        maxReps: workoutPlanExercises.maxReps,
        targetRpe: workoutPlanExercises.targetRpe,
        suggestedWeightKg: workoutPlanExercises.suggestedWeightKg,
        restSeconds: workoutPlanExercises.restSeconds,
      })
      .from(workoutPlanExercises)
      .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds)),
  ]);

  const sessionsByDay = new Map<number, string[]>();
  for (const session of sessions) {
    const list = sessionsByDay.get(session.workoutPlanDayId) ?? [];
    list.push(session.status);
    sessionsByDay.set(session.workoutPlanDayId, list);
  }
  const exercisesByDay = new Map<number, string[]>();
  for (const row of exerciseRows) {
    const list = exercisesByDay.get(row.dayId) ?? [];
    list.push(
      `${row.exerciseId}:${row.targetSets}:${row.minReps}:${row.maxReps}:${row.targetRpe}:${row.suggestedWeightKg}:${row.restSeconds}`,
    );
    exercisesByDay.set(row.dayId, list);
  }

  const parts = days.map((day) => {
    const sessions = [...(sessionsByDay.get(day.id) ?? [])].sort().join(",");
    const exercises = [...(exercisesByDay.get(day.id) ?? [])].sort().join("|");
    return `${day.dayNumber}[${sessions}]{${exercises}}`;
  });

  return createHash("sha256").update(parts.join(";")).digest("hex");
}

/** Captures the exact future-plan state of the given plan days. */
export async function captureDays(
  q: Queryable,
  dayIds: number[],
): Promise<PlanRevisionSnapshot> {
  const dayRows = await q
    .select()
    .from(workoutPlanDays)
    .where(inArray(workoutPlanDays.id, dayIds))
    .orderBy(asc(workoutPlanDays.dayNumber));
  const exerciseRows =
    dayIds.length > 0
      ? await q
          .select()
          .from(workoutPlanExercises)
          .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds))
          .orderBy(asc(workoutPlanExercises.position))
      : [];

  const byDay = new Map<number, PlanRevisionDay>(
    dayRows.map((d) => [
      d.id,
      {
        dayId: d.id,
        dayNumber: d.dayNumber,
        dayName: d.dayName,
        title: d.title,
        origin: d.origin,
        exercises: [],
      },
    ]),
  );

  for (const row of exerciseRows) {
    const entry = byDay.get(row.workoutPlanDayId);
    if (!entry) continue;
    entry.exercises.push({
      exerciseId: row.exerciseId,
      position: row.position,
      targetSets: row.targetSets,
      minReps: row.minReps,
      maxReps: row.maxReps,
      targetRpe: row.targetRpe,
      suggestedWeightKg: row.suggestedWeightKg,
      restSeconds: row.restSeconds,
      notes: row.notes,
    });
  }

  return { days: dayRows.map((d) => byDay.get(d.id)!) };
}

interface RecordRevisionInput {
  userId: number;
  workoutPlanId: number;
  kind: PlanRevisionKind;
  beforeSnapshot: PlanRevisionSnapshot;
  afterSnapshot: PlanRevisionSnapshot;
  stateHashBefore: string;
  stateHashAfter: string;
  reversesRevisionId?: number | null;
}

/** Persists a revision row. Must run inside the same tx that applied it. */
export async function recordRevision(
  q: Queryable,
  input: RecordRevisionInput,
): Promise<number> {
  const [row] = await q
    .insert(planRevisions)
    .values({
      userId: input.userId,
      workoutPlanId: input.workoutPlanId,
      kind: input.kind,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
      stateHashBefore: input.stateHashBefore,
      stateHashAfter: input.stateHashAfter,
      reversesRevisionId: input.reversesRevisionId ?? null,
    })
    .returning();
  return row.id;
}

async function loadOwnedRevision(
  q: Queryable,
  userId: number,
  revisionId: number,
): Promise<PlanRevisionRecord> {
  const row = (
    await q
      .select()
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.id, revisionId),
          eq(planRevisions.userId, userId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new DomainError("This change can't be restored.", "PLAN_REVISION_NOT_FOUND", 404);
  }
  return {
    id: row.id,
    userId: row.userId,
    workoutPlanId: row.workoutPlanId,
    kind: row.kind as PlanRevisionKind,
    beforeSnapshot: row.beforeSnapshot as unknown as PlanRevisionSnapshot,
    afterSnapshot: row.afterSnapshot as unknown as PlanRevisionSnapshot,
    stateHashBefore: row.stateHashBefore,
    stateHashAfter: row.stateHashAfter,
    reversesRevisionId: row.reversesRevisionId,
    restoredAt: row.restoredAt,
  };
}

/**
 * Returns the id of the most recent un-restored *move* revision whose after
 * snapshot currently holds the moved workout on `dayId`. Used to chain a
 * "Move Again" so a Wed → Thu → Sat chain can be restored to the original day
 * in one step.
 */
export async function findMoveChainHead(
  q: Queryable,
  workoutPlanId: number,
  dayId: number,
): Promise<number | null> {
  const rows = await q
    .select()
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.workoutPlanId, workoutPlanId),
        eq(planRevisions.kind, "move"),
        isNull(planRevisions.restoredAt),
      ),
    )
    .orderBy(desc(planRevisions.id))
    .limit(20);
  for (const row of rows) {
    const after = row.afterSnapshot as unknown as PlanRevisionSnapshot;
    const holder = after.days.find((d) => d.dayId === dayId);
    if (holder && holder.exercises.length > 0) return row.id;
  }
  return null;
}

interface RestoreResult {
  restored: true;
  revisionId: number;
  affectedDayIds: number[];
}

/**
 * Restores an unstarted move/swap from its durable before snapshot. A move can
 * chain earlier moves (Wed → Thu → Sat); restoring the head restores the whole
 * chain back to the pre-move original day atomically.
 *
 * Rejected if the revision is not restorable, already restored, the plan state
 * no longer matches the expected state hash, or any affected day has live or
 * historical training. Never partially restores.
 */
export async function restorePlanRevision(
  userId: number,
  revisionId: number,
): Promise<RestoreResult> {
  return db.transaction(async (tx) => {
    const head = await loadOwnedRevision(tx, userId, revisionId);
    if (!RESTORABLE_REVISION_KINDS.includes(head.kind)) {
      throw new DomainError(
        "This change cannot be restored.",
        "PLAN_REVISION_NOT_RESTORABLE",
        409,
      );
    }
    if (head.restoredAt) {
      throw new DomainError(
        "This change has already been restored.",
        "PLAN_REVISION_ALREADY_RESTORED",
        409,
      );
    }

    // Resolve the full move chain: head is the newest revision, base the oldest.
    const chain = [head];
    let current = head;
    while (current.reversesRevisionId != null) {
      const parent = await loadOwnedRevision(
        tx,
        userId,
        current.reversesRevisionId,
      );
      if (parent.workoutPlanId !== head.workoutPlanId) {
        throw new DomainError(
          "This change's history is inconsistent.",
          "PLAN_REVISION_NOT_RESTORABLE",
          409,
        );
      }
      chain.unshift(parent);
      current = parent;
    }
    const base = chain[0];

    // Affected days = union across the whole chain's before/after snapshots.
    const affectedDayIds = new Set<number>();
    for (const revision of chain) {
      for (const day of [
        ...revision.beforeSnapshot.days,
        ...revision.afterSnapshot.days,
      ]) {
        affectedDayIds.add(day.dayId);
      }
    }
    const affectedList = [...affectedDayIds];

    // Verify each affected day belongs to the plan and has no live/historical
    // session. Any session blocks the restore atomically — training is never
    // erased, so this is checked before the stale-state gate.
    if (affectedList.length > 0) {
      const ownedDays = await tx
        .select({ id: workoutPlanDays.id })
        .from(workoutPlanDays)
        .where(
          and(
            inArray(workoutPlanDays.id, affectedList),
            eq(workoutPlanDays.workoutPlanId, head.workoutPlanId),
          ),
        );
      if (ownedDays.length !== affectedList.length) {
        throw new DomainError(
          "This change's days are no longer part of the plan.",
          "PLAN_REVISION_STALE",
          409,
        );
      }
      const sessions = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(inArray(workoutSessions.workoutPlanDayId, affectedList))
        .limit(1);
      if (sessions.length > 0) {
        throw new DomainError(
          "A workout on this day has started or has training recorded, so it can't be restored.",
          "PLAN_REVISION_DAY_STARTED",
          409,
        );
      }
    }

    // The plan must match exactly the state this revision was applied against.
    const currentHash = await computePlanStateHash(head.workoutPlanId, tx);
    if (currentHash !== head.stateHashAfter) {
      throw new DomainError(
        "Your week changed since this action was created. Review it again.",
        "PLAN_REVISION_STALE",
        409,
      );
    }

    // Original state of each affected day = the oldest chain revision that saw
    // it; otherwise it was a rest day before the chain.
    const originalByDay = new Map<number, PlanRevisionDay | null>();
    for (const dayId of affectedList) {
      let snapshot: PlanRevisionDay | null = null;
      for (const revision of chain) {
        const match = revision.beforeSnapshot.days.find(
          (d) => d.dayId === dayId,
        );
        if (match) {
          snapshot = match;
          break;
        }
      }
      originalByDay.set(dayId, snapshot);
    }

    // Apply the before state.
    for (const dayId of affectedList) {
      const original = originalByDay.get(dayId) ?? null;
      await tx
        .delete(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, dayId));

      if (original && original.exercises.length > 0) {
        for (const exercise of original.exercises) {
          await tx.insert(workoutPlanExercises).values({
            workoutPlanDayId: dayId,
            exerciseId: exercise.exerciseId,
            position: exercise.position,
            targetSets: exercise.targetSets,
            minReps: exercise.minReps,
            maxReps: exercise.maxReps,
            targetRpe: exercise.targetRpe,
            suggestedWeightKg: exercise.suggestedWeightKg,
            restSeconds: exercise.restSeconds,
            notes: exercise.notes,
          });
        }
        await tx
          .update(workoutPlanDays)
          .set({ title: original.title, origin: original.origin })
          .where(eq(workoutPlanDays.id, dayId));
      } else {
        await tx
          .update(workoutPlanDays)
          .set({ title: original?.title ?? "Rest", origin: original?.origin ?? null })
          .where(eq(workoutPlanDays.id, dayId));
      }
    }

    // The entire chain is now undone.
    for (const revision of chain) {
      await tx
        .update(planRevisions)
        .set({ restoredAt: new Date() })
        .where(eq(planRevisions.id, revision.id));
    }

    return { restored: true as const, revisionId: head.id, affectedDayIds: affectedList };
  });
}