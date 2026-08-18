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
  | "assisted_reps"
  | "timed_hold"
  | "duration"
  | "distance_duration";

export const MEASUREMENT_TYPES: MeasurementType[] = [
  "weighted_reps",
  "bodyweight_reps",
  "assisted_reps",
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
  if (name.includes("assist") || equipment.includes("assist")) return "assisted_reps";
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

/** Movements where an explicit load value is required to complete a set. */
export function requiresLoadField(type: MeasurementType): boolean {
  return type === "weighted_reps" || type === "assisted_reps";
}

/** Backward-compatible alias retained for older tests/callers. */
export function requiresWeight(type: MeasurementType): boolean {
  return type === "weighted_reps";
}

/** Movements measured in seconds (stored in the reps field for simplicity). */
export function usesSeconds(type: MeasurementType): boolean {
  return type === "timed_hold" || type === "duration" || type === "distance_duration";
}

export interface LoggedSetShape {
  weightKg: number;
  reps: number;
  rpe: number | null;
}

export interface SetValidationResult {
  ok: boolean;
  error: string | null;
}

/**
 * Deterministic set validation by measurement type.
 *
 * The `reps` field carries seconds for time-based movements in this phase.
 */
export function validateLoggedSet(
  measurementType: MeasurementType,
  set: LoggedSetShape,
): SetValidationResult {
  if (!Number.isFinite(set.weightKg) || set.weightKg < 0) {
    return { ok: false, error: "Weight/assistance must be a non-negative number." };
  }
  if (!Number.isFinite(set.reps) || set.reps < 0) {
    return { ok: false, error: "Reps/seconds must be a non-negative number." };
  }
  if (
    set.rpe != null &&
    (!Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10)
  ) {
    return { ok: false, error: "RPE must be between 1 and 10." };
  }

  if (measurementType === "weighted_reps") {
    if (set.reps <= 0) return { ok: false, error: "Reps are required for weighted sets." };
    if (set.weightKg <= 0) return { ok: false, error: "Weight is required for weighted sets." };
    return { ok: true, error: null };
  }

  if (measurementType === "assisted_reps") {
    if (set.reps <= 0) return { ok: false, error: "Reps are required for assisted sets." };
    if (set.weightKg <= 0) return { ok: false, error: "Assistance is required for assisted sets." };
    return { ok: true, error: null };
  }

  if (measurementType === "bodyweight_reps") {
    if (set.reps <= 0) return { ok: false, error: "Reps are required for bodyweight sets." };
    return { ok: true, error: null };
  }

  if (measurementType === "timed_hold") {
    if (set.reps <= 0) return { ok: false, error: "Seconds are required for timed holds." };
    return { ok: true, error: null };
  }

  if (measurementType === "duration") {
    if (set.reps <= 0) return { ok: false, error: "Duration is required." };
    return { ok: true, error: null };
  }

  if (measurementType === "distance_duration") {
    if (set.reps <= 0) return { ok: false, error: "Duration is required for this activity." };
    return { ok: true, error: null };
  }

  return { ok: false, error: "Unsupported measurement type." };
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins} min ${rem} sec`;
}

function formatRange(minValue: number, maxValue: number, unit: string): string {
  if (minValue === maxValue) return `${minValue} ${unit}`;
  return `${minValue}-${maxValue} ${unit}`;
}

/** Human-readable actual set formatting shared by workout + history + coach. */
export function formatLoggedSetForDisplay(
  measurementType: MeasurementType,
  set: Pick<LoggedSetShape, "weightKg" | "reps" | "rpe">,
): string {
  let core = "";
  if (measurementType === "weighted_reps") {
    core = `${set.weightKg} kg x ${set.reps}`;
  } else if (measurementType === "assisted_reps") {
    core = `${set.weightKg} kg assistance x ${set.reps}`;
  } else if (measurementType === "bodyweight_reps") {
    core = `${set.reps} reps`;
  } else if (measurementType === "timed_hold") {
    core = formatSeconds(set.reps);
  } else {
    core = formatSeconds(set.reps);
  }
  return set.rpe != null ? `${core} @ RPE ${set.rpe}` : core;
}

/**
 * Measurement-aware prescription summary.
 *
 * Compatibility layer: in this phase, time targets continue to be stored in
 * `minReps/maxReps` and rendered as seconds/minutes for timed/duration types.
 */
export function formatPrescriptionTarget(input: {
  measurementType: MeasurementType;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
  suggestedWeightKg: number | null;
}): string {
  const sets = `${input.targetSets} set${input.targetSets === 1 ? "" : "s"}`;

  if (input.measurementType === "weighted_reps") {
    const loadPrefix = input.suggestedWeightKg != null ? `${input.suggestedWeightKg} kg · ` : "";
    return `${loadPrefix}${sets} x ${formatRange(input.minReps, input.maxReps, "reps")} · RPE ${input.targetRpe}`;
  }
  if (input.measurementType === "assisted_reps") {
    const assistPrefix = input.suggestedWeightKg != null ? `${input.suggestedWeightKg} kg assistance · ` : "";
    return `${assistPrefix}${sets} x ${formatRange(input.minReps, input.maxReps, "reps")} · RPE ${input.targetRpe}`;
  }
  if (input.measurementType === "bodyweight_reps") {
    return `${sets} x ${formatRange(input.minReps, input.maxReps, "reps")} · RPE ${input.targetRpe}`;
  }
  if (input.measurementType === "timed_hold") {
    return `${sets} x ${formatRange(input.minReps, input.maxReps, "sec")} · RPE ${input.targetRpe}`;
  }
  if (input.measurementType === "duration") {
    return `${sets} x ${formatRange(input.minReps, input.maxReps, "sec")}`;
  }
  return `${sets} x ${formatRange(input.minReps, input.maxReps, "sec")}`;
}
