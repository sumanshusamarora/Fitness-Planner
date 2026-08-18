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
import { createInitialWeek } from "@/lib/initial-week";
import {
  resolveSessionRouteContext,
  validateDayRouteContext,
  validateSessionRouteContext,
} from "@/lib/training-route-context";
import { createSession } from "@/lib/workouts";

const createdUserIds: number[] = [];

async function deleteUserData(userId: number) {
  if (!userId) return;

  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));

  const sessions = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(eq(workoutSessions.userId, userId));
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    const sessionExercises = await db
      .select({ id: workoutSessionExercises.id })
      .from(workoutSessionExercises)
      .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds));
    const sessionExerciseIds = sessionExercises.map((s) => s.id);
    if (sessionExerciseIds.length > 0) {
      await db
        .delete(workoutSets)
        .where(inArray(workoutSets.workoutSessionExerciseId, sessionExerciseIds));
    }
    await db
      .delete(workoutSessionExercises)
      .where(inArray(workoutSessionExercises.workoutSessionId, sessionIds));
    await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  }

  const plans = await db
    .select({ id: workoutPlans.id })
    .from(workoutPlans)
    .where(eq(workoutPlans.userId, userId));
  const planIds = plans.map((p) => p.id);
  if (planIds.length > 0) {
    const days = await db
      .select({ id: workoutPlanDays.id })
      .from(workoutPlanDays)
      .where(inArray(workoutPlanDays.workoutPlanId, planIds));
    const dayIds = days.map((d) => d.id);
    if (dayIds.length > 0) {
      await db
        .delete(workoutPlanExercises)
        .where(inArray(workoutPlanExercises.workoutPlanDayId, dayIds));
      await db
        .delete(workoutPlanDays)
        .where(inArray(workoutPlanDays.workoutPlanId, planIds));
    }
    await db.delete(workoutPlans).where(eq(workoutPlans.userId, userId));
  }

  await db.delete(users).where(eq(users.id, userId));
}

after(async () => {
  for (const userId of createdUserIds) {
    await deleteUserData(userId);
  }
});

async function createUser(name: string) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const username = `${name}-${stamp}`;
  const [user] = await db
    .insert(users)
    .values({
      name,
      username,
      usernameNormalized: username,
    })
    .returning();
  createdUserIds.push(user.id);
  return user;
}

test("route-context helpers resolve and validate ownership hierarchy", async () => {
  const user = await createUser("Route Context A");
  const planId = (await createInitialWeek(user.id)) as number;
  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, 1)))
      .limit(1)
  )[0];
  const session = await createSession(user.id, day.id);

  const resolved = await resolveSessionRouteContext(user.id, session.id);
  assert.ok(resolved);
  assert.equal(resolved?.weekId, planId);
  assert.equal(resolved?.dayId, day.id);
  assert.equal(resolved?.sessionId, session.id);

  const validDay = await validateDayRouteContext(user.id, planId, day.id);
  assert.deepEqual(validDay, { weekId: planId, dayId: day.id });

  const invalidDay = await validateDayRouteContext(user.id, planId + 999999, day.id);
  assert.equal(invalidDay, null);

  const validSession = await validateSessionRouteContext(user.id, planId, day.id, session.id);
  assert.ok(validSession);
  assert.equal(validSession?.sessionId, session.id);

  const invalidSessionDay = await validateSessionRouteContext(user.id, planId, day.id + 999999, session.id);
  assert.equal(invalidSessionDay, null);
});

test("route-context helpers deny access to other users", async () => {
  const owner = await createUser("Route Context Owner");
  const outsider = await createUser("Route Context Outsider");

  const planId = (await createInitialWeek(owner.id)) as number;
  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, 1)))
      .limit(1)
  )[0];
  const session = await createSession(owner.id, day.id);

  const resolvedByOutsider = await resolveSessionRouteContext(outsider.id, session.id);
  assert.equal(resolvedByOutsider, null);

  const dayByOutsider = await validateDayRouteContext(outsider.id, planId, day.id);
  assert.equal(dayByOutsider, null);

  const sessionByOutsider = await validateSessionRouteContext(outsider.id, planId, day.id, session.id);
  assert.equal(sessionByOutsider, null);
});
