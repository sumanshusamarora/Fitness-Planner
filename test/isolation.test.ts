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
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { buildTrainingContext } from "@/lib/coach/buildTrainingContext";
import { getActivePlan, getLastCompletedSets, getSessionHistory } from "@/lib/workouts";
import { getLatestRecoverySnapshot } from "@/lib/recovery";
import { createInitialWeek } from "@/lib/initial-week";

const a = { userId: 0, planId: 0, sessionId: 0 };
const b = { userId: 0, planId: 0, sessionId: 0 };
let sharedExerciseId = 0;

async function deleteUserData(userId: number) {
  if (!userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
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

test("each user is isolated across plans, history, sets, recovery and coach context", async () => {
  const stamp = Date.now();
  const [ua] = await db.insert(users).values({ name: "Isolation A", username: `iso-a-${stamp}`, usernameNormalized: `iso-a-${stamp}` }).returning();
  const [ub] = await db.insert(users).values({ name: "Isolation B", username: `iso-b-${stamp}`, usernameNormalized: `iso-b-${stamp}` }).returning();
  a.userId = ua.id;
  b.userId = ub.id;

  const planA = await createInitialWeek(ua.id);
  const planB = await createInitialWeek(ub.id);
  a.planId = planA!;
  b.planId = planB!;

  // One completed session for each user on day 1 (Leg Press, first exercise).
  const dayA = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, planA!), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const dayB = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, planB!), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const exA = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayA[0].id)).limit(1);
  const exB = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayB[0].id)).limit(1);
  sharedExerciseId = exA[0].exerciseId;

  async function completeSession(userId: number, dayId: number, exerciseId: number, weight: number) {
    const [sess] = await db.insert(workoutSessions).values({ userId, workoutPlanDayId: dayId, completedAt: new Date(), status: "completed" }).returning();
    const [sse] = await db.insert(workoutSessionExercises).values({ workoutSessionId: sess.id, exerciseId, position: 1, completed: true, status: "completed" }).returning();
    await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: weight, reps: 12, rpe: 6 });
    return sess.id;
  }

  a.sessionId = await completeSession(ua.id, dayA[0].id, exA[0].exerciseId, 40);
  b.sessionId = await completeSession(ub.id, dayB[0].id, exB[0].exerciseId, 80);

  await db.insert(recoveryLogs).values({ userId: ua.id, logDate: "2026-08-17", sleepRating: 8, energyRating: 8, sorenessRating: 2, jointPainRating: 1, stressRating: 2 });
  await db.insert(recoveryLogs).values({ userId: ub.id, logDate: "2026-08-17", sleepRating: 3, energyRating: 3, sorenessRating: 9, jointPainRating: 8, stressRating: 9 });

  // Active plans are distinct and belong to their owner.
  const planForA = await getActivePlan(ua.id);
  const planForB = await getActivePlan(ub.id);
  assert.equal(planForA!.id, planA);
  assert.equal(planForB!.id, planB);
  assert.notEqual(planForA!.id, planForB!.id);

  // History is scoped.
  const historyA = await getSessionHistory(ua.id);
  const historyB = await getSessionHistory(ub.id);
  assert.deepEqual(historyA.map((h) => h.id), [a.sessionId]);
  assert.deepEqual(historyB.map((h) => h.id), [b.sessionId]);

  // Progression inputs are scoped (A cannot read B's set weight).
  const lastA = await getLastCompletedSets(ua.id, sharedExerciseId);
  const lastB = await getLastCompletedSets(ub.id, sharedExerciseId);
  assert.equal(lastA[lastA.length - 1].weightKg, 40);
  assert.equal(lastB[lastB.length - 1].weightKg, 80);

  // Recovery is scoped.
  const recA = await getLatestRecoverySnapshot(ua.id);
  const recB = await getLatestRecoverySnapshot(ub.id);
  assert.equal(recA!.jointPain, 1);
  assert.equal(recB!.jointPain, 8);

  // Coach context contains no cross-user set data.
  const ctxA = await buildTrainingContext(ua.id, planA!);
  const legPressA = ctxA!.exercises.find((e) => e.exerciseId === sharedExerciseId)!;
  assert.equal(legPressA.recentExposures[0].weightKg, 40);
});
