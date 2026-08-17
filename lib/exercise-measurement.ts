/**
 * Exercise measurement semantics.
 *
 * Not every exercise requires weight. Each canonical exercise exposes a
 * measurement/prescription type that drives the set logger, completion
 * validation, and analytics. Legacy exercises without an explicit
 * `measurementType` are classified deterministically from canonical metadata
 * with a safe fallback.
 */

export type MeasurementType =
  | "weighted_reps"
  | "bodyweight_reps"
  | "timed_hold"
  | "duration"
  | "distance_duration";

export const MEASUREMENT_TYPES: MeasurementType[] = [
  "weighted_reps",
  "bodyweight_reps",
  "timed_hold",
  "duration",
  "distance_duration",
];

export function isMeasurementType(value: unknown): value is MeasurementType {
  return typeof value === "string" && (MEASUREMENT_TYPES as string[]).includes(value);
}

export interface MeasurementInput {
  measurementType: string | null;
  category: string | null;
  equipment: string | null;
  name: string | null;
}

/**
 * Deterministic classifier for legacy exercises (and a fallback when an
 * explicit measurementType is missing or unrecognised).
 */
export function classifyMeasurementType(input: MeasurementInput): MeasurementType {
  if (input.measurementType && isMeasurementType(input.measurementType)) {
    return input.measurementType;
  }
  const category = input.category?.toLowerCase() ?? "";
  const equipment = input.equipment?.toLowerCase() ?? "";
  const name = input.name?.toLowerCase() ?? "";

  if (category === "cardio" || equipment === "treadmill" || equipment === "bike" || name.includes("treadmill") || name.includes("bike") || name.includes("row")) {
    return "distance_duration";
  }
  if (category === "mobility" || category === "stretching") return "duration";
  if (equipment === "bodyweight" || equipment === "" || equipment === "none") {
    if (name.includes("plank") || name.includes("hold") || name.includes("dead hang")) {
      return "timed_hold";
    }
    return "bodyweight_reps";
  }
  return "weighted_reps";
}

export function measurementTypeFor(input: MeasurementInput): MeasurementType {
  return classifyMeasurementType(input);
}

/** Weighted (external-load) movements are the only ones eligible for e1RM. */
export function isWeightedMeasurement(type: MeasurementType): boolean {
  return type === "weighted_reps";
}

/** Movements where external weight is not required to complete a set. */
export function requiresWeight(type: MeasurementType): boolean {
  return type === "weighted_reps";
}

/** Movements measured in seconds (stored in the reps field for simplicity). */
export function usesSeconds(type: MeasurementType): boolean {
  return type === "timed_hold";
}
