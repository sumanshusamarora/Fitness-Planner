import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  planAdjustmentProposals,
  planRevisions,
  userTrainingProfiles,
  users,
  weeklyPlanProposals,
  workoutPlanDays,
  workoutPlanExercises,
  workoutPlans,
} from "@/db/schema";
import { applyProposal } from "@/lib/coach/applyProposal";
import { buildInitialTrainingContext } from "@/lib/coach/initialContext";
import { createInitialProposal, getDraftInitialProposal } from "@/lib/coach/service";
import { upsertTrainingProfile } from "@/lib/training-profile";

const f = { userId: 0, proposalId: 0, planId: 0 };

async function deleteUser(userId: number) {
  if (!userId) return;
  await db.delete(userTrainingProfiles).where(eq(userTrainingProfiles.userId, userId));
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(weeklyPlanProposals).where(eq(weeklyPlanProposals.userId, userId));
  const plans = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, userId));
  const planIds = plans.map((p) => p.id);
  if (planIds.length) {
    const days = await db.select({ id: workoutPlanDays.id }).from(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    if (days.length) await db.delete(workoutPlanExercises).where(inArray(workoutPlanExercises.workoutPlanDayId, days.map((d) => d.id)));
    await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    await db.delete(workoutPlans).where(inArray(workoutPlans.id, planIds));
  }
  await db.delete(users).where(eq(users.id, userId));
}

after(async () => {
  await deleteUser(f.userId);
});

test("onboarding: profile persists, proposal is review-only, approval creates Week 1 once", async () => {
  const stamp = Date.now();
  const [user] = await db.insert(users).values({ name: "Onboarding Test", username: `onboard-${stamp}`, usernameNormalized: `onboard-${stamp}` }).returning();
  f.userId = user.id;

  await upsertTrainingProfile(user.id, {
    primaryGoal: "get_stronger",
    secondaryGoals: ["build_muscle"],
    experienceLevel: "returning",
    yearsSinceTraining: 8,
    desiredDaysPerWeek: 6,
    preferredDays: [1, 3, 5],
    sessionMinutes: "45",
    trainingEnvironment: "full_gym",
    equipmentNotes: null,
    limitationsNotes: "Left shoulder to watch",
    bodyWeightKg: 82,
  });

  // Preferences reach the coach context.
  const context = await buildInitialTrainingContext(user.id);
  assert.equal(context!.profile.experienceLevel, "returning");
  assert.equal(context!.profile.limitationsNotes, "Left shoulder to watch");

  const proposal = await createInitialProposal(user.id);
  f.proposalId = proposal.id;
  assert.equal(proposal.proposalType, "initial_week");
  assert.equal(proposal.proposal.sourceWeekId, null);
  assert.equal(proposal.proposal.proposedWeekNumber, 1);

  // Returning + 6 days → conservative: 3 resistance days, with a downgrade note.
  const resistanceDays = proposal.proposal.days.filter((d) => d.exercises.length > 0);
  assert.equal(resistanceDays.length, 3);
  assert.match(proposal.proposal.summary.overallRecommendation, /ease back in/);

  // Creating a proposal must NOT create an active plan.
  const before = await db.select().from(workoutPlans).where(eq(workoutPlans.userId, user.id));
  assert.equal(before.length, 0);

  const first = await applyProposal(user.id, proposal.id, { confirmation: "approve" });
  f.planId = first.planId;
  const second = await applyProposal(user.id, proposal.id, { confirmation: "approve" });
  assert.equal(second.planId, first.planId, "applying must be idempotent");

  const plans = await db.select().from(workoutPlans).where(eq(workoutPlans.userId, user.id));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].weekNumber, 1);
  assert.equal(plans[0].status, "active");
});

test("onboarding: another user's profile and proposal are isolated", async () => {
  const stamp = Date.now();
  const [userB] = await db.insert(users).values({ name: "Onboarding B", username: `onboard-b-${stamp}`, usernameNormalized: `onboard-b-${stamp}` }).returning();
  try {
    await upsertTrainingProfile(userB.id, {
      primaryGoal: "general_fitness",
      secondaryGoals: null,
      experienceLevel: "beginner",
      yearsSinceTraining: null,
      desiredDaysPerWeek: 2,
      preferredDays: [],
      sessionMinutes: "30",
      trainingEnvironment: "home",
      equipmentNotes: null,
      limitationsNotes: null,
      bodyWeightKg: null,
    });

    // User B has no initial proposal and no plan (independent of user A).
    const draft = await getDraftInitialProposal(userB.id);
    assert.equal(draft, null);
    const plansB = await db.select().from(workoutPlans).where(eq(workoutPlans.userId, userB.id));
    assert.equal(plansB.length, 0);
  } finally {
    await deleteUser(userB.id);
  }
});
