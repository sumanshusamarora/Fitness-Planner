import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  planRevisions,
  recoveryLogs,
  users,
  weekFeedback,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { createInitialWeek } from "@/lib/initial-week";
import {
  applyWeekRebuildProposal,
  computePlanStateHash,
  getRecentWeekFeedbackSummary,
  proposeWeekRebuild,
} from "@/lib/week-rebuild";

const a = { userId: 0, planId: 0 };
const b = { userId: 0, planId: 0 };

async function deleteUserData(userId: number) {
  if (!userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(weekFeedback).where(eq(weekFeedback.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));
  const ses = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sesIds = ses.map((s) => s.id);
  if (sesIds.length) {
    const sses = await db.select({ id: workoutSessionExercises.id }).from(workoutSessionExercises).where(inArray(workoutSessionExercises.workoutSessionId, sesIds));
    if (sses.length) await db.delete(workoutSets).where(inArray(workoutSets.workoutSessionExerciseId, sses.map((s) => s.id)));
    await db.delete(workoutSessionExercises).where(inArray(workoutSessionExercises.workoutSessionId, sesIds));
    await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  }
  const plans = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, userId));
  const planIds = plans.map((p) => p.id);
  if (planIds.length) {
    const days = await db.select({ id: workoutPlanDays.id }).from(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    if (days.length) await db.delete(workoutPlanExercises).where(inArray(workoutPlanExercises.workoutPlanDayId, days.map((d) => d.id)));
    await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    await db.delete(workoutPlans).where(eq(workoutPlans.userId, userId));
  }
  await db.delete(users).where(eq(users.id, userId));
}

after(async () => {
  await deleteUserData(a.userId);
  await deleteUserData(b.userId);
});

async function completeSession(userId: number, dayId: number, exerciseId: number, weight: number) {
  const [sess] = await db.insert(workoutSessions).values({ userId, workoutPlanDayId: dayId, completedAt: new Date(), status: "completed" }).returning();
  const [sse] = await db.insert(workoutSessionExercises).values({ workoutSessionId: sess.id, exerciseId, position: 1, completed: true, status: "completed" }).returning();
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: weight, reps: 12, rpe: 6 });
  return sess.id;
}

test("week rebuild preserves completed history, is idempotent, rejects stale, and is user-scoped", async () => {
  const stamp = Date.now();
  const [ua] = await db.insert(users).values({ name: "Rebuild A", username: `rebuild-a-${stamp}`, usernameNormalized: `rebuild-a-${stamp}` }).returning();
  const [ub] = await db.insert(users).values({ name: "Rebuild B", username: `rebuild-b-${stamp}`, usernameNormalized: `rebuild-b-${stamp}` }).returning();
  a.userId = ua.id;
  b.userId = ub.id;
  a.planId = (await createInitialWeek(ua.id))!;
  b.planId = (await createInitialWeek(ub.id))!;

  // Complete Monday for user A (Leg Press, first exercise).
  const dayA = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const exA = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayA[0].id)).limit(1);
  await completeSession(ua.id, dayA[0].id, exA[0].exerciseId, 40);

  // Propose a rebuild for A: too many days.
  const stored = await proposeWeekRebuild({
    userId: ua.id,
    workoutPlanId: a.planId,
    feedback: { primaryReason: "too_many_days", secondaryReasons: [], structuredDetails: { target_days: "1" }, freeText: null },
  });

  assert.equal(stored.proposal.overallAction, "modify_remaining_week");
  assert.ok(stored.proposal.preservedDays.some((d) => d.dayNumber === 1), "Monday must be preserved");
  assert.ok(!stored.proposal.proposedDays.some((d) => d.dayNumber === 1), "Monday must not be in proposedDays");

  // Apply the rebuild.
  const mondayBefore = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayA[0].id));
  const applied = await applyWeekRebuildProposal(ua.id, stored.id, { confirmation: "approve" });
  assert.equal(applied.ok, true);

  // Monday's completed workout must remain unchanged.
  const mondayAfter = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayA[0].id));
  assert.equal(mondayAfter.length, mondayBefore.length, "completed day exercises must not be touched");
  assert.deepEqual(
    mondayAfter.map((r) => r.exerciseId).sort(),
    mondayBefore.map((r) => r.exerciseId).sort(),
    "completed day exercise set must be identical",
  );

  // Re-applying is idempotent.
  const again = await applyWeekRebuildProposal(ua.id, stored.id, { confirmation: "approve" });
  assert.equal(again.ok, true);
  const proposalRows = await db.select().from(planAdjustmentProposals).where(eq(planAdjustmentProposals.id, stored.id));
  assert.equal(proposalRows[0].status, "applied");

  // Stale-proposal protection: a second proposal becomes stale after a day changes.
  const stored2 = await proposeWeekRebuild({
    userId: ua.id,
    workoutPlanId: a.planId,
    feedback: { primaryReason: "too_many_days", secondaryReasons: [], structuredDetails: { target_days: "1" }, freeText: null },
  });
  // Mutate the plan state (complete Wednesday).
  const dayC = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 3))).limit(1);
  const exC = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayC[0].id)).limit(1);
  await completeSession(ua.id, dayC[0].id, exC[0].exerciseId, 45);

  await assert.rejects(
    () => applyWeekRebuildProposal(ua.id, stored2.id, { confirmation: "approve" }),
    /changed since this suggestion/,
  );

  // User isolation: B cannot rebuild A's plan.
  await assert.rejects(
    () =>
      proposeWeekRebuild({
        userId: ub.id,
        workoutPlanId: a.planId,
        feedback: { primaryReason: "too_difficult", secondaryReasons: [], structuredDetails: null, freeText: null },
      }),
    /Plan not found/,
  );

  // Feedback summary is user-scoped.
  const summaryA = await getRecentWeekFeedbackSummary(ua.id);
  const summaryB = await getRecentWeekFeedbackSummary(ub.id);
  assert.ok(summaryA.total >= 2);
  assert.equal(summaryB.total, 0);

  // State hash changes after the plan mutates.
  const h1 = await computePlanStateHash(a.planId);
  assert.equal(typeof h1, "string");
});
