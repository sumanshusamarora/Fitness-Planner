import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  equipmentTypes,
  exerciseEquipmentTypes,
  exerciseExternalMappings,
  exerciseMuscles,
  exerciseRelationships,
  exercises,
  muscles,
  userEquipmentAvailabilitySignals,
  userExerciseProfiles,
  userGymEquipment,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { canonicalEquipmentGroup } from "@/lib/external-exercises/normalize";
import { getMappedExternalExercise } from "@/lib/external-exercises/queries";
import {
  DEFAULT_EQUIPMENT_TYPES,
  type EquipmentAvailability,
  type EquipmentSignalSource,
  type ExerciseAnchorState,
  type ExercisePreference,
  type ExerciseRelationshipType,
  normalizeCode,
} from "./taxonomy";

export interface ExerciseMuscleRole {
  code: string;
  name: string;
  role: "primary" | "secondary";
}

export interface ExerciseEquipmentCompatibility {
  equipmentTypeId: number;
  code: string;
  name: string;
  requirement: "required" | "supported";
}

export interface UserGymAvailability {
  equipmentTypeCode: string;
  availability: EquipmentAvailability;
  source: "explicit" | "inferred" | "unknown";
  explicitUpdatedAt: Date | null;
  inferredUpdatedAt: Date | null;
  signals: {
    inferredAvailable: number;
    inferredUnavailable: number;
    inferredUnknown: number;
  };
}

export interface UserExerciseSignals {
  userId: number;
  exerciseId: number;
  usedBefore: boolean;
  successfulExposures: number;
  replacementFrequency: number;
  equipmentBusyFrequency: number;
  painDiscomfortFrequency: number;
  preference: ExercisePreference | null;
  anchorState: ExerciseAnchorState | null;
  knownAvailable: boolean;
  knownUnavailable: boolean;
}

export interface ExerciseRelationshipEdge {
  fromExerciseId: number;
  toExerciseId: number;
  relationshipType: ExerciseRelationshipType;
  direction: "outgoing" | "incoming";
  otherExerciseName: string;
}

export interface ExerciseKnowledge {
  exercise: {
    id: number;
    name: string;
    measurementType: string | null;
    dimensions: {
      modality: string | null;
      movementPattern: string | null;
      mechanics: string | null;
      laterality: string | null;
      stability: string | null;
      skillDemand: string | null;
      progressionSuitability: string | null;
    };
  };
  muscles: ExerciseMuscleRole[];
  compatibleEquipment: ExerciseEquipmentCompatibility[];
  relationships: ExerciseRelationshipEdge[];
  userSignals: UserExerciseSignals | null;
  externalReference: {
    provider: string;
    externalId: string;
    name: string;
    sourceUrl: string | null;
  } | null;
}

function titleCaseFromCode(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function legacyEquipmentCodes(exerciseName: string, legacyEquipment: string): string[] {
  const name = normalizeCode(exerciseName);
  const equipment = normalizeCode(legacyEquipment);
  if (name.includes("treadmill")) return ["treadmill"];
  if (name.includes("bike")) return ["exercise_bike"];
  if (name.includes("chest_press")) return ["chest_press_machine", "machine"];
  if (name.includes("leg_press")) return ["leg_press_machine", "machine"];
  if (name.includes("lat_pulldown")) return ["lat_pulldown_machine", "machine"];
  if (name.includes("row") && equipment === "cable") return ["seated_row_machine", "cable_station"];

  if (equipment === "machine") return ["machine"];
  if (equipment === "cable") return ["cable_station"];
  if (equipment === "dumbbell") return ["dumbbells"];
  if (equipment === "barbell") return ["barbell"];
  if (equipment === "bodyweight") return ["bodyweight"];
  return [equipment || "other"];
}

function toExternalEquipmentCode(value: string): string {
  const group = canonicalEquipmentGroup(value);
  if (group === "machine") return "machine";
  if (group === "cable") return "cable_station";
  if (group === "dumbbell") return "dumbbells";
  if (group === "barbell") return "barbell";
  if (group === "bodyweight") return "bodyweight";
  if (group === "cardio") return "treadmill";
  return normalizeCode(value);
}

async function ensureEquipmentType(code: string, name?: string): Promise<typeof equipmentTypes.$inferSelect> {
  const normalizedCode = normalizeCode(code);
  const defaultName =
    DEFAULT_EQUIPMENT_TYPES.find((entry) => entry.code === normalizedCode)?.name ??
    name ??
    titleCaseFromCode(normalizedCode);

  await db
    .insert(equipmentTypes)
    .values({ code: normalizedCode, name: defaultName })
    .onConflictDoNothing({ target: equipmentTypes.code });

  const row = (
    await db
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.code, normalizedCode))
      .limit(1)
  )[0];
  return row;
}

async function insertAvailabilitySignal(input: {
  userId: number;
  equipmentTypeId: number;
  availability: EquipmentAvailability;
  source: EquipmentSignalSource;
  exerciseId?: number;
  workoutSessionId?: number;
  notes?: string;
}) {
  const recent = (
    await db
      .select({ id: userEquipmentAvailabilitySignals.id })
      .from(userEquipmentAvailabilitySignals)
      .where(
        and(
          eq(userEquipmentAvailabilitySignals.userId, input.userId),
          eq(userEquipmentAvailabilitySignals.equipmentTypeId, input.equipmentTypeId),
          eq(userEquipmentAvailabilitySignals.source, input.source),
          eq(userEquipmentAvailabilitySignals.availability, input.availability),
          input.workoutSessionId == null
            ? sql`true`
            : eq(userEquipmentAvailabilitySignals.workoutSessionId, input.workoutSessionId),
        ),
      )
      .orderBy(desc(userEquipmentAvailabilitySignals.createdAt))
      .limit(1)
  )[0];

  if (recent) return;

  await db.insert(userEquipmentAvailabilitySignals).values({
    userId: input.userId,
    equipmentTypeId: input.equipmentTypeId,
    availability: input.availability,
    source: input.source,
    exerciseId: input.exerciseId ?? null,
    workoutSessionId: input.workoutSessionId ?? null,
    notes: input.notes ?? null,
  });
}

export async function getExerciseMuscles(exerciseId: number): Promise<ExerciseMuscleRole[]> {
  const rows = await db
    .select({
      code: muscles.code,
      name: muscles.name,
      role: exerciseMuscles.role,
    })
    .from(exerciseMuscles)
    .innerJoin(muscles, eq(exerciseMuscles.muscleId, muscles.id))
    .where(eq(exerciseMuscles.exerciseId, exerciseId));

  if (rows.length > 0) {
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      role: row.role as "primary" | "secondary",
    }));
  }

  const exercise = (
    await db
      .select({ primaryMuscle: exercises.primaryMuscle })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1)
  )[0];

  if (!exercise) return [];

  return [
    {
      code: normalizeCode(exercise.primaryMuscle),
      name: exercise.primaryMuscle,
      role: "primary",
    },
  ];
}

export async function getCompatibleEquipment(
  exerciseId: number,
): Promise<ExerciseEquipmentCompatibility[]> {
  const rows = await db
    .select({
      equipmentTypeId: equipmentTypes.id,
      code: equipmentTypes.code,
      name: equipmentTypes.name,
      requirement: exerciseEquipmentTypes.requirement,
    })
    .from(exerciseEquipmentTypes)
    .innerJoin(equipmentTypes, eq(exerciseEquipmentTypes.equipmentTypeId, equipmentTypes.id))
    .where(eq(exerciseEquipmentTypes.exerciseId, exerciseId));

  if (rows.length > 0) {
    return rows.map((row) => ({
      equipmentTypeId: row.equipmentTypeId,
      code: row.code,
      name: row.name,
      requirement: row.requirement as "required" | "supported",
    }));
  }

  const exercise = (
    await db
      .select({ name: exercises.name, equipment: exercises.equipment })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1)
  )[0];

  if (!exercise) return [];

  const codes = legacyEquipmentCodes(exercise.name, exercise.equipment);
  const result: ExerciseEquipmentCompatibility[] = [];
  for (const code of codes) {
    const type = await ensureEquipmentType(code);
    result.push({
      equipmentTypeId: type.id,
      code: type.code,
      name: type.name,
      requirement: "supported",
    });
  }
  return result;
}

export async function getUserGymAvailability(
  userId: number,
  equipmentTypeCode: string,
): Promise<UserGymAvailability> {
  const type = await ensureEquipmentType(equipmentTypeCode);

  const explicitSignal = (
    await db
      .select({
        availability: userEquipmentAvailabilitySignals.availability,
        createdAt: userEquipmentAvailabilitySignals.createdAt,
      })
      .from(userEquipmentAvailabilitySignals)
      .where(
        and(
          eq(userEquipmentAvailabilitySignals.userId, userId),
          eq(userEquipmentAvailabilitySignals.equipmentTypeId, type.id),
          eq(userEquipmentAvailabilitySignals.source, "explicit"),
        ),
      )
      .orderBy(desc(userEquipmentAvailabilitySignals.createdAt))
      .limit(1)
  )[0];

  const explicitInstance = (
    await db
      .select({
        knownAvailability: userGymEquipment.knownAvailability,
        updatedAt: userGymEquipment.updatedAt,
      })
      .from(userGymEquipment)
      .where(
        and(
          eq(userGymEquipment.userId, userId),
          eq(userGymEquipment.equipmentTypeId, type.id),
        ),
      )
      .orderBy(desc(userGymEquipment.updatedAt))
      .limit(1)
  )[0];

  const inferredLatest = (
    await db
      .select({
        availability: userEquipmentAvailabilitySignals.availability,
        createdAt: userEquipmentAvailabilitySignals.createdAt,
      })
      .from(userEquipmentAvailabilitySignals)
      .where(
        and(
          eq(userEquipmentAvailabilitySignals.userId, userId),
          eq(userEquipmentAvailabilitySignals.equipmentTypeId, type.id),
          sql`${userEquipmentAvailabilitySignals.source} <> 'explicit'`,
        ),
      )
      .orderBy(desc(userEquipmentAvailabilitySignals.createdAt))
      .limit(1)
  )[0];

  const inferredCounts = await db
    .select({ availability: userEquipmentAvailabilitySignals.availability, c: count() })
    .from(userEquipmentAvailabilitySignals)
    .where(
      and(
        eq(userEquipmentAvailabilitySignals.userId, userId),
        eq(userEquipmentAvailabilitySignals.equipmentTypeId, type.id),
        sql`${userEquipmentAvailabilitySignals.source} <> 'explicit'`,
      ),
    )
    .groupBy(userEquipmentAvailabilitySignals.availability);

  const inferred = {
    inferredAvailable: inferredCounts.find((row) => row.availability === "available")?.c ?? 0,
    inferredUnavailable: inferredCounts.find((row) => row.availability === "unavailable")?.c ?? 0,
    inferredUnknown: inferredCounts.find((row) => row.availability === "unknown")?.c ?? 0,
  };

  if (explicitSignal) {
    return {
      equipmentTypeCode: type.code,
      availability: explicitSignal.availability as EquipmentAvailability,
      source: "explicit",
      explicitUpdatedAt: explicitSignal.createdAt,
      inferredUpdatedAt: inferredLatest?.createdAt ?? null,
      signals: inferred,
    };
  }

  if (explicitInstance && explicitInstance.knownAvailability !== "unknown") {
    return {
      equipmentTypeCode: type.code,
      availability: explicitInstance.knownAvailability as EquipmentAvailability,
      source: "explicit",
      explicitUpdatedAt: explicitInstance.updatedAt,
      inferredUpdatedAt: inferredLatest?.createdAt ?? null,
      signals: inferred,
    };
  }

  if (inferredLatest) {
    return {
      equipmentTypeCode: type.code,
      availability: inferredLatest.availability as EquipmentAvailability,
      source: "inferred",
      explicitUpdatedAt: null,
      inferredUpdatedAt: inferredLatest.createdAt,
      signals: inferred,
    };
  }

  return {
    equipmentTypeCode: type.code,
    availability: "unknown",
    source: "unknown",
    explicitUpdatedAt: null,
    inferredUpdatedAt: null,
    signals: inferred,
  };
}

export async function getExerciseRelationships(
  exerciseId: number,
): Promise<ExerciseRelationshipEdge[]> {
  const outgoing = await db
    .select({
      fromExerciseId: exerciseRelationships.fromExerciseId,
      toExerciseId: exerciseRelationships.toExerciseId,
      relationshipType: exerciseRelationships.relationshipType,
      otherName: exercises.name,
    })
    .from(exerciseRelationships)
    .innerJoin(exercises, eq(exerciseRelationships.toExerciseId, exercises.id))
    .where(eq(exerciseRelationships.fromExerciseId, exerciseId));

  const incoming = await db
    .select({
      fromExerciseId: exerciseRelationships.fromExerciseId,
      toExerciseId: exerciseRelationships.toExerciseId,
      relationshipType: exerciseRelationships.relationshipType,
      otherName: exercises.name,
    })
    .from(exerciseRelationships)
    .innerJoin(exercises, eq(exerciseRelationships.fromExerciseId, exercises.id))
    .where(eq(exerciseRelationships.toExerciseId, exerciseId));

  return [
    ...outgoing.map((row) => ({
      fromExerciseId: row.fromExerciseId,
      toExerciseId: row.toExerciseId,
      relationshipType: row.relationshipType as ExerciseRelationshipType,
      direction: "outgoing" as const,
      otherExerciseName: row.otherName,
    })),
    ...incoming.map((row) => ({
      fromExerciseId: row.fromExerciseId,
      toExerciseId: row.toExerciseId,
      relationshipType: row.relationshipType as ExerciseRelationshipType,
      direction: "incoming" as const,
      otherExerciseName: row.otherName,
    })),
  ];
}

export async function getUserExerciseSignals(
  userId: number,
  exerciseId: number,
): Promise<UserExerciseSignals> {
  const exposureRows = await db
    .select({ id: workoutSessionExercises.id, status: workoutSessionExercises.status })
    .from(workoutSessionExercises)
    .innerJoin(workoutSessions, eq(workoutSessionExercises.workoutSessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessionExercises.exerciseId, exerciseId),
      ),
    );

  const successfulExposures = exposureRows.length
    ? (
        await db
          .select({ c: count(sql`distinct ${workoutSessionExercises.workoutSessionId}`) })
          .from(workoutSets)
          .innerJoin(
            workoutSessionExercises,
            eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
          )
          .innerJoin(workoutSessions, eq(workoutSessionExercises.workoutSessionId, workoutSessions.id))
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessionExercises.exerciseId, exerciseId),
              eq(workoutSets.setType, "working"),
            ),
          )
      )[0]?.c ?? 0
    : 0;

  const replacedOriginals = exposureRows
    .filter((row) => row.status === "replaced")
    .map((row) => row.id);

  const replacementRows = replacedOriginals.length
    ? await db
        .select({
          replacementReason: workoutSessionExercises.replacementReason,
        })
        .from(workoutSessionExercises)
        .where(inArray(workoutSessionExercises.replacesSessionExerciseId, replacedOriginals))
    : [];

  const equipmentBusyFrequency = replacementRows.filter(
    (row) => row.replacementReason === "equipment_busy",
  ).length;
  const painDiscomfortFrequency = replacementRows.filter(
    (row) => row.replacementReason === "pain_discomfort",
  ).length;

  const profile = (
    await db
      .select({ preference: userExerciseProfiles.preference, anchorState: userExerciseProfiles.anchorState })
      .from(userExerciseProfiles)
      .where(
        and(
          eq(userExerciseProfiles.userId, userId),
          eq(userExerciseProfiles.exerciseId, exerciseId),
        ),
      )
      .limit(1)
  )[0];

  const compat = await getCompatibleEquipment(exerciseId);
  let knownAvailable = false;
  let knownUnavailable = false;
  for (const equipment of compat) {
    const availability = await getUserGymAvailability(userId, equipment.code);
    if (availability.availability === "available") knownAvailable = true;
    if (availability.availability === "unavailable") knownUnavailable = true;
  }

  return {
    userId,
    exerciseId,
    usedBefore: exposureRows.length > 0,
    successfulExposures,
    replacementFrequency: replacedOriginals.length,
    equipmentBusyFrequency,
    painDiscomfortFrequency,
    preference: (profile?.preference as ExercisePreference | null) ?? null,
    anchorState: (profile?.anchorState as ExerciseAnchorState | null) ?? null,
    knownAvailable,
    knownUnavailable,
  };
}

export async function getExerciseKnowledge(
  exerciseId: number,
  userId?: number,
): Promise<ExerciseKnowledge | null> {
  const exercise = (
    await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1)
  )[0];
  if (!exercise) return null;

  const mappedExternal = await getMappedExternalExercise(exerciseId);

  let musclesData = await getExerciseMuscles(exerciseId);
  if (musclesData.length === 0 && mappedExternal) {
    musclesData = [
      ...mappedExternal.primaryMuscles.map((name) => ({
        code: normalizeCode(name),
        name,
        role: "primary" as const,
      })),
      ...mappedExternal.secondaryMuscles.map((name) => ({
        code: normalizeCode(name),
        name,
        role: "secondary" as const,
      })),
    ];
  }

  let compatibleEquipment = await getCompatibleEquipment(exerciseId);
  if (compatibleEquipment.length === 0 && mappedExternal) {
    const codes = [...new Set(mappedExternal.equipment.map(toExternalEquipmentCode))];
    compatibleEquipment = [];
    for (const code of codes) {
      const type = await ensureEquipmentType(code);
      compatibleEquipment.push({
        equipmentTypeId: type.id,
        code: type.code,
        name: type.name,
        requirement: "supported",
      });
    }
  }

  return {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      measurementType: exercise.measurementType,
      dimensions: {
        modality: exercise.modality,
        movementPattern: exercise.movementPattern,
        mechanics: exercise.mechanics,
        laterality: exercise.laterality,
        stability: exercise.stability,
        skillDemand: exercise.skillDemand,
        progressionSuitability: exercise.progressionSuitability,
      },
    },
    muscles: musclesData,
    compatibleEquipment,
    relationships: await getExerciseRelationships(exerciseId),
    userSignals: userId == null ? null : await getUserExerciseSignals(userId, exerciseId),
    externalReference: mappedExternal
      ? {
          provider: mappedExternal.provider,
          externalId: mappedExternal.externalId,
          name: mappedExternal.name,
          sourceUrl: mappedExternal.sourceUrl,
        }
      : null,
  };
}

export async function setUserExercisePreference(
  userId: number,
  exerciseId: number,
  preference: ExercisePreference | null,
) {
  await db
    .insert(userExerciseProfiles)
    .values({ userId, exerciseId, preference, anchorState: "none" })
    .onConflictDoUpdate({
      target: [userExerciseProfiles.userId, userExerciseProfiles.exerciseId],
      set: { preference, updatedAt: new Date() },
    });
}

export async function setUserExerciseEquipmentAvailability(
  userId: number,
  exerciseId: number,
  availability: EquipmentAvailability,
  notes?: string,
) {
  const compat = await getCompatibleEquipment(exerciseId);
  for (const equipment of compat) {
    await insertAvailabilitySignal({
      userId,
      equipmentTypeId: equipment.equipmentTypeId,
      availability,
      source: "explicit",
      exerciseId,
      notes,
    });
  }
}

export async function recordInferredAvailabilityFromExerciseUse(
  userId: number,
  exerciseId: number,
  workoutSessionId?: number,
) {
  const compat = await getCompatibleEquipment(exerciseId);
  for (const equipment of compat) {
    await insertAvailabilitySignal({
      userId,
      equipmentTypeId: equipment.equipmentTypeId,
      availability: "available",
      source: "inferred_performed",
      exerciseId,
      workoutSessionId,
    });
  }
}

export async function recordInferredAvailabilityFromReplacement(
  userId: number,
  exerciseId: number,
  reason: string,
  workoutSessionId?: number,
) {
  const compat = await getCompatibleEquipment(exerciseId);
  const source: EquipmentSignalSource | null =
    reason === "equipment_busy"
      ? "inferred_busy"
      : reason === "equipment_unavailable"
        ? "inferred_unavailable"
        : null;

  if (!source) return;

  const availability: EquipmentAvailability =
    source === "inferred_unavailable" ? "unavailable" : "available";

  for (const equipment of compat) {
    await insertAvailabilitySignal({
      userId,
      equipmentTypeId: equipment.equipmentTypeId,
      availability,
      source,
      exerciseId,
      workoutSessionId,
      notes: reason === "equipment_busy" ? "busy" : undefined,
    });
  }
}

export async function setExerciseAnchorState(
  userId: number,
  exerciseId: number,
  anchorState: ExerciseAnchorState,
) {
  await db
    .insert(userExerciseProfiles)
    .values({ userId, exerciseId, preference: null, anchorState })
    .onConflictDoUpdate({
      target: [userExerciseProfiles.userId, userExerciseProfiles.exerciseId],
      set: { anchorState, updatedAt: new Date() },
    });
}

export async function ensureDefaultEquipmentTypes() {
  for (const item of DEFAULT_EQUIPMENT_TYPES) {
    await ensureEquipmentType(item.code, item.name);
  }
}
