import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  planRevisions,
  recoveryLogs,
  userExerciseProfiles,
  users,
  weekFeedback,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { getReplacementOptions } from "@/lib/exercise-substitution";
import { createInitialWeek } from "@/lib/initial-week";
import { createSession } from "@/lib/workouts";

const createdUserIds: number[] = [];

async function deleteUserData(userId: number) {
  if (!userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(weekFeedback).where(eq(weekFeedback.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));
  await db.delete(userExerciseProfiles).where(eq(userExerciseProfiles.userId, userId));

  const sessions = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length) {
    await db.delete(workoutSessionActivities).where(inArray(workoutSessionActivities.workoutSessionId, sessionIds));
    const sses = await db.select({ id: workoutSessionExercises.id }).from(workoutSessionExercises).where(inArray(workoutSessionExercises.workoutSessionId, sessionIds));
    if (sses.length) await db.delete(workoutSets).where(inArray(workoutSets.workoutSessionExerciseId, sses.map((s) => s.id)));
    await db.delete(workoutSessionExercises).where(inArray(workoutSessionExercises.workoutSessionId, sessionIds));
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
  for (const userId of createdUserIds) await deleteUserData(userId);
});

async function createUserWithSession(tag: string) {
  const stamp = Date.now();
  const [user] = await db
    .insert(users)
    .values({ name: `Sub ${tag} ${stamp}`, username: `sub-${tag}-${stamp}`, usernameNormalized: `sub-${tag}-${stamp}` })
    .returning();
  createdUserIds.push(user.id);

  const planId = (await createInitialWeek(user.id))!;
  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, 1)))
      .limit(1)
  )[0];

  const planExercises = await db
    .select()
    .from(workoutPlanExercises)
    .where(eq(workoutPlanExercises.workoutPlanDayId, day.id))
    .orderBy(workoutPlanExercises.position);

  const session = await createSession(user.id, day.id);
  return { user, sessionId: session.id, plannedExerciseId: planExercises[0].exerciseId };
}

test("fallback replacement options return a safe deterministic candidate when LLM is unavailable", async () => {
  const ctx = await createUserWithSession("fallback");

  const options = await getReplacementOptions({
    userId: ctx.user.id,
    sessionId: ctx.sessionId,
    exerciseId: ctx.plannedExerciseId,
    reason: "equipment_unavailable",
  });

  assert.equal(options.source.source, "deterministic_fallback");
  assert.equal(options.source.label, "Local fallback");
  assert.ok(options.candidates.length > 0);
  if (options.decision.decision === "replace") {
    assert.ok(Number.isInteger(options.decision.selectedExerciseId));
    assert.ok((options.decision.selectedExerciseId ?? 0) > 0);
  }
});

test("substitution candidate facts remain user-isolated", async () => {
  const userA = await createUserWithSession("iso-a");
  const userB = await createUserWithSession("iso-b");

  const before = await getReplacementOptions({
    userId: userA.user.id,
    sessionId: userA.sessionId,
    exerciseId: userA.plannedExerciseId,
    reason: "preference",
  });
  assert.ok(before.candidates.length > 0);

  const targetCandidateId = before.candidates[0].exerciseId;
  await db
    .insert(userExerciseProfiles)
    .values({
      userId: userA.user.id,
      exerciseId: targetCandidateId,
      preference: "preferred",
      anchorState: "none",
    })
    .onConflictDoUpdate({
      target: [userExerciseProfiles.userId, userExerciseProfiles.exerciseId],
      set: { preference: "preferred", updatedAt: new Date() },
    });

  const afterA = await getReplacementOptions({
    userId: userA.user.id,
    sessionId: userA.sessionId,
    exerciseId: userA.plannedExerciseId,
    reason: "preference",
  });
  const afterB = await getReplacementOptions({
    userId: userB.user.id,
    sessionId: userB.sessionId,
    exerciseId: userB.plannedExerciseId,
    reason: "preference",
  });

  const aFact = afterA.candidates.find((candidate) => candidate.exerciseId === targetCandidateId);
  const bFact = afterB.candidates.find((candidate) => candidate.exerciseId === targetCandidateId);

  assert.equal(aFact?.preference, "preferred");
  if (bFact) {
    assert.equal(bFact.preference, null);
  }
});
