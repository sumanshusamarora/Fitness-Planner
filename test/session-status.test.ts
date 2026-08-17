import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
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
import {
  completeSessionExercise,
  createSession,
  endSessionEarly,
  finishSession,
  getSessionSummary,
  skipPlannedSession,
  skipSessionExercise,
} from "@/lib/workouts";

const f = { userId: 0, planId: 0, dayId: 0, sessionId: 0, exerciseIds: [] as number[] };
const createdUserIds: number[] = [];

async function deleteUser(userId: number) {
  if (!userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));
  const sessions = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length) {
    const ses = await db.select({ id: workoutSessionExercises.id }).from(workoutSessionExercises).where(inArray(workoutSessionExercises.workoutSessionId, sessionIds));
    const sseIds = ses.map((s) => s.id);
    if (sseIds.length) await db.delete(workoutSets).where(inArray(workoutSets.workoutSessionExerciseId, sseIds));
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
  for (const id of createdUserIds) await deleteUser(id);
});

async function setupSession() {
  const [user] = await db.insert(users).values({ name: "Session Status Test", username: `sess-${Date.now()}`, usernameNormalized: `sess-${Date.now()}` }).returning();
  f.userId = user.id;
  createdUserIds.push(user.id);
  const planId = (await createInitialWeek(user.id))!;
  f.planId = planId;
  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.workoutPlanId, planId))
      .orderBy(workoutPlanDays.dayNumber)
      .limit(1)
  )[0];
  f.dayId = day.id;
  const session = await createSession(user.id, day.id);
  f.sessionId = session.id;
  const ses = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, session.id)).orderBy(workoutSessionExercises.position);
  f.exerciseIds = ses.map((s) => s.exerciseId);
}

test("skip an exercise records its reason; equipment-busy skip leaves no sets", async () => {
  await setupSession();
  const exId = f.exerciseIds[0];
  await skipSessionExercise(f.userId, f.sessionId, exId, "equipment_busy");
  const byEx = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, f.sessionId));
  const skipped = byEx.find((s) => s.exerciseId === exId)!;
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.skipReason, "equipment_busy");
  const sets = await db.select().from(workoutSets).where(eq(workoutSets.workoutSessionExerciseId, skipped.id));
  assert.equal(sets.length, 0);
});

test("finish marks remaining pending exercises as not_attempted and completes the session", async () => {
  await setupSession();
  const exId = f.exerciseIds[0];
  const sse = (await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, f.sessionId))).find((s) => s.exerciseId === exId)!;
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: 40, reps: 12, rpe: 6 });
  await completeSessionExercise(f.userId, f.sessionId, exId);

  await finishSession(f.userId, f.sessionId, { energyRating: "Good", overallRpe: 7 });

  const session = (await db.select().from(workoutSessions).where(eq(workoutSessions.id, f.sessionId)))[0];
  assert.equal(session.status, "completed");

  const byEx = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, f.sessionId));
  const completed = byEx.find((s) => s.exerciseId === exId)!;
  assert.equal(completed.status, "completed");
  const others = byEx.filter((s) => s.exerciseId !== exId);
  assert.ok(others.every((s) => s.status === "not_attempted"));

  const summary = await getSessionSummary(f.userId, f.sessionId);
  assert.equal(summary!.completedExerciseCount, 1);
  assert.equal(summary!.notAttemptedExerciseCount, byEx.length - 1);
  assert.equal(summary!.setCount, 1);
});

test("end early preserves completed sets and marks remaining not performed", async () => {
  await setupSession();
  const exId = f.exerciseIds[0];
  const sse = (await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, f.sessionId))).find((s) => s.exerciseId === exId)!;
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: 40, reps: 12, rpe: 6 });
  await completeSessionExercise(f.userId, f.sessionId, exId);

  await endSessionEarly(f.userId, f.sessionId, { reason: "short_on_time" });

  const session = (await db.select().from(workoutSessions).where(eq(workoutSessions.id, f.sessionId)))[0];
  assert.equal(session.status, "ended_early");
  assert.equal(session.endReason, "short_on_time");

  const sets = await db.select().from(workoutSets).where(eq(workoutSets.workoutSessionExerciseId, sse.id));
  assert.equal(sets.length, 1, "completed sets must be preserved");

  const byEx = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, f.sessionId));
  assert.ok(byEx.filter((s) => s.exerciseId !== exId).every((s) => s.status === "not_attempted"));
});

test("skipping a session keeps the planned workout and records a skipped outcome", async () => {
  const [user] = await db
    .insert(users)
    .values({ name: "Session Skip Test", username: `skip-${Date.now()}`, usernameNormalized: `skip-${Date.now()}` })
    .returning();
  createdUserIds.push(user.id);
  const planId = (await createInitialWeek(user.id))!;
  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(eq(workoutPlanDays.workoutPlanId, planId))
      .orderBy(workoutPlanDays.dayNumber)
      .limit(1)
  )[0];

  const skipped = await skipPlannedSession(user.id, day.id, "work_family");

  // The plan still has its exercises.
  const planExercises = await db
    .select()
    .from(workoutPlanExercises)
    .where(eq(workoutPlanExercises.workoutPlanDayId, day.id));
  assert.ok(planExercises.length > 0, "planned workout must remain intact");
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.endReason, "work_family");
});
