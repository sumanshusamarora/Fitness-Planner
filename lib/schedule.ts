import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessions,
} from "@/db/schema";

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

async function dayHasCompletedSession(dayId: number): Promise<boolean> {
  const rows = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.workoutPlanDayId, dayId),
        isNotNull(workoutSessions.completedAt),
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
  const [row] = await db
    .insert(planAdjustmentProposals)
    .values({ userId, workoutPlanId: planId, type, status: "draft", proposal })
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

  if (await dayHasCompletedSession(sourceDayId)) {
    throw new Error("A completed workout cannot be moved.");
  }
  if (await dayHasCompletedSession(targetDayId)) {
    throw new Error("A completed day cannot be overwritten.");
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
  planId: number,
  dayAId: number,
  dayBId: number,
  newOriginA: string | null,
  newOriginB: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const a = (
      await tx
        .select()
        .from(workoutPlanDays)
        .where(and(eq(workoutPlanDays.id, dayAId), eq(workoutPlanDays.workoutPlanId, planId)))
        .limit(1)
    )[0];
    const b = (
      await tx
        .select()
        .from(workoutPlanDays)
        .where(and(eq(workoutPlanDays.id, dayBId), eq(workoutPlanDays.workoutPlanId, planId)))
        .limit(1)
    )[0];
    if (!a || !b) throw new Error("Day not found.");

    const idsA = (
      await tx
        .select({ id: workoutPlanExercises.id })
        .from(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, dayAId))
    ).map((r) => r.id);
    const idsB = (
      await tx
        .select({ id: workoutPlanExercises.id })
        .from(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, dayBId))
    ).map((r) => r.id);

    if (idsA.length) {
      await tx
        .update(workoutPlanExercises)
        .set({ workoutPlanDayId: dayBId })
        .where(inArray(workoutPlanExercises.id, idsA));
    }
    if (idsB.length) {
      await tx
        .update(workoutPlanExercises)
        .set({ workoutPlanDayId: dayAId })
        .where(inArray(workoutPlanExercises.id, idsB));
    }
    await tx.update(workoutPlanDays).set({ title: b.title, origin: newOriginA }).where(eq(workoutPlanDays.id, dayAId));
    await tx.update(workoutPlanDays).set({ title: a.title, origin: newOriginB }).where(eq(workoutPlanDays.id, dayBId));
  });
}

/** Idempotently apply a reviewed adjustment. */
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

    if (row.type === "move_workout" || row.type === "swap_days") {
      const p = proposal as MoveSwapProposal;
      if (await dayHasCompletedSession(p.sourceDayId)) {
        throw new Error("A completed workout cannot be moved.");
      }
      if (await dayHasCompletedSession(p.targetDayId)) {
        throw new Error("A completed day cannot be overwritten.");
      }
      // Origin marker: the day that receives the moved workout is "moved";
      // the source day becomes a rest day (no marker).
      const isMoveToRest = row.type === "move_workout";
      await swapDayContent(
        row.workoutPlanId,
        p.sourceDayId,
        p.targetDayId,
        isMoveToRest ? null : "moved",
        isMoveToRest ? "moved" : "moved",
      );
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
      const existing = await tx
        .select({ id: workoutPlanExercises.id })
        .from(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, p.dayId));
      if (existing.length > 0) throw new Error("That day already has a workout.");
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
    }

    await tx
      .update(planAdjustmentProposals)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(planAdjustmentProposals.id, proposalId));

    return { ok: true as const };
  });
}
