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
import { DomainError } from "@/lib/errors";
import { applyPlanAdjustment, proposeMoveOrSwap, removeExtraWorkout } from "@/lib/schedule";
import { restorePlanRevision } from "@/lib/plan-revisions";
import {
  startOrResumeSession,
  finishSession,
  skipPlannedSession,
  cancelEmptySession,
  skipSessionExercise,
  restoreSkippedExercise,
} from "@/lib/workouts";

interface PlanDayRow {
  id: number;
  dayNumber: number;
  dayName: string;
  title: string;
  origin: string | null;
}

const createdUserIds: number[] = [];

async function deleteUser(userId: number) {
  if (!userId) return;
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));
  const sessions = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length) {
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
    .values({ name: `Rev ${tag} ${stamp}`, username: `rev-${tag}-${stamp}`, usernameNormalized: `rev-${tag}-${stamp}` })
    .returning();
  createdUserIds.push(u.id);
  const planId = (await createInitialWeek(u.id))!;
  return { user: u, planId };
}

async function getDays(planId: number): Promise<PlanDayRow[]> {
  return db.select().from(workoutPlanDays).where(eq(workoutPlanDays.workoutPlanId, planId)).orderBy(workoutPlanDays.dayNumber);
}

async function dayExercises(dayId: number) {
  return db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, dayId)).orderBy(workoutPlanExercises.position);
}

async function countSessions(dayId: number): Promise<number> {
  const rows = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, dayId));
  return rows.length;
}

async function countSkippedSessionsForPlan(planId: number): Promise<number> {
  const days = await getDays(planId);
  const rows = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(inArray(workoutSessions.workoutPlanDayId, days.map((d) => d.id)), eq(workoutSessions.status, "skipped")));
  return rows.length;
}

function expectCode(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof DomainError, `expected DomainError, got ${err}`);
    assert.equal((err as DomainError).code, code);
    return true;
  };
}

interface RevisionRow {
  id: number;
  kind: string;
  reversesRevisionId: number | null;
  restoredAt: Date | null;
}

async function revisionsForPlan(planId: number): Promise<RevisionRow[]> {
  const rows = await db
    .select({
      id: planRevisions.id,
      kind: planRevisions.kind,
      reversesRevisionId: planRevisions.reversesRevisionId,
      restoredAt: planRevisions.restoredAt,
    })
    .from(planRevisions)
    .where(eq(planRevisions.workoutPlanId, planId))
    .orderBy(planRevisions.id);
  return rows.map((r) => ({ id: r.id, kind: r.kind, reversesRevisionId: r.reversesRevisionId, restoredAt: r.restoredAt }));
}

async function addExtraDay(planId: number) {
  const days = await getDays(planId);
  const rest = days.find((d) => d.dayNumber === 4)!;
  const source = days.find((d) => d.dayNumber === 1)!;
  const pe = (await dayExercises(source.id))[0];
  await db.insert(workoutPlanExercises).values({
    workoutPlanDayId: rest.id,
    exerciseId: pe.exerciseId,
    position: pe.position,
    targetSets: pe.targetSets,
    minReps: pe.minReps,
    maxReps: pe.maxReps,
    targetRpe: pe.targetRpe,
    suggestedWeightKg: pe.suggestedWeightKg,
    restSeconds: pe.restSeconds,
    notes: null,
  });
  await db.update(workoutPlanDays).set({ title: "Extra", origin: "extra" }).where(eq(workoutPlanDays.id, rest.id));
  return rest;
}

interface ExProbe {
  exerciseId: number;
  position: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
  restSeconds: number;
}

function pickEx(e: { exerciseId: number; position: number; targetSets: number; minReps: number; maxReps: number; targetRpe: number; suggestedWeightKg: number | null; restSeconds: number }): ExProbe {
  return {
    exerciseId: e.exerciseId,
    position: e.position,
    targetSets: e.targetSets,
    minReps: e.minReps,
    maxReps: e.maxReps,
    targetRpe: e.targetRpe,
    suggestedWeightKg: e.suggestedWeightKg,
    restSeconds: e.restSeconds,
  };
}

function compareExercises(a: ExProbe[], b: ExProbe[]) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i], b[i], `exercise ${i} mismatch`);
  }
}

async function firstMoveRevision(planId: number) {
  const revs = await revisionsForPlan(planId);
  return revs.find((r) => r.kind === "move")!;
}

//

test("extra unstarted → remove extra → returns to Rest with no session or skip", async () => {
  const { user, planId } = await makeUser("remove");
  const extra = await addExtraDay(planId);

  const result = await removeExtraWorkout(user.id, extra.id);
  assert.equal(result.ok, true);

  const after = (await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.id, extra.id)).limit(1))[0];
  assert.equal(after.title, "Rest");
  assert.equal(after.origin, null);
  assert.equal(await countSessions(extra.id), 0, "no workout session created");

  const skipped = await countSkippedSessionsForPlan(planId);
  assert.equal(skipped, 0, "no skipped outcome created");
});

test("remove extra after an accidental start is rejected (cancel first)", async () => {
  const { user, planId } = await makeUser("started");
  const extra = await addExtraDay(planId);
  await startOrResumeSession(user.id, extra.id);

  await assert.rejects(
    () => removeExtraWorkout(user.id, extra.id),
    expectCode("PLAN_DAY_ALREADY_STARTED"),
  );

  // Product flow: Cancel Start first, then Remove Extra is allowed.
  const started = (await db.select().from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, extra.id)).limit(1))[0];
  await cancelEmptySession(user.id, started.id);
  const result = await removeExtraWorkout(user.id, extra.id);
  assert.equal(result.ok, true);
  assert.equal(await countSessions(extra.id), 0);
});

test("remove extra after actual work is rejected", async () => {
  const { user, planId } = await makeUser("work");
  const extra = await addExtraDay(planId);
  const { session } = await startOrResumeSession(user.id, extra.id);
  const sse = (await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, session.id)).limit(1))[0];
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: 20, reps: 10, rpe: 6 });

  await assert.rejects(
    () => removeExtraWorkout(user.id, extra.id),
    expectCode("PLAN_DAY_ALREADY_STARTED"),
  );
  const sessions = await db.select().from(workoutSessions).where(eq(workoutSessions.workoutPlanDayId, extra.id));
  assert.equal(sessions.length, 1, "started session is preserved");
});

test("remove extra is double-submit safe", async () => {
  const { user, planId } = await makeUser("dblsub");
  const extra = await addExtraDay(planId);

  const first = await removeExtraWorkout(user.id, extra.id);
  assert.equal(first.ok, true);
  const second = await removeExtraWorkout(user.id, extra.id);
  assert.equal(second.ok, true, "second submit is a no-op, not an error");
  assert.equal(await countSessions(extra.id), 0);
  const extraRevs = (await revisionsForPlan(planId)).filter((r) => r.kind === "remove_extra");
  assert.equal(extraRevs.length, 1, "only one remove-extra revision recorded");
});

test("move → restore returns the exact original prescription", async () => {
  const { user, planId } = await makeUser("restore");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const original = await dayExercises(wed.id);

  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });

  const rev = await firstMoveRevision(planId);
  assert.ok(rev);

  const movedThu = await dayExercises(thu.id);
  assert.equal(movedThu.length, original.length, "workout moved to Thursday");

  const result = await restorePlanRevision(user.id, rev.id);
  assert.equal(result.restored, true);

  const restored = await dayExercises(wed.id);
  compareExercises(
    original.map(pickEx),
    restored.map(pickEx),
  );
  const backThu = await dayExercises(thu.id);
  assert.equal(backThu.length, 0, "Thursday returned to Rest");
  const wedDay = (await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.id, wed.id)).limit(1))[0];
  assert.equal(wedDay.title, "Full Body B");
  assert.equal(wedDay.origin, null);
});

test("restore is rejected once already restored and creates no duplicate history", async () => {
  const { user, planId } = await makeUser("re-restore");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const rev = await firstMoveRevision(planId);

  await restorePlanRevision(user.id, rev.id);
  await assert.rejects(
    () => restorePlanRevision(user.id, rev.id),
    expectCode("PLAN_REVISION_ALREADY_RESTORED"),
  );
  assert.equal((await dayExercises(wed.id)).length, 6, "workout still on Wednesday");
});

test("move again → restore restores to the pre-move original day", async () => {
  const { user, planId } = await makeUser("chain");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const sat = days.find((d) => d.dayNumber === 6)!;
  const original = await dayExercises(wed.id);

  // Wed → Thu
  let proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const first = await firstMoveRevision(planId);

  // Thu → Sat (Move Again on the moved workout)
  proposal = await proposeMoveOrSwap(user.id, planId, thu.id, sat.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });

  const revs = await revisionsForPlan(planId);
  const moves = revs.filter((r) => r.kind === "move");
  assert.equal(moves.length, 2);
  const second = moves.find((r) => r.id !== first.id)!;
  assert.equal(second.reversesRevisionId, first.id, "later move chains the earlier move");

  assert.equal((await dayExercises(thu.id)).length, 0);
  assert.equal((await dayExercises(sat.id)).length, 6, "workout now on Saturday");

  // Restore Original Day on the head restores the whole chain back to Wednesday.
  const result = await restorePlanRevision(user.id, second.id);
  assert.equal(result.restored, true);

  const restored = await dayExercises(wed.id);
  compareExercises(
    original.map(pickEx),
    restored.map(pickEx),
  );
  assert.equal((await dayExercises(thu.id)).length, 0);
  assert.equal((await dayExercises(sat.id)).length, 0);

  const afterRestores = await revisionsForPlan(planId);
  const restoredRevs = afterRestores.filter((r) => r.restoredAt != null);
  assert.equal(restoredRevs.length, 2, "whole chain marked restored atomically");
});

test("restore after an affected day starts is rejected", async () => {
  const { user, planId } = await makeUser("restorelive");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const rev = await firstMoveRevision(planId);

  await startOrResumeSession(user.id, thu.id);
  await assert.rejects(
    () => restorePlanRevision(user.id, rev.id),
    expectCode("PLAN_REVISION_DAY_STARTED"),
  );
});

test("restore after completed, ended-early or skipped history is rejected", async () => {
  const { user, planId } = await makeUser("restorehist");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const rev = await firstMoveRevision(planId);

  // Completed
  const done = await startOrResumeSession(user.id, thu.id);
  const sse = (await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, done.session.id)).limit(1))[0];
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: 40, reps: 10, rpe: 7 });
  await finishSession(user.id, done.session.id, {});
  await assert.rejects(
    () => restorePlanRevision(user.id, rev.id),
    expectCode("PLAN_REVISION_DAY_STARTED"),
  );
});

test("restore after a skipped session is rejected", async () => {
  const { user, planId } = await makeUser("restoreskip");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const rev = await firstMoveRevision(planId);

  await skipPlannedSession(user.id, thu.id, "short_on_time");
  await assert.rejects(
    () => restorePlanRevision(user.id, rev.id),
    expectCode("PLAN_REVISION_DAY_STARTED"),
  );
});

test("swap → restore restores both sides atomically", async () => {
  const { user, planId } = await makeUser("swap");
  const days = await getDays(planId);
  const mon = days.find((d) => d.dayNumber === 1)!;
  const wed = days.find((d) => d.dayNumber === 3)!;
  const monOriginal = await dayExercises(mon.id);
  const wedOriginal = await dayExercises(wed.id);

  const proposal = await proposeMoveOrSwap(user.id, planId, mon.id, wed.id);
  assert.equal(proposal.type, "swap_days");
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });

  const afterMon = await dayExercises(mon.id);
  const afterWed = await dayExercises(wed.id);
  assert.ok(afterMon.some((e) => e.exerciseId === wedOriginal[0].exerciseId), "Monday now holds Wednesday's workout");
  assert.ok(afterWed.some((e) => e.exerciseId === monOriginal[0].exerciseId), "Wednesday now holds Monday's workout");

  const swapRev = (await revisionsForPlan(planId)).find((r) => r.kind === "swap")!;
  assert.ok(swapRev);

  const result = await restorePlanRevision(user.id, swapRev.id);
  assert.equal(result.restored, true);

  compareExercises(
    monOriginal.map(pickEx),
    (await dayExercises(mon.id)).map(pickEx),
  );
  compareExercises(
    wedOriginal.map(pickEx),
    (await dayExercises(wed.id)).map(pickEx),
  );
});

test("swap restore with one side started is rejected atomically", async () => {
  const { user, planId } = await makeUser("swaplive");
  const days = await getDays(planId);
  const mon = days.find((d) => d.dayNumber === 1)!;
  const wed = days.find((d) => d.dayNumber === 3)!;
  const proposald = await proposeMoveOrSwap(user.id, planId, mon.id, wed.id);
  await applyPlanAdjustment(user.id, proposald.id, { confirmation: "approve" });
  const swapRev = (await revisionsForPlan(planId)).find((r) => r.kind === "swap")!;

  await startOrResumeSession(user.id, mon.id);
  await assert.rejects(
    () => restorePlanRevision(user.id, swapRev.id),
    expectCode("PLAN_REVISION_DAY_STARTED"),
  );
  // Neither side changed.
  const afterMon = await dayExercises(mon.id);
  const afterWed = await dayExercises(wed.id);
  assert.ok(afterMon.length === 6 && afterWed.length === 6);
});

test("stale restore is rejected", async () => {
  const { user, planId } = await makeUser("stale");
  const days = await getDays(planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const rev = await firstMoveRevision(planId);

  // A later unrelated change to the plan invalidates the revision.
  const fri = days.find((d) => d.dayNumber === 5)!;
  const src = (await dayExercises(days.find((d) => d.dayNumber === 1)!.id))[0];
  await db.insert(workoutPlanExercises).values({
    workoutPlanDayId: fri.id,
    exerciseId: src.exerciseId,
    position: 99,
    targetSets: 3,
    minReps: 6,
    maxReps: 8,
    targetRpe: 7,
    suggestedWeightKg: src.suggestedWeightKg,
    restSeconds: 90,
    notes: null,
  });

  await assert.rejects(
    () => restorePlanRevision(user.id, rev.id),
    expectCode("PLAN_REVISION_STALE"),
  );
});

test("user A cannot restore user B's revision", async () => {
  const a = await makeUser("isoa");
  const b = await makeUser("isob");
  const days = await getDays(a.planId);
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;
  const proposal = await proposeMoveOrSwap(a.user.id, a.planId, wed.id, thu.id);
  await applyPlanAdjustment(a.user.id, proposal.id, { confirmation: "approve" });
  const rev = await firstMoveRevision(a.planId);

  await assert.rejects(
    () => restorePlanRevision(b.user.id, rev.id),
    expectCode("PLAN_REVISION_NOT_FOUND"),
  );
});

test("cancel empty start returns to normal unstarted day (UI/API path)", async () => {
  const { user, planId } = await makeUser("cancelapi");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;

  const started = await startOrResumeSession(user.id, workout.id);
  assert.equal(started.created, true);

  const result = await cancelEmptySession(user.id, started.session.id);
  assert.deepEqual(result, { cancelled: true });
  assert.equal(await countSessions(workout.id), 0, "session removed, no terminal history");

  const again = await startOrResumeSession(user.id, workout.id);
  assert.equal(again.created, true, "day startable again as a normal unstarted day");
  assert.notEqual(again.session.id, started.session.id);
});

test("cancel start with actual work is rejected", async () => {
  const { user, planId } = await makeUser("cancelwork");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const sse = (await db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.workoutSessionId, session.id)).limit(1))[0];
  await db.insert(workoutSets).values({ workoutSessionExerciseId: sse.id, setNumber: 1, weightKg: 30, reps: 10, rpe: 6 });

  await assert.rejects(
    () => cancelEmptySession(user.id, session.id),
    expectCode("SESSION_HAS_ACTUAL_WORK"),
  );
  const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
  assert.equal(rows.length, 1, "session preserved");
});

test("exercise skip → undo skip persists after refresh", async () => {
  const { user, planId } = await makeUser("undosk");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await dayExercises(workout.id))[0].exerciseId;

  await skipSessionExercise(user.id, session.id, exId, "equipment_busy");
  const restored = await restoreSkippedExercise(user.id, session.id, exId);
  assert.equal(restored.status, "pending");

  const after = await db
    .select()
    .from(workoutSessionExercises)
    .where(and(eq(workoutSessionExercises.workoutSessionId, session.id), eq(workoutSessionExercises.exerciseId, exId)))
    .limit(1);
  assert.equal(after[0].status, "pending", "restored state persisted after refresh (re-query)");
});

test("terminal skipped exercise cannot be restored", async () => {
  const { user, planId } = await makeUser("termsk");
  const days = await getDays(planId);
  const workout = days.find((d) => d.dayNumber === 1)!;
  const { session } = await startOrResumeSession(user.id, workout.id);
  const exId = (await dayExercises(workout.id))[0].exerciseId;
  await skipSessionExercise(user.id, session.id, exId, "pain");
  await finishSession(user.id, session.id, {});

  await assert.rejects(
    () => restoreSkippedExercise(user.id, session.id, exId),
    expectCode("SESSION_NOT_IN_PROGRESS"),
  );
});