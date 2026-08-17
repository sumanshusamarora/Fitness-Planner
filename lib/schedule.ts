import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessions,
} from "@/db/schema";
import { DomainError } from "./errors";
import type { CoachRunMetadata } from "./coach/ai/types";
import {
  captureDays,
  computePlanStateHash,
  findMoveChainHead,
  recordRevision,
} from "./plan-revisions";
import type { Queryable } from "./session-guards";

export type AdjustmentType =
  | "move_workout"
  | "swap_days"
  | "add_rest_day_workout";

export interface MoveSwapProposal {
  kind: "move" | "swap";
  sourceDayId: number;
  targetDayId: number;
  sourceDayName: string;
  targetDayName: string;
  sourceTitle: string;
  targetTitle: string;
}

export interface AddWorkoutExercise {
  exerciseId: number;
  name: string;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
}

export interface AddWorkoutProposal {
  kind: "add";
  dayId: number;
  effort: "light" | "usual" | "heavy";
  title: string;
  reason: string;
  note: string | null;
  exercises: AddWorkoutExercise[];
  /** Set when this proposal came from the runtime AI coach. */
  aiMetadata?: CoachRunMetadata;
  aiRationale?: string[];
  confidence?: "high" | "medium" | "needs_input";
  safetyFlags?: string[];
}

export type AdjustmentProposalData = MoveSwapProposal | AddWorkoutProposal;

export interface StoredAdjustment {
  id: number;
  type: AdjustmentType;
  status: string;
  proposal: AdjustmentProposalData;
}

async function getPlanDayOwned(
  planId: number,
  dayId: number,
): Promise<{ id: number; dayNumber: number; dayName: string; title: string; origin: string | null } | null> {
  const rows = await db
    .select()
    .from(workoutPlanDays)
    .where(and(eq(workoutPlanDays.id, dayId), eq(workoutPlanDays.workoutPlanId, planId)))
    .limit(1);
  return rows[0] ?? null;
}

async function dayHasRecordedSession(q: Queryable, dayId: number): Promise<boolean> {
  const rows = await q
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.workoutPlanDayId, dayId),
        inArray(workoutSessions.status, [
          "in_progress",
          "completed",
          "ended_early",
          "skipped",
        ]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function dayExerciseCount(dayId: number): Promise<number> {
  const rows = await db
    .select({ id: workoutPlanExercises.id })
    .from(workoutPlanExercises)
    .where(eq(workoutPlanExercises.workoutPlanDayId, dayId));
  return rows.length;
}

export async function getAdjustment(userId: number, proposalId: number): Promise<StoredAdjustment | null> {
  const rows = await db
    .select()
    .from(planAdjustmentProposals)
    .where(and(eq(planAdjustmentProposals.id, proposalId), eq(planAdjustmentProposals.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as AdjustmentType,
    status: row.status,
    proposal: row.proposal as unknown as AdjustmentProposalData,
  };
}

export async function persistAdjustment(
  userId: number,
  planId: number,
  type: AdjustmentType,
  proposal: AdjustmentProposalData,
): Promise<StoredAdjustment> {
  const stateHash = await computePlanStateHash(planId);
  const [row] = await db
    .insert(planAdjustmentProposals)
    .values({ userId, workoutPlanId: planId, type, status: "draft", proposal, stateHash })
    .returning();
  return { id: row.id, type: row.type as AdjustmentType, status: row.status, proposal };
}

/** Propose moving a workout to another day (or swapping two workout days). */
export async function proposeMoveOrSwap(
  userId: number,
  planId: number,
  sourceDayId: number,
  targetDayId: number,
): Promise<StoredAdjustment> {
  const plan = (
    await db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, planId), eq(workoutPlans.userId, userId)))
      .limit(1)
  )[0];
  if (!plan) throw new Error("Plan not found.");
  if (sourceDayId === targetDayId) throw new Error("Pick a different day.");

  const [source, target] = await Promise.all([
    getPlanDayOwned(planId, sourceDayId),
    getPlanDayOwned(planId, targetDayId),
  ]);
  if (!source || !target) throw new Error("Day not found.");

  const [sourceCount, targetCount] = await Promise.all([
    dayExerciseCount(sourceDayId),
    dayExerciseCount(targetDayId),
  ]);
  if (sourceCount === 0) throw new Error("That day has no workout to move.");

  if (await dayHasRecordedSession(db, sourceDayId)) {
    throw new Error("That workout already has training recorded and can't be moved.");
  }
  if (await dayHasRecordedSession(db, targetDayId)) {
    throw new Error("That day already has training recorded and can't be overwritten.");
  }

  const isSwap = targetCount > 0;
  const proposal: MoveSwapProposal = {
    kind: isSwap ? "swap" : "move",
    sourceDayId,
    targetDayId,
    sourceDayName: source.dayName,
    targetDayName: target.dayName,
    sourceTitle: source.title,
    targetTitle: target.title,
  };

  return persistAdjustment(userId, planId, isSwap ? "swap_days" : "move_workout", proposal);
}

async function swapDayContent(
  q: Queryable,
  planId: number,
  dayAId: number,
  dayBId: number,
  newOriginA: string | null,
  newOriginB: string | null,
): Promise<void> {
  const a = (
    await q
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.id, dayAId), eq(workoutPlanDays.workoutPlanId, planId)))
      .limit(1)
  )[0];
  const b = (
    await q
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.id, dayBId), eq(workoutPlanDays.workoutPlanId, planId)))
      .limit(1)
  )[0];
  if (!a || !b) throw new Error("Day not found.");

  const idsA = (
    await q
      .select({ id: workoutPlanExercises.id })
      .from(workoutPlanExercises)
      .where(eq(workoutPlanExercises.workoutPlanDayId, dayAId))
  ).map((r) => r.id);
  const idsB = (
    await q
      .select({ id: workoutPlanExercises.id })
      .from(workoutPlanExercises)
      .where(eq(workoutPlanExercises.workoutPlanDayId, dayBId))
  ).map((r) => r.id);

  if (idsA.length) {
    await q
      .update(workoutPlanExercises)
      .set({ workoutPlanDayId: dayBId })
      .where(inArray(workoutPlanExercises.id, idsA));
  }
  if (idsB.length) {
    await q
      .update(workoutPlanExercises)
      .set({ workoutPlanDayId: dayAId })
      .where(inArray(workoutPlanExercises.id, idsB));
  }
  await q.update(workoutPlanDays).set({ title: b.title, origin: newOriginA }).where(eq(workoutPlanDays.id, dayAId));
  await q.update(workoutPlanDays).set({ title: a.title, origin: newOriginB }).where(eq(workoutPlanDays.id, dayBId));
}

/** Idempotently apply a reviewed adjustment. Records durable provenance so an
 *  unstarted move/swap can later be restored, and rejects the apply if the plan
 *  changed since the proposal was created. */
export async function applyPlanAdjustment(
  userId: number,
  proposalId: number,
  options: { confirmation: "approve" },
): Promise<{ ok: true }> {
  if (options.confirmation !== "approve") throw new Error("Explicit approval is required.");

  return db.transaction(async (tx) => {
    const row = (
      await tx
        .select()
        .from(planAdjustmentProposals)
        .where(and(eq(planAdjustmentProposals.id, proposalId), eq(planAdjustmentProposals.userId, userId)))
        .limit(1)
    )[0];
    if (!row) throw new Error("Adjustment not found.");
    if (row.status === "applied") return { ok: true as const };

    const proposal = row.proposal as unknown as AdjustmentProposalData;

    // Stale-state protection: the plan must match the state the proposal was
    // created against, otherwise the review is no longer valid.
    if (row.stateHash) {
      const currentHash = await computePlanStateHash(row.workoutPlanId, tx);
      if (currentHash !== row.stateHash) {
        throw new DomainError(
          "Your week changed since this action was created. Review it again.",
          "PLAN_REVISION_STALE",
          409,
        );
      }
    }

    if (row.type === "move_workout" || row.type === "swap_days") {
      const p = proposal as MoveSwapProposal;
      if (await dayHasRecordedSession(tx, p.sourceDayId)) {
        throw new Error("That workout already has training recorded and can't be moved.");
      }
      if (await dayHasRecordedSession(tx, p.targetDayId)) {
        throw new Error("That day already has training recorded and can't be overwritten.");
      }
      // Origin marker: the day that receives the moved workout is "moved";
      // the source day becomes a rest day (no marker).
      const isMoveToRest = row.type === "move_workout";
      const hashBefore =
        row.stateHash ?? (await computePlanStateHash(row.workoutPlanId, tx));
      const before = await captureDays(tx, [p.sourceDayId, p.targetDayId]);
      // A "Move Again" on an already-moved day chains the earlier move so the
      // whole chain restores to the pre-move original day.
      const chainParent = isMoveToRest
        ? await findMoveChainHead(tx, row.workoutPlanId, p.sourceDayId)
        : null;
      await swapDayContent(
        tx,
        row.workoutPlanId,
        p.sourceDayId,
        p.targetDayId,
        isMoveToRest ? null : "moved",
        isMoveToRest ? "moved" : "moved",
      );
      const after = await captureDays(tx, [p.sourceDayId, p.targetDayId]);
      const hashAfter = await computePlanStateHash(row.workoutPlanId, tx);
      await recordRevision(tx, {
        userId,
        workoutPlanId: row.workoutPlanId,
        kind: isMoveToRest ? "move" : "swap",
        beforeSnapshot: before,
        afterSnapshot: after,
        stateHashBefore: hashBefore,
        stateHashAfter: hashAfter,
        reversesRevisionId: chainParent ?? null,
      });
    } else if (row.type === "add_rest_day_workout") {
      const p = proposal as AddWorkoutProposal;
      const day = (
        await tx
          .select()
          .from(workoutPlanDays)
          .where(and(eq(workoutPlanDays.id, p.dayId), eq(workoutPlanDays.workoutPlanId, row.workoutPlanId)))
          .limit(1)
      )[0];
      if (!day) throw new Error("Day not found.");
      // A day with any recorded session is immutable for scheduling.
      const recorded = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.workoutPlanDayId, p.dayId),
            inArray(workoutSessions.status, [
              "in_progress",
              "completed",
              "ended_early",
              "skipped",
            ]),
          ),
        )
        .limit(1);
      if (recorded.length > 0) {
        throw new Error("That day already has training recorded and can't be overwritten.");
      }
      const existing = await tx
        .select({ id: workoutPlanExercises.id })
        .from(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, p.dayId));
      if (existing.length > 0) throw new Error("That day already has a workout.");
      const hashBefore =
        row.stateHash ?? (await computePlanStateHash(row.workoutPlanId, tx));
      const before = await captureDays(tx, [p.dayId]);
      for (const ex of p.exercises) {
        await tx.insert(workoutPlanExercises).values({
          workoutPlanDayId: p.dayId,
          exerciseId: ex.exerciseId,
          position: ex.position,
          targetSets: ex.targetSets,
          minReps: ex.minReps,
          maxReps: ex.maxReps,
          targetRpe: ex.targetRpe,
          suggestedWeightKg: ex.suggestedWeightKg,
          restSeconds: ex.restSeconds,
          notes: null,
        });
      }
      await tx
        .update(workoutPlanDays)
        .set({ title: p.title, origin: "extra" })
        .where(eq(workoutPlanDays.id, p.dayId));
      const after = await captureDays(tx, [p.dayId]);
      const hashAfter = await computePlanStateHash(row.workoutPlanId, tx);
      await recordRevision(tx, {
        userId,
        workoutPlanId: row.workoutPlanId,
        kind: "add_extra",
        beforeSnapshot: before,
        afterSnapshot: after,
        stateHashBefore: hashBefore,
        stateHashAfter: hashAfter,
      });
    }

    await tx
      .update(planAdjustmentProposals)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(planAdjustmentProposals.id, proposalId));

    return { ok: true as const };
  });
}

/**
 * Remove an optional, unstarted "extra" workout and return the day to Rest.
 *
 * Creates no workout session, no skipped outcome, and no adherence penalty.
 * Allowed only while the extra is still unstarted (no session at all). To
 * remove an accidental empty start, the user must Cancel Start first; once
 * actual work exists the session is real history and cannot be erased.
 */
export async function removeExtraWorkout(
  userId: number,
  planDayId: number,
): Promise<{ ok: true; alreadyRemoved?: boolean }> {
  return db.transaction(async (tx) => {
    const day = (
      await tx
        .select()
        .from(workoutPlanDays)
        .where(eq(workoutPlanDays.id, planDayId))
        .limit(1)
    )[0];
    if (!day) throw new DomainError("Day not found.", "PLAN_DAY_NOT_FOUND", 404);

    const plan = (
      await tx
        .select({ id: workoutPlans.id })
        .from(workoutPlans)
        .where(and(eq(workoutPlans.id, day.workoutPlanId), eq(workoutPlans.userId, userId)))
        .limit(1)
    )[0];
    if (!plan) throw new DomainError("Day not found.", "PLAN_DAY_NOT_FOUND", 404);

    // Any session — in progress or terminal — blocks removal.
    const started = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(eq(workoutSessions.workoutPlanDayId, planDayId))
      .limit(1);
    if (started.length > 0) {
      throw new DomainError(
        "This extra workout has started. Cancel the empty start first, or end the workout early if work is logged.",
        "PLAN_DAY_ALREADY_STARTED",
        409,
      );
    }

    const exercises = await tx
      .select({ id: workoutPlanExercises.id })
      .from(workoutPlanExercises)
      .where(eq(workoutPlanExercises.workoutPlanDayId, planDayId))
      .limit(1);

    if (day.origin !== "extra") {
      if (exercises.length === 0) {
        // Already removed; a double-tap must never create a session or error.
        return { ok: true as const, alreadyRemoved: true };
      }
      throw new DomainError(
        "Only an optional extra workout can be removed.",
        "PLAN_DAY_NOT_EXTRA",
        409,
      );
    }

    const hashBefore = await computePlanStateHash(day.workoutPlanId, tx);
    const before = await captureDays(tx, [planDayId]);
    await tx
      .delete(workoutPlanExercises)
      .where(eq(workoutPlanExercises.workoutPlanDayId, planDayId));
    await tx
      .update(workoutPlanDays)
      .set({ title: "Rest", origin: null })
      .where(eq(workoutPlanDays.id, planDayId));
    const after = await captureDays(tx, [planDayId]);
    const hashAfter = await computePlanStateHash(day.workoutPlanId, tx);
    await recordRevision(tx, {
      userId,
      workoutPlanId: day.workoutPlanId,
      kind: "remove_extra",
      beforeSnapshot: before,
      afterSnapshot: after,
      stateHashBefore: hashBefore,
      stateHashAfter: hashAfter,
    });

    return { ok: true as const };
  });
}
