export const EXERCISE_MODALITIES = [
  "strength",
  "cardio",
  "mobility",
  "stretching",
  "conditioning",
  "other",
] as const;

export type ExerciseModality = (typeof EXERCISE_MODALITIES)[number];

export const EXERCISE_MOVEMENT_PATTERNS = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "carry",
  "rotation",
  "anti_rotation",
  "gait",
  "isolation",
  "other",
] as const;

export type ExerciseMovementPattern = (typeof EXERCISE_MOVEMENT_PATTERNS)[number];

export const EXERCISE_MECHANICS = ["compound", "isolation"] as const;
export type ExerciseMechanics = (typeof EXERCISE_MECHANICS)[number];

export const EXERCISE_LATERALITY = ["bilateral", "unilateral", "alternating"] as const;
export type ExerciseLaterality = (typeof EXERCISE_LATERALITY)[number];

export const EXERCISE_STABILITY = ["low", "medium", "high"] as const;
export type ExerciseStability = (typeof EXERCISE_STABILITY)[number];

export const EXERCISE_SKILL_DEMAND = ["low", "medium", "high"] as const;
export type ExerciseSkillDemand = (typeof EXERCISE_SKILL_DEMAND)[number];

export const EXERCISE_PROGRESSION_SUITABILITY = ["low", "medium", "high"] as const;
export type ExerciseProgressionSuitability =
  (typeof EXERCISE_PROGRESSION_SUITABILITY)[number];

export const MUSCLE_ROLES = ["primary", "secondary"] as const;
export type MuscleRole = (typeof MUSCLE_ROLES)[number];

export const EQUIPMENT_REQUIREMENT_TYPES = ["required", "supported"] as const;
export type EquipmentRequirementType = (typeof EQUIPMENT_REQUIREMENT_TYPES)[number];

export const EQUIPMENT_AVAILABILITY = ["available", "unavailable", "unknown"] as const;
export type EquipmentAvailability = (typeof EQUIPMENT_AVAILABILITY)[number];

export const EXERCISE_RELATIONSHIP_TYPES = [
  "very_similar",
  "substitute",
  "related",
] as const;
export type ExerciseRelationshipType = (typeof EXERCISE_RELATIONSHIP_TYPES)[number];

export const EXERCISE_PREFERENCE = ["preferred", "dont_prefer"] as const;
export type ExercisePreference = (typeof EXERCISE_PREFERENCE)[number];

export const EXERCISE_ANCHOR_STATES = ["none", "candidate", "current"] as const;
export type ExerciseAnchorState = (typeof EXERCISE_ANCHOR_STATES)[number];

export const EQUIPMENT_SIGNAL_SOURCES = [
  "explicit",
  "inferred_performed",
  "inferred_busy",
  "inferred_unavailable",
] as const;
export type EquipmentSignalSource = (typeof EQUIPMENT_SIGNAL_SOURCES)[number];

export const DEFAULT_EQUIPMENT_TYPES: { code: string; name: string }[] = [
  { code: "machine", name: "Machine" },
  { code: "chest_press_machine", name: "Chest Press Machine" },
  { code: "cable_station", name: "Cable Station" },
  { code: "dumbbells", name: "Dumbbells" },
  { code: "barbell", name: "Barbell" },
  { code: "smith_machine", name: "Smith Machine" },
  { code: "leg_press_machine", name: "Leg Press Machine" },
  { code: "lat_pulldown_machine", name: "Lat Pulldown Machine" },
  { code: "seated_row_machine", name: "Seated Row Machine" },
  { code: "bodyweight", name: "Bodyweight" },
  { code: "band", name: "Resistance Band" },
  { code: "kettlebell", name: "Kettlebell" },
  { code: "treadmill", name: "Treadmill" },
  { code: "exercise_bike", name: "Exercise Bike" },
  { code: "other", name: "Other" },
];

export function isEquipmentAvailability(value: unknown): value is EquipmentAvailability {
  return typeof value === "string" && (EQUIPMENT_AVAILABILITY as readonly string[]).includes(value);
}

export function normalizeCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "other";
}
