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
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { createInitialWeek } from "@/lib/initial-week";
import { DomainError } from "@/lib/errors";
import { proposeMoveOrSwap } from "@/lib/schedule";
import {
  startOrResumeSession,
  skipPlannedSession,
  finishSession,
  endSessionEarly,
  cancelEmptySession,
  restoreSkippedExercise,
  skipSessionExercise,
  completeSessionExercise,
} from "@/lib/workouts";
import {
  addSessionActivity,
  addUnplannedExercise,
  replaceSessionExercise,
  restoreSessionExercise,
} from "@/lib/session-activities";

const createdUserIds: number[] = [];

async function deleteUser(userId: number) {
  if (!userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));
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
  for (const id of createdUserIds) await deleteUser(id);
});

async function makeUser(tag: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const [u] = await db
    .insert(users)
    .values({ name: `Safety ${tag} ${stamp}`, username: `safety-${tag}-${stamp}`, usernameNormalized: `safety-${tag}-${stamp}` })
    .returning();
  createdUserIds.push(u.id);
  const planId = (await createInitialWeek(u.id))!;
  return { user: u, planId };
}

async function getDays(planId: number) {
  return db.select().from(workoutPlanDays).where(eq(workoutPlanDays.workoutPlanId, planId)).orderBy(workoutPlanDays.dayNumber);
}

async function dayHasExercises(dayId: number): Promise<boolean> {
  const rows = await db.select({ id: workoutPlanExercises.id }).from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayId));
  return rows.length > 0;
}

function expectCode(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof DomainError, `expected DomainError, got ${err}`);
    assert.equal((err as DomainError).code, code);
    return true;
  };
}

async function exerciseForDay(dayId: number) {
  const rows = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayId)).orderBy(workoutPlanExercises.position).limit(1);
  return rows[0];
}

test("start normal creates a single in-progress session", async () => {
  const { user, planId } = await makeUser("norm");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  assert.equal(await dayHasExercises(workout.id), true);

  const { session, created } = await startOrResumeSession(user.id, workout.id);
  assert.equal(created, true);
  assert.equal(session.status, "in_progress");

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, workout.id));
  assert.equal(rows.length, 1);
  const sses = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, session.id));
  assert.ok(sses.length > 0, "planned exercises materialised");
});

test("double start resumes the same session, not a second one", async () => {
  const { user, planId } = await makeUser("dbl");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 3)!;

  const first = await startOrResumeSession(user.id, workout.id);
  const second = await startOrResumeSession(user.id, workout.id);

  assert.equal(second.created, false);
  assert.equal(second.session.id, first.session.id);

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, workout.id));
  assert.equal(rows.length, 1);
});

test("concurrent starts serialize to one in-progress session", async () => {
  const { user, planId } = await makeUser("conc");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 5)!;

  const results = await Promise.all([
    startOrResumeSession(user.id, workout.id),
    startOrResumeSession(user.id, workout.id),
  ]);

  assert.equal(new Set(results.map((r) => r.session.id)).size, 1);

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, workout.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "in_progress");
});

test("start on a rest day is rejected", async () => {
  const { user, planId } = await makeUser("rest");
  const days = await getDays(planId);
  const rest = days.find((d) => d.dayNumber === 4)!;
  assert.equal(await dayHasExercises(rest.id), false);

  await assert.rejects(
    () => startOrResumeSession(user.id, rest.id),
    expectCode("PLAN_DAY_IS_REST"),
  );
});

test("start on an approved extra day is allowed", async () => {
  const { user, planId } = await makeUser("extra");
  const days = await getDays(planId);
  const source = days.find((d) => d.dayNumber === 1)!;
  const [extra] = await db
    .insert(workoutPlanDays)
    .values({ workoutPlanId: planId, dayNumber: 9, dayName: "Sunday", title: "Extra", origin: "extra" })
    .returning();
  const pe = await exerciseForDay(source.id);
  await db.insert(workoutPlanExercises).values({
    workoutPlanDayId: extra.id,
    exerciseId: pe.exerciseId,
    position: 1,
    targetSets: 2,
    minReps: 8,
    maxReps: 12,
    targetRpe: 6,
    suggestedWeightKg: 20,
    restSeconds: 90,
  });

  const { session, created } = await startOrResumeSession(user.id, extra.id);
  assert.equal(created, true);
  assert.equal(session.status, "in_progress");
});

test("skipping twice cannot create a duplicate skipped session", async () => {
  const { user, planId } = await makeUser("skipdup");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;

  const first = await skipPlannedSession(user.id, workout.id, "short_on_time");
  assert.equal(first.status, "skipped");

  await assert.rejects(
    () => skipPlannedSession(user.id, workout.id, "not_feeling_well"),
    expectCode("PLAN_DAY_ALREADY_STARTED"),
  );

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, workout.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "skipped");
});

test("skipping a completed day is rejected", async () => {
  const { user, planId } = await makeUser("skipdone");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;

  const { session } = await startOrResumeSession(user.id, workout.id);
  await finishSession(user.id, session.id, {});

  await assert.rejects(
    () => skipPlannedSession(user.id, workout.id, "other"),
    expectCode("PLAN_DAY_ALREADY_STARTED"),
  );
});

test("skipping an extra day is rejected", async () => {
  const { user, planId } = await makeUser("skipextra");
  const days = await getDays(planId);
  const source = days.find((d) => d.dayNumber === 1)!;
  const [extra] = await db
    .insert(workoutPlanDays)
    .values({ workoutPlanId: planId, dayNumber: 9, dayName: "Sunday", title: "Extra", origin: "extra" })
    .returning();
  const pe = await exerciseForDay(source.id);
  await db.insert(workoutPlanExercises).values({
    workoutPlanDayId: extra.id,
    exerciseId: pe.exerciseId,
    position: 1,
    targetSets: 2,
    minReps: 8,
    maxReps: 12,
    targetRpe: 6,
    suggestedWeightKg: 20,
    restSeconds: 90,
  });

  await assert.rejects(
    () => skipPlannedSession(user.id, extra.id, "other"),
    expectCode("PLAN_DAY_IS_EXTRA"),
  );
});

test("finish twice is idempotent", async () => {
  const { user, planId } = await makeUser("fin2");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);

  const one = await finishSession(user.id, session.id, { energyRating: "Good", overallRpe: 7 });
  assert.equal(one.status, "completed");
  const two = await finishSession(user.id, session.id, {});
  assert.equal(two.status, "completed");

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "completed");
});

test("end early twice is idempotent", async () => {
  const { user, planId } = await makeUser("end2");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);

  const one = await endSessionEarly(user.id, session.id, { reason: "short_on_time" });
  assert.equal(one.status, "ended_early");
  const two = await endSessionEarly(user.id, session.id, { reason: "pain" });
  assert.equal(two.status, "ended_early");

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "ended_early");
});

test("finish after an ended-early session is rejected", async () => {
  const { user, planId } = await makeUser("finend");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  await endSessionEarly(user.id, session.id, { reason: "pain" });

  await assert.rejects(
    () => finishSession(user.id, session.id, {}),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
});

test("completed sessions reject actual-work mutations", async () => {
  const { user, planId } = await makeUser("lockc");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await exerciseForDay(workout.id))!.exerciseId;
  await finishSession(user.id, session.id, {});

  await assert.rejects(
    () => completeSessionExercise(user.id, session.id, exId),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
  await assert.rejects(
    () => skipSessionExercise(user.id, session.id, exId, "other"),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
  await assert.rejects(
    () =>
      addSessionActivity(user.id, session.id, {
        activityType: "cardio",
        activityRole: "warmup",
        exerciseId: null,
        nameSnapshot: "Treadmill",
        durationSeconds: 300,
        distanceMeters: null,
        speed: null,
        inclinePercent: null,
        effortRpe: null,
        notes: null,
      }),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
  await assert.rejects(
    () => addUnplannedExercise(user.id, session.id, exId),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
});

test("ended-early sessions reject actual-work mutations", async () => {
  const { user, planId } = await makeUser("locke");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  await endSessionEarly(user.id, session.id, { reason: "short_on_time" });

  const exId = (await exerciseForDay(workout.id))!.exerciseId;
  await assert.rejects(
    () => completeSessionExercise(user.id, session.id, exId),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
  await assert.rejects(
    () => restoreSkippedExercise(user.id, session.id, exId),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
});

test("cancel removes a zero-work accidental start", async () => {
  const { user, planId } = await makeUser("cancel");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;

  const { session } = await startOrResumeSession(user.id, workout.id);
  const result = await cancelEmptySession(user.id, session.id);
  assert.deepEqual(result, { cancelled: true });

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
  assert.equal(rows.length, 0, "session removed");

  // Day is startable again and no terminal history exists.
  const again = await startOrResumeSession(user.id, workout.id);
  assert.equal(again.created, true);
  assert.notEqual(again.session.id, session.id);
});

test("cancel rejects when a set has been logged", async () => {
  const { user, planId } = await makeUser("cancelsets");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const sse = (await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, session.id)).limit(1))[0];
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: 40, reps: 10, rpe: 6 });

  await assert.rejects(
    () => cancelEmptySession(user.id, session.id),
    expectCode("SESSION_HAS_ACTUAL_WORK"),
  );

  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
  assert.equal(rows.length, 1, "session preserved");
});

test("cancel rejects when an activity has been logged", async () => {
  const { user, planId } = await makeUser("cancelact");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  await addSessionActivity(user.id, session.id, {
    activityType: "cardio",
    activityRole: "warmup",
    exerciseId: null,
    nameSnapshot: "Row",
    durationSeconds: 300,
    distanceMeters: null,
    speed: null,
    inclinePercent: null,
    effortRpe: 4,
    notes: null,
  });

  await assert.rejects(
    () => cancelEmptySession(user.id, session.id),
    expectCode("SESSION_HAS_ACTUAL_WORK"),
  );
});

test("cancel rejects when an exercise has been skipped", async () => {
  const { user, planId } = await makeUser("cancelskip");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await exerciseForDay(workout.id))!.exerciseId;
  await skipSessionExercise(user.id, session.id, exId, "pain");

  await assert.rejects(
    () => cancelEmptySession(user.id, session.id),
    expectCode("SESSION_HAS_ACTUAL_WORK"),
  );
});

test("cancel rejects when a replacement has been used", async () => {
  const { user, planId } = await makeUser("cancelrepl");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const [a, b] = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, workout.id)).orderBy(workoutPlanExercises.position).limit(2);
  await replaceSessionExercise(user.id, session.id, a.exerciseId, b.exerciseId, "equipment_busy");

  await assert.rejects(
    () => cancelEmptySession(user.id, session.id),
    expectCode("SESSION_HAS_ACTUAL_WORK"),
  );
});

test("restoring a skipped exercise persists after refresh", async () => {
  const { user, planId } = await makeUser("undoref");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await exerciseForDay(workout.id))!.exerciseId;

  await skipSessionExercise(user.id, session.id, exId, "equipment_busy");
  const skipped = (await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, session.id), eq(workoutSessionExercises.exerciseId, exId))).limit(1))[0];
  assert.equal(skipped.status, "skipped");

  const restored = await restoreSkippedExercise(user.id, session.id, exId);
  assert.equal(restored.status, "pending");
  assert.equal(restored.skipReason, null);

  const after = (await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, session.id), eq(workoutSessionExercises.exerciseId, exId))).limit(1))[0];
  assert.equal(after.status, "pending", "restored state persisted after refresh");
});

test("restoring a non-skipped exercise is rejected", async () => {
  const { user, planId } = await makeUser("undonoskip");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await exerciseForDay(workout.id))!.exerciseId;

  await assert.rejects(
    () => restoreSkippedExercise(user.id, session.id, exId),
    expectCode("EXERCISE_NOT_SKIPPED"),
  );
});

test("restoring a skipped exercise is rejected after finalisation", async () => {
  const { user, planId } = await makeUser("undolock");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await exerciseForDay(workout.id))!.exerciseId;
  await skipSessionExercise(user.id, session.id, exId, "pain");
  await finishSession(user.id, session.id, {});

  await assert.rejects(
    () => restoreSkippedExercise(user.id, session.id, exId),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
});

test("restoring a replacement with zero work succeeds and clears it", async () => {
  const { user, planId } = await makeUser("undorepl");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const [a, b] = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, workout.id)).orderBy(workoutPlanExercises.position).limit(2);

  const replaced = await replaceSessionExercise(user.id, session.id, a.exerciseId, b.exerciseId, "other");
  await restoreSessionExercise(user.id, session.id, a.exerciseId);

  const original = (await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, session.id), eq(workoutSessionExercises.exerciseId, a.exerciseId))).limit(1))[0];
  assert.equal(original.status, "pending", "original restored to pending");
  const gone = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.id, replaced.id));
  assert.equal(gone.length, 0, "zero-work replacement removed");
});

test("restoring a replacement with a working set is rejected and never deletes sets", async () => {
  const { user, planId } = await makeUser("undowork");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const [a, b] = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, workout.id)).orderBy(workoutPlanExercises.position).limit(2);

  const replaced = await replaceSessionExercise(user.id, session.id, a.exerciseId, b.exerciseId, "equipment_busy");
  await db.insert(workoutSets).values({ workoutSessionExerciseId: replaced.id, setNumber: 1, weightKg: 60, reps: 10, rpe: 7, setType: "working" });

  await assert.rejects(
    () => restoreSessionExercise(user.id, session.id, a.exerciseId),
    expectCode("REPLACEMENT_HAS_ACTUAL_WORK"),
  );

  const sets = await db.select().from(workoutSets).where(eq(workoutSets.workoutSessionExerciseId, replaced.id));
  assert.equal(sets.length, 1, "logged work preserved after rejected restore");
});

test("restoring a replacement with only a warm-up set is also rejected", async () => {
  const { user, planId } = await makeUser("undowarm");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const [a, b] = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, workout.id)).orderBy(workoutPlanExercises.position).limit(2);

  const replaced = await replaceSessionExercise(user.id, session.id, a.exerciseId, b.exerciseId, "other");
  await db.insert(workoutSets).values({ workoutSessionExerciseId: replaced.id, setNumber: 1, weightKg: 20, reps: 6, rpe: 5, setType: "warmup" });

  await assert.rejects(
    () => restoreSessionExercise(user.id, session.id, a.exerciseId),
    expectCode("REPLACEMENT_HAS_ACTUAL_WORK"),
  );
});

test("scheduling: a day with an in-progress session can't be moved", async () => {
  const { user, planId } = await makeUser("movelive");
  const days = await getDays(planId);
  const live = days.find((d) => d.dayNumber === 1)!;
  const rest = days.find((d) => d.dayNumber === 4)!;
  await startOrResumeSession(user.id, live.id);

  await assert.rejects(
    () => proposeMoveOrSwap(user.id, planId, live.id, rest.id),
    /training recorded/,
  );
});

test("scheduling: completed, ended-early and skipped days can't be moved", async () => {
  const { user, planId } = await makeUser("movehist");
  const days = await getDays(planId);
  const done = days.find((d) => d.dayNumber === 1)!;
  const skipped = days.find((d) => d.dayNumber === 3)!;
  const rest = days.find((d) => d.dayNumber === 4)!;

  const doneSession = await startOrResumeSession(user.id, done.id);
  await finishSession(user.id, doneSession.session.id, {});
  const skipSession = await startOrResumeSession(user.id, skipped.id);
  await endSessionEarly(user.id, skipSession.session.id, { reason: "pain" });
  const skipWhole = await skipPlannedSession(user.id, days.find((d) => d.dayNumber === 5)!.id, "other");

  await assert.rejects(
    () => proposeMoveOrSwap(user.id, planId, done.id, rest.id),
    /training recorded/,
  );
  await assert.rejects(
    () => proposeMoveOrSwap(user.id, planId, skipped.id, rest.id),
    /training recorded/,
  );
  const skipDay = (await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.id, skipWhole.workoutPlanDayId)).limit(1))[0];
  await assert.rejects(
    () => proposeMoveOrSwap(user.id, planId, skipDay.id, rest.id),
    /training recorded/,
  );
});

test("scheduling: swap involving a touched target day is rejected", async () => {
  const { user, planId } = await makeUser("swaphist");
  const days = await getDays(planId);
  const source = days.find((d) => d.dayNumber === 5)!;
  const target = days.find((d) => d.dayNumber === 1)!;
  await startOrResumeSession(user.id, target.id);

  await assert.rejects(
    () => proposeMoveOrSwap(user.id, planId, source.id, target.id),
    /training recorded/,
  );
});

test("user isolation: another user can't touch a live session", async () => {
  const a = await makeUser("isoa");
  const b = await makeUser("isob");
  const days = await getDays(a.planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(a.user.id, workout.id);

  await assert.rejects(
    () => startOrResumeSession(b.user.id, workout.id),
    expectCode("PLAN_DAY_NOT_FOUND"),
  );

  const exId = (await exerciseForDay(workout.id))!.exerciseId;
  await assert.rejects(
    () => completeSessionExercise(b.user.id, session.id, exId),
    expectCode("SESSION_NOT_FOUND"),
  );
  await assert.rejects(
    () => cancelEmptySession(b.user.id, session.id),
    expectCode("SESSION_NOT_FOUND"),
  );
});