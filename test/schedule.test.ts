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
  workoutSessions,
} from "@/db/schema";
import { createInitialWeek } from "@/lib/initial-week";
import { proposeRestDayWorkout } from "@/lib/coach/restDay";
import { applyPlanAdjustment, proposeMoveOrSwap } from "@/lib/schedule";

const f = { userId: 0, planId: 0 };

after(async () => {
  if (!f.userId) return;
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, f.userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, f.userId));
  const plans = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, f.userId));
  const planIds = plans.map((p) => p.id);
  if (planIds.length) {
    const days = await db.select({ id: workoutPlanDays.id }).from(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    if (days.length) {
      await db.delete(workoutPlanExercises).where(inArray(workoutPlanExercises.workoutPlanDayId, days.map((d) => d.id)));
      await db.delete(workoutSessions).where(inArray(workoutSessions.workoutPlanDayId, days.map((d) => d.id)));
    }
    await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    await db.delete(workoutPlans).where(eq(workoutPlans.userId, f.userId));
  }
  await db.delete(users).where(eq(users.id, f.userId));
});

test("move to a rest day applies once and preserves the workout", async () => {
  const [user] = await db.insert(users).values({ name: "Schedule Test", username: `sched-${Date.now()}`, usernameNormalized: `sched-${Date.now()}` }).returning();
  f.userId = user.id;
  const planId = (await createInitialWeek(user.id))!;
  f.planId = planId;

  const days = await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.workoutPlanId, planId));
  const wed = days.find((d) => d.dayNumber === 3)!;
  const thu = days.find((d) => d.dayNumber === 4)!;

  const proposal = await proposeMoveOrSwap(user.id, planId, wed.id, thu.id);
  assert.equal(proposal.type, "move_workout");

  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const afterWed = await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.id, wed.id));
  const afterThu = await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.id, thu.id));
  assert.equal(afterWed[0].title, "Rest");
  assert.equal(afterThu[0].title, "Full Body B");

  // Idempotent re-apply must not duplicate exercises.
  await applyPlanAdjustment(user.id, proposal.id, { confirmation: "approve" });
  const thuExercises = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.workoutPlanDayId, thu.id));
  assert.equal(thuExercises.length, 6);
});

test("a completed workout cannot be moved", async () => {
  const [user] = await db.insert(users).values({ name: "Schedule Test 2", username: `sched2-${Date.now()}`, usernameNormalized: `sched2-${Date.now()}` }).returning();
  const planId = (await createInitialWeek(user.id))!;
  const days = await db.select().from(workoutPlanDays).where(eq(workoutPlanDays.workoutPlanId, planId));
  const mon = days.find((d) => d.dayNumber === 1)!;
  const tue = days.find((d) => d.dayNumber === 2)!;
  await db.insert(workoutSessions).values({ userId: user.id, workoutPlanDayId: mon.id, completedAt: new Date() });

  await assert.rejects(
    () => proposeMoveOrSwap(user.id, planId, mon.id, tue.id),
    /completed workout cannot be moved/i,
  );

  // Cleanup for this second fixture.
  const plans = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, user.id));
  const planIds = plans.map((p) => p.id);
  const allDays = await db.select({ id: workoutPlanDays.id }).from(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
  if (allDays.length) await db.delete(workoutPlanExercises).where(inArray(workoutPlanExercises.workoutPlanDayId, allDays.map((d) => d.id)));
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, user.id));
  if (allDays.length) await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
  await db.delete(workoutPlans).where(eq(workoutPlans.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));
});

test("rest-day workout: light is default and heavy downgrades under joint pain", async () => {
  const [user] = await db.insert(users).values({ name: "Rest Day Test", username: `rest-${Date.now()}`, usernameNormalized: `rest-${Date.now()}` }).returning();
  const planId = (await createInitialWeek(user.id))!;
  await db.insert(recoveryLogs).values({ userId: user.id, logDate: "2026-08-17", sleepRating: 8, energyRating: 8, sorenessRating: 2, jointPainRating: 8, stressRating: 3 });

  const light = await proposeRestDayWorkout({ userId: user.id, workoutPlanId: planId, dayNumber: 4, requestedEffort: "light" });
  assert.equal(light.effort, "light");

  const heavy = await proposeRestDayWorkout({ userId: user.id, workoutPlanId: planId, dayNumber: 4, requestedEffort: "heavy" });
  assert.equal(heavy.effort, "light");

  // Cleanup for this third fixture.
  const plans = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, user.id));
  const planIds = plans.map((p) => p.id);
  const allDays = await db.select({ id: workoutPlanDays.id }).from(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
  if (allDays.length) await db.delete(workoutPlanExercises).where(inArray(workoutPlanExercises.workoutPlanDayId, allDays.map((d) => d.id)));
  if (allDays.length) await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
  await db.delete(workoutPlans).where(eq(workoutPlans.userId, user.id));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));
});
