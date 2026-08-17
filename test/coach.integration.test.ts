import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  exercises,
  users,
  weeklyPlanProposals,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
} from "@/db/schema";
import { applyProposal } from "@/lib/coach/applyProposal";
import { createProposalForPlan } from "@/lib/coach/service";

const fixture = { userId: 0, exerciseId: 0, sourcePlanId: 0, sourceExerciseId: 0, proposalId: 0, newPlanId: 0 };

after(async () => {
  if (!fixture.userId) return;
  await db.delete(weeklyPlanProposals).where(eq(weeklyPlanProposals.userId, fixture.userId));
  const planRows = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, fixture.userId));
  const planIds = planRows.map((row) => row.id);
  if (planIds.length) {
    const dayRows = await db.select({ id: workoutPlanDays.id }).from(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    if (dayRows.length) await db.delete(workoutPlanExercises).where(inArray(workoutPlanExercises.workoutPlanDayId, dayRows.map((row) => row.id)));
    await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    await db.delete(workoutPlans).where(inArray(workoutPlans.id, planIds));
  }
  await db.delete(exercises).where(eq(exercises.id, fixture.exerciseId));
  await db.delete(users).where(eq(users.id, fixture.userId));
});

test("proposal persistence never writes the new week until approved, then applies once", async () => {
  const [user] = await db.insert(users).values({ name: `Coach test ${Date.now()}`, dateOfBirth: "1990-01-01", heightCm: 180 }).returning();
  const [exercise] = await db.insert(exercises).values({ name: `Coach test press ${Date.now()}`, category: "strength", primaryMuscle: "Chest", equipment: "Machine" }).returning();
  fixture.userId = user.id;
  fixture.exerciseId = exercise.id;
  const [sourcePlan] = await db.insert(workoutPlans).values({ userId: user.id, name: "Week 1", weekNumber: 1, startsOn: "2026-08-17", status: "active" }).returning();
  fixture.sourcePlanId = sourcePlan.id;
  const [sourceDay] = await db.insert(workoutPlanDays).values({ workoutPlanId: sourcePlan.id, dayNumber: 1, dayName: "Mon", title: "Full body" }).returning();
  const [sourceExercise] = await db.insert(workoutPlanExercises).values({ workoutPlanDayId: sourceDay.id, exerciseId: exercise.id, position: 1, targetSets: 2, minReps: 8, maxReps: 12, targetRpe: 6, suggestedWeightKg: 20, restSeconds: 90 }).returning();
  fixture.sourceExerciseId = sourceExercise.id;

  const stored = await createProposalForPlan(user.id, sourcePlan.id);
  fixture.proposalId = stored.id;
  const before = await db.select().from(workoutPlans).where(eq(workoutPlans.userId, user.id));
  assert.equal(before.length, 1, "creating a proposal must not create Week 2");
  assert.equal(before[0].status, "active");

  const first = await applyProposal(user.id, stored.id, { confirmation: "approve" });
  fixture.newPlanId = first.planId;
  const second = await applyProposal(user.id, stored.id, { confirmation: "approve" });
  assert.deepEqual(second, first, "reapplying must be idempotent");
  const plans = await db.select().from(workoutPlans).where(eq(workoutPlans.userId, user.id));
  assert.equal(plans.length, 2, "Week 2 should be created exactly once");
  const sourceAfter = plans.find((plan) => plan.id === sourcePlan.id)!;
  assert.equal(sourceAfter.status, "completed");
  const historical = await db.select().from(workoutPlanExercises).where(eq(workoutPlanExercises.id, sourceExercise.id));
  assert.equal(historical[0].suggestedWeightKg, 20, "Week 1 prescription must remain unchanged");
});
