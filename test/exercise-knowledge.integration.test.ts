import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  equipmentTypes,
  exerciseEquipmentTypes,
  exerciseExternalMappings,
  exerciseMuscles,
  exerciseRelationships,
  exercises,
  externalExercises,
  muscles,
  planAdjustmentProposals,
  planRevisions,
  recoveryLogs,
  userEquipmentAvailabilitySignals,
  userExerciseProfiles,
  userGymEquipment,
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
import {
  getCompatibleEquipment,
  getExerciseKnowledge,
  getExerciseRelationships,
  getUserExerciseSignals,
  getUserGymAvailability,
  setUserExerciseEquipmentAvailability,
  setUserExercisePreference,
} from "@/lib/exercise-knowledge";
import { createSession } from "@/lib/workouts";
import { logSessionSet, replaceSessionExercise } from "@/lib/session-activities";
import { approveMapping, DEFAULT_PROVIDER } from "@/lib/external-exercises";

const stamp = Date.now();
const createdUserIds = new Set<number>();
const createdExerciseIds = new Set<number>();
const createdMuscleIds = new Set<number>();
const createdEquipmentTypeIds = new Set<number>();
const createdExternalExerciseIds = new Set<number>();

async function deleteUserData(userId: number) {
  if (!userId) return;
  await db.delete(userEquipmentAvailabilitySignals).where(eq(userEquipmentAvailabilitySignals.userId, userId));
  await db.delete(userExerciseProfiles).where(eq(userExerciseProfiles.userId, userId));
  await db.delete(userGymEquipment).where(eq(userGymEquipment.userId, userId));
  await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.userId, userId));
  await db.delete(planRevisions).where(eq(planRevisions.userId, userId));
  await db.delete(weekFeedback).where(eq(weekFeedback.userId, userId));
  await db.delete(recoveryLogs).where(eq(recoveryLogs.userId, userId));

  const ses = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sesIds = ses.map((s) => s.id);
  if (sesIds.length) {
    await db.delete(workoutSessionActivities).where(inArray(workoutSessionActivities.workoutSessionId, sesIds));
    const sses = await db
      .select({ id: workoutSessionExercises.id })
      .from(workoutSessionExercises)
      .where(inArray(workoutSessionExercises.workoutSessionId, sesIds));
    if (sses.length) {
      await db.delete(workoutSets).where(inArray(workoutSets.workoutSessionExerciseId, sses.map((s) => s.id)));
    }
    await db.delete(workoutSessionExercises).where(inArray(workoutSessionExercises.workoutSessionId, sesIds));
    await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  }

  const plans = await db.select({ id: workoutPlans.id }).from(workoutPlans).where(eq(workoutPlans.userId, userId));
  const planIds = plans.map((p) => p.id);
  if (planIds.length) {
    const days = await db
      .select({ id: workoutPlanDays.id })
      .from(workoutPlanDays)
      .where(inArray(workoutPlanDays.workoutPlanId, planIds));
    if (days.length) {
      await db
        .delete(workoutPlanExercises)
        .where(inArray(workoutPlanExercises.workoutPlanDayId, days.map((d) => d.id)));
    }
    await db.delete(workoutPlanDays).where(inArray(workoutPlanDays.workoutPlanId, planIds));
    await db.delete(workoutPlans).where(eq(workoutPlans.userId, userId));
  }

  await db.delete(users).where(eq(users.id, userId));
}

after(async () => {
  for (const userId of createdUserIds) {
    await deleteUserData(userId);
  }

  if (createdExerciseIds.size > 0) {
    const ids = [...createdExerciseIds];
    await db.delete(exerciseRelationships).where(inArray(exerciseRelationships.fromExerciseId, ids));
    await db.delete(exerciseRelationships).where(inArray(exerciseRelationships.toExerciseId, ids));
    await db.delete(exerciseEquipmentTypes).where(inArray(exerciseEquipmentTypes.exerciseId, ids));
    await db.delete(exerciseMuscles).where(inArray(exerciseMuscles.exerciseId, ids));
    await db.delete(exerciseExternalMappings).where(inArray(exerciseExternalMappings.exerciseId, ids));
    await db.delete(exercises).where(inArray(exercises.id, ids));
  }

  if (createdExternalExerciseIds.size > 0) {
    const ids = [...createdExternalExerciseIds];
    await db.delete(exerciseExternalMappings).where(inArray(exerciseExternalMappings.externalExerciseId, ids));
    await db.delete(externalExercises).where(inArray(externalExercises.id, ids));
  }

  if (createdMuscleIds.size > 0) {
    await db.delete(muscles).where(inArray(muscles.id, [...createdMuscleIds]));
  }

  if (createdEquipmentTypeIds.size > 0) {
    const ids = [...createdEquipmentTypeIds];
    await db.delete(userEquipmentAvailabilitySignals).where(inArray(userEquipmentAvailabilitySignals.equipmentTypeId, ids));
    await db.delete(userGymEquipment).where(inArray(userGymEquipment.equipmentTypeId, ids));
    await db.delete(exerciseEquipmentTypes).where(inArray(exerciseEquipmentTypes.equipmentTypeId, ids));
    await db.delete(equipmentTypes).where(inArray(equipmentTypes.id, ids));
  }
});

async function createUser(name: string) {
  const normalized = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}-${Math.floor(Math.random() * 10000)}`;
  const [user] = await db
    .insert(users)
    .values({ name, username: normalized, usernameNormalized: normalized })
    .returning();
  createdUserIds.add(user.id);
  return user;
}

test("Phase 4A: canonical exercise dimensions and many-to-many muscles/equipment", async () => {
  const [exercise] = await db
    .insert(exercises)
    .values({
      name: `P4A Machine Chest Press ${stamp}`,
      category: "strength",
      primaryMuscle: "Chest",
      equipment: "Machine",
      measurementType: "weighted_reps",
      modality: "strength",
      movementPattern: "horizontal_push",
      mechanics: "compound",
      laterality: "bilateral",
      stability: "high",
      skillDemand: "medium",
      progressionSuitability: "high",
    })
    .returning();
  createdExerciseIds.add(exercise.id);

  const [pec] = await db
    .insert(muscles)
    .values({ code: `pectoralis_major_${stamp}`, name: "Pectoralis Major" })
    .returning();
  const [tri] = await db
    .insert(muscles)
    .values({ code: `triceps_${stamp}`, name: "Triceps" })
    .returning();
  const [deltoid] = await db
    .insert(muscles)
    .values({ code: `anterior_deltoid_${stamp}`, name: "Anterior Deltoid" })
    .returning();
  createdMuscleIds.add(pec.id);
  createdMuscleIds.add(tri.id);
  createdMuscleIds.add(deltoid.id);

  await db.insert(exerciseMuscles).values([
    { exerciseId: exercise.id, muscleId: pec.id, role: "primary" },
    { exerciseId: exercise.id, muscleId: tri.id, role: "secondary" },
    { exerciseId: exercise.id, muscleId: deltoid.id, role: "secondary" },
  ]);

  const [pressMachine] = await db
    .insert(equipmentTypes)
    .values({ code: `chest_press_machine_${stamp}`, name: "Chest Press Machine" })
    .returning();
  const [cable] = await db
    .insert(equipmentTypes)
    .values({ code: `cable_station_${stamp}`, name: "Cable Station" })
    .returning();
  createdEquipmentTypeIds.add(pressMachine.id);
  createdEquipmentTypeIds.add(cable.id);

  await db.insert(exerciseEquipmentTypes).values([
    { exerciseId: exercise.id, equipmentTypeId: pressMachine.id, requirement: "required" },
    { exerciseId: exercise.id, equipmentTypeId: cable.id, requirement: "supported" },
  ]);

  const knowledge = await getExerciseKnowledge(exercise.id);
  assert.ok(knowledge);
  assert.equal(knowledge!.exercise.dimensions.modality, "strength");
  assert.equal(knowledge!.exercise.dimensions.movementPattern, "horizontal_push");
  assert.equal(knowledge!.exercise.dimensions.mechanics, "compound");
  assert.equal(knowledge!.muscles.filter((m) => m.role === "primary").length, 1);
  assert.equal(knowledge!.muscles.filter((m) => m.role === "secondary").length, 2);
  assert.equal(knowledge!.compatibleEquipment.length, 2);
  assert.ok(knowledge!.compatibleEquipment.some((e) => e.requirement === "required"));
  assert.ok(knowledge!.compatibleEquipment.some((e) => e.requirement === "supported"));
});

test("Phase 4A: availability supports unknown and explicit override beats inference", async () => {
  const user = await createUser("P4A Availability");

  const [exercise] = await db
    .insert(exercises)
    .values({
      name: `P4A Availability Exercise ${stamp}`,
      category: "strength",
      primaryMuscle: "Chest",
      equipment: "Machine",
    })
    .returning();
  createdExerciseIds.add(exercise.id);

  const compat = await getCompatibleEquipment(exercise.id);
  assert.ok(compat.length >= 1);

  const initial = await getUserGymAvailability(user.id, compat[0].code);
  assert.equal(initial.availability, "unknown");

  await setUserExerciseEquipmentAvailability(user.id, exercise.id, "available");
  const available = await getUserGymAvailability(user.id, compat[0].code);
  assert.equal(available.availability, "available");
  assert.equal(available.source, "explicit");

  await db.insert(userEquipmentAvailabilitySignals).values({
    userId: user.id,
    equipmentTypeId: compat[0].equipmentTypeId,
    availability: "unavailable",
    source: "inferred_unavailable",
    exerciseId: exercise.id,
  });

  const stillExplicit = await getUserGymAvailability(user.id, compat[0].code);
  assert.equal(stillExplicit.availability, "available", "explicit signal must outrank inferred");

  await setUserExerciseEquipmentAvailability(user.id, exercise.id, "unknown");
  const unknown = await getUserGymAvailability(user.id, compat[0].code);
  assert.equal(unknown.availability, "unknown");
  assert.equal(unknown.source, "explicit");
});

test("Phase 4A: normal set logging infers compatible equipment availability", async () => {
  const user = await createUser("P4A Inference");
  const planId = (await createInitialWeek(user.id))!;

  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, 1)))
      .limit(1)
  )[0];

  const planExercise = (
    await db
      .select()
      .from(workoutPlanExercises)
      .where(eq(workoutPlanExercises.workoutPlanDayId, day.id))
      .limit(1)
  )[0];

  const session = await createSession(user.id, day.id);
  await logSessionSet(user.id, session.id, {
    exerciseId: planExercise.exerciseId,
    weightKg: 40,
    reps: 10,
    rpe: 7,
    setType: "working",
  });

  const compat = await getCompatibleEquipment(planExercise.exerciseId);
  assert.ok(compat.length >= 1);
  const availability = await getUserGymAvailability(user.id, compat[0].code);
  assert.equal(availability.availability, "available");
  assert.equal(availability.source, "inferred");
});

test("Phase 4A: replacement busy signal, machine-instance provenance, and non-equivalence groundwork", async () => {
  const user = await createUser("P4A Replacement");
  const planId = (await createInitialWeek(user.id))!;

  const day = (
    await db
      .select()
      .from(workoutPlanDays)
      .where(and(eq(workoutPlanDays.workoutPlanId, planId), eq(workoutPlanDays.dayNumber, 1)))
      .limit(1)
  )[0];

  const planExercises = await db
    .select()
    .from(workoutPlanExercises)
    .where(eq(workoutPlanExercises.workoutPlanDayId, day.id))
    .limit(2);

  const session = await createSession(user.id, day.id);
  const originalExerciseId = planExercises[0].exerciseId;
  const replacementExerciseId = planExercises[1].exerciseId;

  const replacement = await replaceSessionExercise(
    user.id,
    session.id,
    originalExerciseId,
    replacementExerciseId,
    "equipment_busy",
  );
  assert.equal(replacement.replacementReason, "equipment_busy");

  const signals = await getUserExerciseSignals(user.id, originalExerciseId);
  assert.ok(signals.equipmentBusyFrequency >= 1);

  const [machineType] = await db
    .insert(equipmentTypes)
    .values({ code: `machine_instance_test_${stamp}`, name: "Machine Instance Test" })
    .returning();
  createdEquipmentTypeIds.add(machineType.id);

  const [machineA] = await db
    .insert(userGymEquipment)
    .values({
      userId: user.id,
      equipmentTypeId: machineType.id,
      equipmentModel: "Matrix Ultra Chest Press",
      nickname: "Near Window",
      knownAvailability: "available",
    })
    .returning();
  const [machineB] = await db
    .insert(userGymEquipment)
    .values({
      userId: user.id,
      equipmentTypeId: machineType.id,
      equipmentModel: "Life Fitness Insignia Chest Press",
      nickname: "Far Corner",
      knownAvailability: "available",
    })
    .returning();

  const [exerciseForMachines] = await db
    .insert(exercises)
    .values({
      name: `P4A Machine Provenance ${stamp}`,
      category: "strength",
      primaryMuscle: "Chest",
      equipment: "Machine",
      measurementType: "weighted_reps",
    })
    .returning();
  createdExerciseIds.add(exerciseForMachines.id);

  const [sessionExerciseA] = await db
    .insert(workoutSessionExercises)
    .values({
      workoutSessionId: session.id,
      exerciseId: exerciseForMachines.id,
      position: 99,
      status: "pending",
      origin: "added",
      userGymEquipmentId: machineA.id,
    })
    .returning();
  const [sessionExerciseB] = await db
    .insert(workoutSessionExercises)
    .values({
      workoutSessionId: session.id,
      exerciseId: exerciseForMachines.id,
      position: 100,
      status: "pending",
      origin: "added",
      userGymEquipmentId: machineB.id,
    })
    .returning();

  await db.insert(workoutSets).values([
    { workoutSessionExerciseId: sessionExerciseA.id, setNumber: 1, weightKg: 50, reps: 10, rpe: 7, setType: "working" },
    { workoutSessionExerciseId: sessionExerciseB.id, setNumber: 1, weightKg: 50, reps: 10, rpe: 7, setType: "working" },
  ]);

  const provenanceRows = await db
    .select({ id: workoutSessionExercises.id, machineId: workoutSessionExercises.userGymEquipmentId })
    .from(workoutSessionExercises)
    .where(inArray(workoutSessionExercises.id, [sessionExerciseA.id, sessionExerciseB.id]));

  assert.equal(provenanceRows.length, 2);
  assert.notEqual(provenanceRows[0].machineId, provenanceRows[1].machineId);
});

test("Phase 4A: relationships are queryable, user signals are isolated, and external mappings remain additive", async () => {
  const userA = await createUser("P4A Signals A");
  const userB = await createUser("P4A Signals B");

  const [exerciseA] = await db
    .insert(exercises)
    .values({
      name: `P4A Relationship A ${stamp}`,
      category: "strength",
      primaryMuscle: "Chest",
      equipment: "Machine",
    })
    .returning();
  const [exerciseB] = await db
    .insert(exercises)
    .values({
      name: `P4A Relationship B ${stamp}`,
      category: "strength",
      primaryMuscle: "Chest",
      equipment: "Machine",
    })
    .returning();
  const [exerciseC] = await db
    .insert(exercises)
    .values({
      name: `P4A Relationship C ${stamp}`,
      category: "strength",
      primaryMuscle: "Chest",
      equipment: "Cable",
    })
    .returning();
  createdExerciseIds.add(exerciseA.id);
  createdExerciseIds.add(exerciseB.id);
  createdExerciseIds.add(exerciseC.id);

  await db.insert(exerciseRelationships).values([
    { fromExerciseId: exerciseA.id, toExerciseId: exerciseB.id, relationshipType: "very_similar" },
    { fromExerciseId: exerciseA.id, toExerciseId: exerciseC.id, relationshipType: "substitute" },
  ]);

  const edges = await getExerciseRelationships(exerciseA.id);
  assert.ok(edges.some((edge) => edge.relationshipType === "very_similar"));
  assert.ok(edges.some((edge) => edge.relationshipType === "substitute"));

  await setUserExercisePreference(userA.id, exerciseA.id, "preferred");
  const aSignals = await getUserExerciseSignals(userA.id, exerciseA.id);
  const bSignals = await getUserExerciseSignals(userB.id, exerciseA.id);
  assert.equal(aSignals.preference, "preferred");
  assert.equal(bSignals.preference, null);

  const [curatedMuscle] = await db
    .insert(muscles)
    .values({ code: `curated_chest_${stamp}`, name: "Curated Chest" })
    .returning();
  createdMuscleIds.add(curatedMuscle.id);
  await db.insert(exerciseMuscles).values({
    exerciseId: exerciseA.id,
    muscleId: curatedMuscle.id,
    role: "primary",
  });

  const [external] = await db
    .insert(externalExercises)
    .values({
      provider: DEFAULT_PROVIDER,
      externalId: `p4a-ext-${stamp}`,
      slug: `p4a-ext-${stamp}`,
      name: "External Press",
      sourceUrl: "https://example.com/external-press",
      primaryMuscles: ["Back"],
      secondaryMuscles: ["Biceps"],
      equipment: ["Cable"],
      difficulty: "Beginner",
      exerciseType: "Machine",
      instructionsSource: "<p>External instruction</p>",
      rawMetadata: { source: "test" },
      contentHash: `hash-${stamp}`,
    })
    .returning();
  createdExternalExerciseIds.add(external.id);

  await approveMapping(exerciseA.id, external.id, DEFAULT_PROVIDER);

  const knowledge = await getExerciseKnowledge(exerciseA.id, userA.id);
  assert.ok(knowledge?.externalReference, "external mapping should enrich knowledge");
  assert.ok(
    knowledge?.muscles.some((m) => m.name === "Curated Chest"),
    "curated canonical muscle should remain authoritative",
  );
});
