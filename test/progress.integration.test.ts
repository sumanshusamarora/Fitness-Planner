import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  recoveryLogs,
  users,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { createInitialWeek } from "@/lib/initial-week";
import { buildProgressAnalytics } from "@/lib/progress";

const a = { userId: 0 };
const b = { userId: 0 };

async function deleteUserData(userId: number) {
  if (!userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
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

test("progress analytics are user-scoped", async () => {
  const stamp = Date.now();
  const [ua] = await db.insert(users).values({ name: "Progress A", username: `prog-a-${stamp}`, usernameNormalized: `prog-a-${stamp}` }).returning();
  const [ub] = await db.insert(users).values({ name: "Progress B", username: `prog-b-${stamp}`, usernameNormalized: `prog-b-${stamp}` }).returning();
  a.userId = ua.id;
  b.userId = ub.id;

  const planA = await createInitialWeek(ua.id);
  const planB = await createInitialWeek(ub.id);

  const dayA = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, planA!), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const dayB = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, planB!), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const exA = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayA[0].id)).limit(1);
  const exB = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayB[0].id)).limit(1);

  async function completeSession(userId: number, dayId: number, exerciseId: number, weight: number) {
    const [sess] = await db.insert(workoutSessions).values({ userId, workoutPlanDayId: dayId, completedAt: new Date(), status: "completed" }).returning();
    const [sse] = await db.insert(workoutSessionExercises).values({ workoutSessionId: sess.id, exerciseId, position: 1, completed: true, status: "completed" }).returning();
    await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: weight, reps: 12, rpe: 6 });
  }

  await completeSession(ua.id, dayA[0].id, exA[0].exerciseId, 40);
  await completeSession(ub.id, dayB[0].id, exB[0].exerciseId, 80);

  const progressA = await buildProgressAnalytics({ userId: ua.id });
  const progressB = await buildProgressAnalytics({ userId: ub.id });

  assert.equal(progressA.userId, ua.id);
  assert.equal(progressB.userId, ub.id);

  const shared = exA[0].exerciseId;
  const exerciseA = progressA.exercises.find((exercise) => exercise.exerciseId === shared)!;
  const exerciseB = progressB.exercises.find((exercise) => exercise.exerciseId === shared)!;
  assert.equal(exerciseA.recentLoadKg, 40);
  assert.equal(exerciseB.recentLoadKg, 80);
});
