import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  planRevisions,
  exercises,
  recoveryLogs,
  sessionPlanSnapshots,
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
import {
  createSession,
  finishSession,
  getActiveWorkoutData,
  getSessionDetail,
  getSessionPlanSnapshot,
  getSessionSummary,
} from "@/lib/workouts";
import { buildProgressAnalytics } from "@/lib/progress";
import { isMeasurementType } from "@/lib/exercise-measurement";
import { addDaysToISODate } from "@/lib/dates";
import { buildWeeklyActualSummary } from "@/lib/training-summary";
import {
  buildRecentActualSummary,
  logSessionSet,
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

async function newUser(tag: string) {
  const stamp = Date.now();
  const [u] = await db.insert(users).values({ name: `Snap ${tag} ${stamp}`, username: `snap-${tag}-${stamp}`, usernameNormalized: `snap-${tag}-${stamp}` }).returning();
  createdUserIds.push(u.id);
  const planId = (await createInitialWeek(u.id))!;
  const day = await db.select().from(workoutPlanDays).where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, 1))).limit(1);
  return { user: u, planId, day: day[0] };
}

async function dayExerciseIds(dayId: number) {
  const rows = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayId)).orderBy(workoutPlanExercises.position);
  return rows;
}

/** An active catalogue exercise that is NOT part of the given day's plan. */
async function replacementExerciseIdNotInPlan(planExerciseIds: number[]) {
  const rows = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.active, true)).limit(50);
  const used = new Set(planExerciseIds);
  return rows.map((r) => r.id).find((id) => !used.has(id));
}

test("session start freezes a prescription snapshot equal to the plan", async () => {
  const { user, day } = await newUser("A");
  const planExercises = await dayExerciseIds(day.id);

  const session = await createSession(user.id, day.id);
  const snapshot = await getSessionPlanSnapshot(session.id);
  assert.ok(snapshot, "snapshot must exist after starting");
  assert.equal(snapshot.workoutSessionId, session.id);
  assert.equal(snapshot.title, day.title);
  assert.equal(snapshot.exercises.length, planExercises.length);

  const planMap = new Map(planExercises.map((pe) => [pe.exerciseId, pe]));
  for (const pe of snapshot.exercises) {
    const plan = planMap.get(pe.exerciseId);
    assert.ok(plan, "snapshot exercise is part of the plan");
    assert.equal(isMeasurementType(pe.measurementType), true, "snapshot preserves a canonical measurement type");
    assert.equal(pe.targetSets, plan.targetSets);
    assert.equal(pe.minReps, plan.minReps);
    assert.equal(pe.maxReps, plan.maxReps);
    assert.equal(pe.targetRpe, plan.targetRpe);
    assert.equal(pe.restSeconds, plan.restSeconds);
  }
});

test("active session reads the snapshot, not a mutated live plan", async () => {
  const { user, day } = await newUser("B");
  const pe = (await dayExerciseIds(day.id))[0];
  const originalTargetSets = pe.targetSets;
  const session = await createSession(user.id, day.id);
  const before = await getActiveWorkoutData(user.id, session.id);
  assert.ok(before);

  // Mutate the live plan mid-session: bump target sets / renamed title.
  await db.update(workoutPlanExercises).set({ targetSets: originalTargetSets + 2 }).where(eq(workoutPlanExercises.id, pe.id));
  await db.update(workoutPlanDays).set({ title: "Mutated Title" }).where(eq(workoutPlanDays.id, day.id));

  const after = await getActiveWorkoutData(user.id, session.id);
  assert.ok(after);
  assert.equal(after.title, day.title, "session title is frozen at start, not live plan");
  const target = after.exercises.find((e) => e.exerciseId === pe.exerciseId);
  assert.ok(target);
  assert.equal(target.targetSets, originalTargetSets, "target sets come from the snapshot, not the later plan edit");
});

test("planned exercise logs sets normally and completes", async () => {
  const { user, day } = await newUser("C");
  const session = await createSession(user.id, day.id);
  const active = await getActiveWorkoutData(user.id, session.id);
  assert.ok(active);
  const ex = active.exercises[0];
  assert.equal(ex.status, "pending");
  assert.equal(ex.origin, "planned");

  await logSessionSet(user.id, session.id, { exerciseId: ex.exerciseId, weightKg: 40, reps: 10, rpe: 6, setType: "working" });

  const refreshed = await getActiveWorkoutData(user.id, session.id);
  assert.ok(refreshed);
  const afterEx = refreshed.exercises.find((e) => e.exerciseId === ex.exerciseId);
  assert.equal(afterEx?.loggedSets.length, 1);
});

test("replacement preserves the original prescription and reason", async () => {
  const { user, day } = await newUser("D");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId && replacementId !== plannedIds[0], "need a distinct replacement exercise");
  const session = await createSession(user.id, day.id);

  const replaced = await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "equipment_busy");
  assert.equal(replaced.origin, "replacement");
  assert.equal(replaced.replacementReason, "equipment_busy");

  const active = await getActiveWorkoutData(user.id, session.id);
  assert.ok(active);

  const original = active.exercises.find((e) => e.exerciseId === exs[0].exerciseId);
  assert.equal(original?.status, "replaced", "replaced original is non-actionable");
  assert.equal(original?.replacedByName, active.exercises.find((e) => e.exerciseId === replacementId)?.name ?? null, "original names its replacement");

  const repl = active.exercises.find((e) => e.exerciseId === replacementId);
  assert.equal(repl?.replacementReason, "equipment_busy");
  assert.equal(repl?.replacesName, original?.name, "replacement names the prescribed original");
  assert.equal(repl?.targetSets, original?.targetSets, "replacement inherits the original prescription target sets");
  assert.equal(repl?.minReps, original?.minReps);
  assert.equal(repl?.maxReps, original?.maxReps);
});

test("replaced original cannot receive sets", async () => {
  const { user, day } = await newUser("E");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "preference");

  await assert.rejects(
    () => logSessionSet(user.id, session.id, { exerciseId: exs[0].exerciseId, weightKg: 40, reps: 10, rpe: 6, setType: "working" }),
    /replaced/,
  );
});

test("restore allowed only with zero replacement work; work is never deleted", async () => {
  const { user, day } = await newUser("F");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);

  // Zero-work restore succeeds.
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "equipment_busy");
  await restoreSessionExercise(user.id, session.id, exs[0].exerciseId);
  const restoredActive = await getActiveWorkoutData(user.id, session.id);
  assert.ok(restoredActive);
  const restored = restoredActive.exercises.find((e) => e.exerciseId === exs[0].exerciseId);
  assert.equal(restored?.status, "pending", "zero-work replace then restore returns the original to pending");

  // Working-set restore is rejected and work preserved.
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "equipment_busy");
  const replacement = await db.select().from(workoutSessionExercises).where(and(eq(workoutSessionExercises.workoutSessionId, session.id), eq(workoutSessionExercises.exerciseId, replacementId))).limit(1);
  await logSessionSet(user.id, session.id, { exerciseId: replacementId, weightKg: 50, reps: 12, rpe: 6, setType: "working" });
  await assert.rejects(
    () => restoreSessionExercise(user.id, session.id, exs[0].exerciseId),
    /sets logged/,
  );
  const afterReject = await db.select().from(workoutSets).where(eq(workoutSets.workoutSessionExerciseId, replacement[0].id));
  assert.equal(afterReject.length, 1, "logged replacement work survives a rejected restore");
});

test("restore rejects after a warm-up set too", async () => {
  const { user, day } = await newUser("G");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "pain_discomfort");
  await logSessionSet(user.id, session.id, { exerciseId: replacementId, weightKg: 20, reps: 5, rpe: 4, setType: "warmup" });

  await assert.rejects(
    () => restoreSessionExercise(user.id, session.id, exs[0].exerciseId),
    /sets logged/,
  );
});

test("replaced original gets no fake progress exposure; replacement gets the real one", async () => {
  const { user, day } = await newUser("H");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);

  const replaced = await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "equipment_busy");
  await logSessionSet(user.id, session.id, { exerciseId: replacementId, weightKg: 50, reps: 12, rpe: 6, setType: "working" });
  await finishSession(user.id, session.id, {});

  const progress = await buildProgressAnalytics({ userId: user.id, anchorDate: new Date(session.completedAt ?? new Date()) });

  const replacement = progress.exercises.find((p) => p.exerciseId === replacementId);
  assert.ok(replacement && replacement.attemptedExposures >= 1, "replacement gets the exposure");
  assert.equal(replacement.notAttemptedExposures, 0);

  const original = progress.exercises.find((p) => p.exerciseId === exs[0].exerciseId);
  assert.ok(original);
  assert.equal(original.attemptedExposures, 0, "replaced original must not be treated as performed");
  assert.ok(original.notAttemptedExposures >= 1);
});

test("reason and provenance survive refresh and history", async () => {
  const { user, day } = await newUser("I");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "pain_discomfort");
  await logSessionSet(user.id, session.id, { exerciseId: replacementId, weightKg: 30, reps: 10, rpe: 6, setType: "working" });
  await finishSession(user.id, session.id, {});

  const detail = await getSessionDetail(user.id, session.id);
  assert.ok(detail);

  const repl = detail.exercises.find((e) => e.origin === "replacement");
  assert.ok(repl);
  assert.equal(repl.replacementReason, "pain_discomfort");
  assert.ok(repl.replacesName, "replacement names the prescribed original");

  const original = detail.exercises.find((e) => e.status === "replaced");
  assert.ok(original);
  assert.equal(original.replacedByName, repl.name, "history ties the original to its replacement");
});

test("pain-driven replacement surfaces to the coach as a safety fact", async () => {
  const { user, day } = await newUser("J");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "pain_discomfort");
  await logSessionSet(user.id, session.id, { exerciseId: replacementId, weightKg: 20, reps: 10, rpe: 6, setType: "working" });
  await finishSession(user.id, session.id, {});

  const actual = await buildRecentActualSummary(user.id, 28);
  assert.ok(actual.replacements.some((r) => r.reason === "pain_discomfort"));
});

test("summary reports how many were replaced", async () => {
  const { user, day } = await newUser("K");
  const exs = await dayExerciseIds(day.id);
  const plannedIds = exs.map((e) => e.exerciseId);
  const replacementId = await replacementExerciseIdNotInPlan(plannedIds);
  assert.ok(replacementId);
  const session = await createSession(user.id, day.id);
  await replaceSessionExercise(user.id, session.id, exs[0].exerciseId, replacementId, "other");
  await finishSession(user.id, session.id, {});

  const summary = await getSessionSummary(user.id, session.id);
  assert.ok(summary);
  assert.equal(summary.replacedExerciseCount, 1);
});

test("a snapshot exists once and is immutable after a plan edit", async () => {
  const { user, day } = await newUser("L");
  const session = await createSession(user.id, day.id);
  const snapshots = await db.select().from(sessionPlanSnapshots).where(eq(sessionPlanSnapshots.workoutSessionId, session.id));
  assert.equal(snapshots.length, 1, "exactly one snapshot per started session");

  const first = await getSessionPlanSnapshot(session.id);
  assert.ok(first);
  await db.update(workoutPlanDays).set({ title: "Rewritten" }).where(eq(workoutPlanDays.id, day.id));
  const second = await getSessionPlanSnapshot(session.id);
  assert.ok(second);
  assert.equal(second.title, first.title, "snapshot does not track plan mutations");
});

test("canonical weekly summary compares against session snapshot, not mutated live plan", async () => {
  const { user, day, planId } = await newUser("M");
  const session = await createSession(user.id, day.id);
  const snapBefore = await getSessionPlanSnapshot(session.id);
  assert.ok(snapBefore);
  const expectedFromSnapshot = snapBefore.exercises.reduce((sum, ex) => sum + ex.targetSets, 0);

  const firstExercise = (await dayExerciseIds(day.id))[0];
  await db
    .update(workoutPlanExercises)
    .set({ targetSets: firstExercise.targetSets + 4 })
    .where(eq(workoutPlanExercises.id, firstExercise.id));

  await logSessionSet(user.id, session.id, {
    exerciseId: firstExercise.exerciseId,
    weightKg: 40,
    reps: 10,
    rpe: 6,
    setType: "working",
  });
  await finishSession(user.id, session.id, {});

  const plan = (
    await db.select().from(workoutPlans).where(eq(workoutPlans.id, planId)).limit(1)
  )[0];
  const summary = await buildWeeklyActualSummary({
    userId: user.id,
    windowStartISO: plan.startsOn,
    windowEndISO: addDaysToISODate(plan.startsOn, 6),
    anchorDateISO: addDaysToISODate(plan.startsOn, 6),
  });

  const sessionFact = summary.planVsActual.sessions.find((item) => item.sessionId === session.id);
  assert.ok(sessionFact);
  assert.equal(sessionFact.plannedWorkingSets, expectedFromSnapshot);
});