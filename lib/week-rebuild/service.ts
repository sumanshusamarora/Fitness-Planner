import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessions,
} from "@/db/schema";
import { captureDays, computePlanStateHash as computeRevisionPlanStateHash, recordRevision } from "@/lib/plan-revisions";
import { isAICoachAvailable } from "@/lib/coach/ai/client";
import { RuntimeLLMCoachReasoner } from "@/lib/coach/reasoners/openai";
import { buildWeekRebuildContext } from "./buildContext";
import { computeWeekRebuildDiff } from "./diff";
import { proposeWeekRebuildDeterministic } from "./deterministic";
import { loadWeekFeedbackInput, storeWeekFeedback } from "./feedback";
import { validateWeekRebuildProposal } from "./validate";
import type { WeekFeedbackInput, WeekRebuildContext, WeekRebuildProposal } from "./types";

export interface StoredWeekRebuild {
  id: number;
  status: string;
  proposal: WeekRebuildProposal;
  coachSource: "llm" | "fallback";
  feedbackId: number | null;
  diff: ReturnType<typeof computeWeekRebuildDiff>;
}

async function buildProposal(context: WeekRebuildContext): Promise<WeekRebuildProposal> {
  if (isAICoachAvailable()) {
    try {
      const proposal = await new RuntimeLLMCoachReasoner().proposeWeekRebuild(context);
      return validateWeekRebuildProposal(proposal, context);
    } catch (error) {
      console.warn("[coach] AI week-rebuild unavailable; falling back to deterministic.", error);
    }
  }
  return validateWeekRebuildProposal(proposeWeekRebuildDeterministic(context), context);
}

/**
 * Deterministic hash of the current plan state (session outcomes + exercise
 * prescriptions) used to reject stale proposals at apply time.
 */
export async function computePlanStateHash(planId: number): Promise<string> {
  const days = await db
    .select({ id: workoutPlanDays.id, dayNumber: workoutPlanDays.dayNumber })
    .from(workoutPlanDays)
    .where(eq(workoutPlanDays.workoutPlanId, planId))
    .orderBy(asc(workoutPlanDays.dayNumber));
  const dayIds = days.map((d) => d.id);

  const [sessions, exerciseRows] = await Promise.all([
    db
      .select({ workoutPlanDayId: workoutSessions.workoutPlanDayId, status: workoutSessions.status })
      .from(workoutSessions)
      .where(inArray(workoutSessions.workoutPlanDayId, dayIds)),
    db
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

async function computeDiff(
  userId: number,
  workoutPlanId: number,
  feedback: WeekFeedbackInput,
  proposal: WeekRebuildProposal,
): Promise<ReturnType<typeof computeWeekRebuildDiff>> {
  const context = await buildWeekRebuildContext({ userId, workoutPlanId, feedback });
  return computeWeekRebuildDiff(context.currentWeek.days, proposal.proposedDays);
}

export async function proposeWeekRebuild(input: {  userId: number;
  workoutPlanId: number;
  feedback: WeekFeedbackInput;
  anchorDate?: Date;
}): Promise<StoredWeekRebuild> {
  const plan = (
    await db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, input.workoutPlanId), eq(workoutPlans.userId, input.userId)))
      .limit(1)
  )[0];
  if (!plan) throw new Error("Plan not found.");

  const feedbackId = await storeWeekFeedback(input.userId, input.workoutPlanId, input.feedback);
  const context = await buildWeekRebuildContext({
    userId: input.userId,
    workoutPlanId: input.workoutPlanId,
    feedback: input.feedback,
    anchorDate: input.anchorDate,
  });
  const proposal = await buildProposal(context);
  const stateHash = await computePlanStateHash(input.workoutPlanId);

  const [row] = await db
    .insert(planAdjustmentProposals)
    .values({
      userId: input.userId,
      workoutPlanId: input.workoutPlanId,
      type: "week_rebuild",
      status: proposal.questions.length ? "awaiting_input" : "draft",
      proposal,
      feedbackId,
      stateHash,
    })
    .returning();

  const diff = computeWeekRebuildDiff(context.currentWeek.days, proposal.proposedDays);
  return {
    id: row.id,
    status: row.status,
    proposal,
    coachSource: proposal.aiMetadata?.source === "llm" ? "llm" : "fallback",
    feedbackId,
    diff,
  };
}

export async function getWeekRebuildProposal(
  userId: number,
  proposalId: number,
): Promise<StoredWeekRebuild | null> {
  const row = (
    await db
      .select()
      .from(planAdjustmentProposals)
      .where(
        and(
          eq(planAdjustmentProposals.id, proposalId),
          eq(planAdjustmentProposals.userId, userId),
          eq(planAdjustmentProposals.type, "week_rebuild"),
        ),
      )
      .limit(1)
  )[0];
  if (!row) return null;
  const proposal = row.proposal as unknown as WeekRebuildProposal;
  let diff = emptyDiff();
  if (row.feedbackId != null) {
    const feedback = await loadWeekFeedbackInput(row.feedbackId);
    if (feedback) diff = await computeDiff(userId, row.workoutPlanId, feedback, proposal);
  }
  return {
    id: row.id,
    status: row.status,
    proposal,
    coachSource: proposal.aiMetadata?.source === "llm" ? "llm" : "fallback",
    feedbackId: row.feedbackId,
    diff,
  };
}

function emptyDiff() {
  return {
    sessionsBefore: 0,
    sessionsAfter: 0,
    sessionsAdded: 0,
    sessionsRemoved: 0,
    daysMoved: 0,
    exercisesAdded: 0,
    exercisesRemoved: 0,
    setsBefore: 0,
    setsAfter: 0,
    setVolumeChangePct: null as number | null,
    loadsChanged: 0,
    rpeChanged: 0,
    summary: [] as string[],
  };
}

export async function respondToWeekRebuild(
  userId: number,
  proposalId: number,
  questionId: string,
  answer: string,
): Promise<StoredWeekRebuild> {
  const row = (
    await db
      .select()
      .from(planAdjustmentProposals)
      .where(
        and(
          eq(planAdjustmentProposals.id, proposalId),
          eq(planAdjustmentProposals.userId, userId),
          eq(planAdjustmentProposals.type, "week_rebuild"),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new Error("Proposal not found.");
  if (row.status === "applied") throw new Error("Applied proposals cannot be changed.");

  const current = row.proposal as unknown as WeekRebuildProposal;
  const question = current.questions.find((item) => item.id === questionId);
  if (!question || !question.options.includes(answer)) throw new Error("That answer is not valid.");

  const responses = { ...((row.inputResponses as Record<string, string> | null) ?? {}), [questionId]: answer };

  // Re-run with the answer folded into the original feedback's structured details.
  const original = row.feedbackId != null ? await loadWeekFeedbackInput(row.feedbackId) : null;
  const feedback: WeekFeedbackInput = {
    primaryReason: current.feedback.primaryReason,
    secondaryReasons: original?.secondaryReasons ?? [],
    structuredDetails: { ...(original?.structuredDetails ?? {}), ...responses },
    freeText: original?.freeText ?? null,
  };
  const context = await buildWeekRebuildContext({
    userId,
    workoutPlanId: row.workoutPlanId,
    feedback,
  });
  const proposal = await buildProposal(context);
  const stateHash = await computePlanStateHash(row.workoutPlanId);

  await db
    .update(planAdjustmentProposals)
    .set({
      proposal,
      inputResponses: responses,
      stateHash,
      status: proposal.questions.length ? "awaiting_input" : "draft",
    })
    .where(eq(planAdjustmentProposals.id, proposalId));

  return {
    id: row.id,
    status: proposal.questions.length ? "awaiting_input" : "draft",
    proposal,
    coachSource: proposal.aiMetadata?.source === "llm" ? "llm" : "fallback",
    feedbackId: row.feedbackId,
    diff: computeWeekRebuildDiff(context.currentWeek.days, proposal.proposedDays),
  };
}

/**
 * Applies a reviewed week-rebuild. Rejects stale proposals, preserves completed
 * history, modifies only legal current/future days, and is idempotent.
 */
export async function rejectWeekRebuildProposal(
  userId: number,
  proposalId: number,
): Promise<{ ok: true; status: "rejected" }> {
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .select()
        .from(planAdjustmentProposals)
        .where(
          and(
            eq(planAdjustmentProposals.id, proposalId),
            eq(planAdjustmentProposals.userId, userId),
            eq(planAdjustmentProposals.type, "week_rebuild"),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw new Error("Rebuild proposal not found.");
    if (row.status === "applied") throw new Error("Applied proposals cannot be rejected.");
    if (row.status === "rejected") return { ok: true as const, status: "rejected" };

    await tx
      .update(planAdjustmentProposals)
      .set({ status: "rejected", appliedAt: null })
      .where(eq(planAdjustmentProposals.id, proposalId));
    return { ok: true as const, status: "rejected" };
  });
}

export async function applyWeekRebuildProposal(
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
        .where(
          and(
            eq(planAdjustmentProposals.id, proposalId),
            eq(planAdjustmentProposals.userId, userId),
            eq(planAdjustmentProposals.type, "week_rebuild"),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw new Error("Rebuild proposal not found.");
    if (row.status === "applied") return { ok: true as const };
    if (row.status === "rejected") throw new Error("Rejected proposals cannot be applied.");

    const proposal = row.proposal as unknown as WeekRebuildProposal;
    if (proposal.questions.length > 0 || proposal.confidence === "needs_input") {
      throw new Error("This proposal needs an answer before it can be approved.");
    }

    const plan = (
      await tx
        .select()
        .from(workoutPlans)
        .where(and(eq(workoutPlans.id, row.workoutPlanId), eq(workoutPlans.userId, userId)))
        .limit(1)
    )[0];
    if (!plan) throw new Error("Plan not found.");

    const currentHash = await computePlanStateHash(row.workoutPlanId);
    if (row.stateHash && currentHash !== row.stateHash) {
      await tx.update(planAdjustmentProposals).set({ status: "stale" }).where(eq(planAdjustmentProposals.id, proposalId));
      throw new Error("This week changed since this suggestion was created. Create a fresh suggestion.");
    }

    const days = await tx
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.workoutPlanId, row.workoutPlanId))
      .orderBy(asc(workoutPlanDays.dayNumber));

    const sessions = await tx
      .select({ workoutPlanDayId: workoutSessions.workoutPlanDayId, status: workoutSessions.status })
      .from(workoutSessions)
      .where(inArray(workoutSessions.workoutPlanDayId, days.map((d) => d.id)));

    const immutableDayIds = new Set(
      sessions
        .filter((session) => session.status === "completed" || session.status === "ended_early" || session.status === "skipped" || session.status === "in_progress")
        .map((session) => session.workoutPlanDayId),
    );

    const affectedDayIds = days
      .filter((day) => !immutableDayIds.has(day.id))
      .map((day) => day.id);
    const beforeSnapshot = affectedDayIds.length ? await captureDays(tx, affectedDayIds) : { days: [] };

    const dayByNumber = new Map(days.map((day) => [day.dayNumber, day]));

    for (const proposed of proposal.proposedDays) {
      const day = dayByNumber.get(proposed.dayNumber);
      if (!day) throw new Error(`Day ${proposed.dayNumber} not found.`);
      if (immutableDayIds.has(day.id)) {
        throw new Error("Cannot modify a day that already has training recorded.");
      }
      const existing = await tx
        .select({ id: workoutPlanExercises.id })
        .from(workoutPlanExercises)
        .where(eq(workoutPlanExercises.workoutPlanDayId, day.id));
      if (existing.length) {
        await tx.delete(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day.id));
      }

      if (proposed.status === "workout" && proposed.exercises.length > 0) {
        for (let i = 0; i < proposed.exercises.length; i++) {
          const exercise = proposed.exercises[i];
          await tx.insert(workoutPlanExercises).values({
            workoutPlanDayId: day.id,
            exerciseId: exercise.exerciseId,
            position: i + 1,
            targetSets: exercise.sets,
            minReps: exercise.minReps,
            maxReps: exercise.maxReps,
            targetRpe: exercise.targetRpe,
            suggestedWeightKg: exercise.suggestedWeightKg,
            restSeconds: exercise.restSeconds,
            notes: null,
          });
        }
        await tx
          .update(workoutPlanDays)
          .set({ title: proposed.title ?? day.title, origin: null })
          .where(eq(workoutPlanDays.id, day.id));
      } else {
        await tx.update(workoutPlanDays).set({ title: "Rest", origin: null }).where(eq(workoutPlanDays.id, day.id));
      }
    }

    const afterSnapshot = affectedDayIds.length ? await captureDays(tx, affectedDayIds) : { days: [] };
    const stateHashAfter = await computeRevisionPlanStateHash(row.workoutPlanId, tx);
    await recordRevision(tx, {
      userId,
      workoutPlanId: row.workoutPlanId,
      kind: "week_rebuild",
      beforeSnapshot,
      afterSnapshot,
      stateHashBefore: row.stateHash ?? currentHash,
      stateHashAfter,
    });

    await tx
      .update(planAdjustmentProposals)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(planAdjustmentProposals.id, proposalId));

    return { ok: true as const };
  });
}
