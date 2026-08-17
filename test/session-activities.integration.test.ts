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
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { createInitialWeek } from "@/lib/initial-week";
import { createSession, finishSession } from "@/lib/workouts";
import { buildProgressAnalytics } from "@/lib/progress";
import {
  addSessionActivity,
  addUnplannedExercise,
  buildRecentActualSummary,
  buildSessionActivitySummary,
  removeAddedSessionExercise,
  removeSessionSet,
  removeSessionActivity,
  replaceSessionExercise,
  restoreSessionExercise,
  updateSessionSet,
  updateSessionActivity,
} from "@/lib/session-activities";

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
    await db.delete(workoutSessionActivities).where(inArray(workoutSessionActivities.workoutSessionId, sesIds));
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

async function startSession(userId: number, planId: number, dayNumber: number) {
  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, dayNumber))).limit(1);
  const session = await createSession(userId, day[0].id);
  return session.id;
}

async function logSet(userId: number, sessionId: number, exerciseId: number, weightKg: number, reps: number, setType: "working" | "warmup" = "working") {
  let sse = await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, sessionId), eq(workoutSessionExercises.exerciseId, exerciseId))).limit(1);
  if (!sse[0]) {
    sse = await db.insert(workoutSessionExercises).values({ workoutSessionId: sessionId, exerciseId, position: 1, status: "completed", completed: true }).returning();
  }
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse[0].id, setNumber: 1, weightKg, reps, rpe: 6, setType });
  return sse[0].id;
}

test("warm-up sets do not pollute working-set progress analytics", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act A ${stamp}`, username: `act-a-${stamp}`, usernameNormalized: `act-a-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;

  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const ex = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(1);
  const sessionId = await startSession(u.id, a.planId, 1);
  await logSet(u.id, sessionId, ex[0].exerciseId, 20, 10, "warmup");
  await logSet(u.id, sessionId, ex[0].exerciseId, 40, 12, "working");
  await finishSession(u.id, sessionId, {});

  const progress = await buildProgressAnalytics({ userId: u.id });
  const exerciseProgress = progress.exercises.find((p) => p.exerciseId === ex[0].exerciseId);
  assert.equal(exerciseProgress?.recentLoadKg, 40, "recent load must be the working weight, not the warm-up");
});

test("added exercise counts as actual training; summary distinguishes planned vs extra", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act B ${stamp}`, username: `act-b-${stamp}`, usernameNormalized: `act-b-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;

  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const exs = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(2);
  const sessionId = await startSession(u.id, a.planId, 1);
  // 3 planned working sets (of 4 expected across the 2 planned exercises).
  await logSet(u.id, sessionId, exs[0].exerciseId, 40, 12);
  await logSet(u.id, sessionId, exs[1].exerciseId, 15, 12);
  await logSet(u.id, sessionId, exs[1].exerciseId, 15, 12);
  // Add an unplanned exercise (same exerciseId reused to keep the fixture small).
  const addedSse = await addUnplannedExercise(u.id, sessionId, exs[0].exerciseId);
  await db.insert(workoutSets).values({ workoutSessionExerciseId: addedSse.id, setNumber: 1, weightKg: 20, reps: 12, rpe: 7, setType: "working" });
  await db.insert(workoutSets).values({ workoutSessionExerciseId: addedSse.id, setNumber: 2, weightKg: 20, reps: 12, rpe: 7, setType: "working" });

  const summary = await buildSessionActivitySummary(u.id, sessionId);
  assert.ok(summary.plannedWorkingSetsCompleted >= 3);
  assert.ok(summary.plannedWorkingSetsExpected >= 4);
  assert.ok(summary.extraWorkingSets >= 2);
  assert.ok(summary.addedExercises >= 1);
  // Adherence is planned/expected, never total/expected (would be >100%).
  assert.ok(summary.plannedWorkingSetsCompleted <= summary.plannedWorkingSetsExpected);
});

test("replacement records the actual exercise, not a fake planned exposure", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act C ${stamp}`, username: `act-c-${stamp}`, usernameNormalized: `act-c-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;

  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const exs = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(2);
  const sessionId = await startSession(u.id, a.planId, 1);
  const planned = exs[0].exerciseId;
  const replacement = exs[1].exerciseId;

  const replaced = await replaceSessionExercise(u.id, sessionId, planned, replacement, "equipment_busy");
  assert.equal(replaced.origin, "replacement");
  await db.insert(workoutSets).values({ workoutSessionExerciseId: replaced.id, setNumber: 1, weightKg: 50, reps: 12, rpe: 6, setType: "working" });

  const original = await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, sessionId), eq(workoutSessionExercises.exerciseId, planned))).limit(1);
  assert.equal(original[0].status, "replaced", "original planned exercise preserved as replaced");

  // The replacement already has a working set, so an undo must be rejected and
  // the logged set preserved.
  await assert.rejects(
    () => restoreSessionExercise(u.id, sessionId, planned),
    /sets logged/,
  );

  await finishSession(u.id, sessionId, {});

  const progress = await buildProgressAnalytics({ userId: u.id });
  const replacementProgress = progress.exercises.find((p) => p.exerciseId === replacement);
  assert.ok(replacementProgress && replacementProgress.attemptedExposures >= 1, "replacement exercise must get the exposure");
});

test("activities support add/update/remove and do not enter resistance analytics", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act D ${stamp}`, username: `act-d-${stamp}`, usernameNormalized: `act-d-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;
  const sessionId = await startSession(u.id, a.planId, 1);

  const activity = await addSessionActivity(u.id, sessionId, {
    activityType: "cardio",
    activityRole: "warmup",
    exerciseId: null,
    nameSnapshot: "Treadmill",
    durationSeconds: 900,
    distanceMeters: null,
    speed: null,
    inclinePercent: null,
    effortRpe: 5,
    notes: null,
  });
  assert.equal(activity.activityRole, "warmup");

  await updateSessionActivity(u.id, sessionId, activity.id, { durationSeconds: 1200 });
  await addSessionActivity(u.id, sessionId, {
    activityType: "mobility",
    activityRole: "mobility",
    exerciseId: null,
    nameSnapshot: "Mobility",
    durationSeconds: 420,
    distanceMeters: null,
    speed: null,
    inclinePercent: null,
    effortRpe: null,
    notes: null,
  });

  const summary = await buildSessionActivitySummary(u.id, sessionId);
  assert.ok(summary.warmupMinutes >= 20);
  assert.ok(summary.mobilityMinutes >= 7);
  assert.equal(summary.warmupSets, 0, "cardio/mobility activities must not count as sets");

  await removeSessionActivity(u.id, sessionId, activity.id);
  const after = await db.select().from(workoutSessionActivities).where(eq(workoutSessionActivities.workoutSessionId, sessionId));
  assert.equal(after.length, 1);
});

test("in-progress set correction allows edit/remove; terminal sessions reject set mutation", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act H ${stamp}`, username: `act-h-${stamp}`, usernameNormalized: `act-h-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;

  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const ex = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(1);
  const sessionId = await startSession(u.id, a.planId, 1);

  const sse = await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, sessionId), eq(workoutSessionExercises.exerciseId, ex[0].exerciseId))).limit(1);
  const [set] = await db.insert(workoutSets).values({ workoutSessionExerciseId: sse[0].id, setNumber: 1, weightKg: 40, reps: 10, rpe: 6, setType: "working" }).returning();

  const edited = await updateSessionSet(u.id, sessionId, set.id, { weightKg: 42.5, reps: 11, rpe: 7, setType: "working" });
  assert.equal(edited.weightKg, 42.5);
  assert.equal(edited.reps, 11);

  await removeSessionSet(u.id, sessionId, set.id);
  const afterRemove = await db.select().from(workoutSets).where(eq(workoutSets.workoutSessionExerciseId, sse[0].id));
  assert.equal(afterRemove.length, 0);

  const [set2] = await db.insert(workoutSets).values({ workoutSessionExerciseId: sse[0].id, setNumber: 1, weightKg: 45, reps: 10, rpe: 7, setType: "working" }).returning();
  await finishSession(u.id, sessionId, {});

  await assert.rejects(
    () => updateSessionSet(u.id, sessionId, set2.id, { reps: 8 }),
    /finalised/,
  );
  await assert.rejects(
    () => removeSessionSet(u.id, sessionId, set2.id),
    /finalised/,
  );
});

test("activity correction allows edit/remove in progress and rejects mutation after completion", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act I ${stamp}`, username: `act-i-${stamp}`, usernameNormalized: `act-i-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;
  const sessionId = await startSession(u.id, a.planId, 1);

  const activity = await addSessionActivity(u.id, sessionId, {
    activityType: "cardio",
    activityRole: "cardio",
    exerciseId: null,
    nameSnapshot: "Treadmill",
    durationSeconds: 900,
    distanceMeters: null,
    speed: null,
    inclinePercent: null,
    effortRpe: 5,
    notes: null,
  });

  const updated = await updateSessionActivity(u.id, sessionId, activity.id, { durationSeconds: 1200, notes: "Steady" });
  assert.equal(updated.durationSeconds, 1200);

  await removeSessionActivity(u.id, sessionId, activity.id);
  const rows = await db.select().from(workoutSessionActivities).where(eq(workoutSessionActivities.id, activity.id));
  assert.equal(rows.length, 0);

  const activity2 = await addSessionActivity(u.id, sessionId, {
    activityType: "mobility",
    activityRole: "mobility",
    exerciseId: null,
    nameSnapshot: "Mobility",
    durationSeconds: 300,
    distanceMeters: null,
    speed: null,
    inclinePercent: null,
    effortRpe: null,
    notes: null,
  });
  await finishSession(u.id, sessionId, {});

  await assert.rejects(
    () => updateSessionActivity(u.id, sessionId, activity2.id, { durationSeconds: 60 }),
    /finalised/,
  );
  await assert.rejects(
    () => removeSessionActivity(u.id, sessionId, activity2.id),
    /finalised/,
  );
});

test("added exercise removal is allowed only with zero actual work", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act J ${stamp}`, username: `act-j-${stamp}`, usernameNormalized: `act-j-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;
  const sessionId = await startSession(u.id, a.planId, 1);

  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const ex = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(1);

  const added = await addUnplannedExercise(u.id, sessionId, ex[0].exerciseId);
  await removeAddedSessionExercise(u.id, sessionId, ex[0].exerciseId);
  const gone = await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.id, added.id));
  assert.equal(gone.length, 0);

  const added2 = await addUnplannedExercise(u.id, sessionId, ex[0].exerciseId);
  await db.insert(workoutSets).values({ workoutSessionExerciseId: added2.id, setNumber: 1, weightKg: 20, reps: 12, rpe: 6, setType: "working" });

  await assert.rejects(
    () => removeAddedSessionExercise(u.id, sessionId, ex[0].exerciseId),
    /cannot be removed/,
  );
});

test("recent actual summary exposes compact cardio/extra/replacement facts", async () => {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Act G ${stamp}`, username: `act-g-${stamp}`, usernameNormalized: `act-g-${stamp}` }).returning();
  a.userId = u.id;
  a.planId = (await createInitialWeek(u.id))!;

  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const exs = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(2);
  const sessionId = await startSession(u.id, a.planId, 1);

  await addSessionActivity(u.id, sessionId, { activityType: "cardio", activityRole: "warmup", exerciseId: null, nameSnapshot: "Treadmill", durationSeconds: 900, distanceMeters: null, speed: null, inclinePercent: null, effortRpe: 5, notes: null });
  const replacement = await replaceSessionExercise(u.id, sessionId, exs[0].exerciseId, exs[1].exerciseId, "equipment_busy");
  await db.insert(workoutSets).values({ workoutSessionExerciseId: replacement.id, setNumber: 1, weightKg: 50, reps: 12, rpe: 6, setType: "working" });
  await finishSession(u.id, sessionId, {});

  const summary = await buildRecentActualSummary(u.id);
  assert.ok(summary.warmupMinutes >= 15);
  assert.equal(summary.replacementWorkingSets, 1);
  assert.ok(summary.replacements.some((r) => r.reason === "equipment_busy"));
});

test("user isolation: B cannot touch A's activities or session", async () => {  const stamp = Date.now();
  const [ua] = await db.insert(users).values({ name: `Act E ${stamp}`, username: `act-e-${stamp}`, usernameNormalized: `act-e-${stamp}` }).returning();
  const [ub] = await db.insert(users).values({ name: `Act F ${stamp}`, username: `act-f-${stamp}`, usernameNormalized: `act-f-${stamp}` }).returning();
  a.userId = ua.id;
  b.userId = ub.id;
  a.planId = (await createInitialWeek(ua.id))!;
  b.planId = (await createInitialWeek(ub.id))!;

  const sessionId = await startSession(ua.id, a.planId, 1);
  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, a.planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  const ex = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, day[0].id)).limit(1);
  const sse = await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, sessionId), eq(workoutSessionExercises.exerciseId, ex[0].exerciseId))).limit(1);
  const [set] = await db.insert(workoutSets).values({ workoutSessionExerciseId: sse[0].id, setNumber: 1, weightKg: 30, reps: 8, rpe: 6, setType: "working" }).returning();
  const added = await addUnplannedExercise(ua.id, sessionId, ex[0].exerciseId);

  await assert.rejects(
    () => addSessionActivity(ub.id, sessionId, { activityType: "cardio", activityRole: "warmup", exerciseId: null, nameSnapshot: "Treadmill", durationSeconds: 600, distanceMeters: null, speed: null, inclinePercent: null, effortRpe: null, notes: null }),
    /Session not found/,
  );
  await assert.rejects(
    () => updateSessionSet(ub.id, sessionId, set.id, { reps: 10 }),
    /Session not found/,
  );
  await assert.rejects(
    () => removeSessionSet(ub.id, sessionId, set.id),
    /Session not found/,
  );
  await assert.rejects(
    () => removeAddedSessionExercise(ub.id, sessionId, added.exerciseId),
    /Session not found/,
  );
});
