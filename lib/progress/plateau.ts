import type {
  ExerciseProgress,
  PlateauAssessment,
  PlateauConfounder,
  PlateauConfidence,
  PlateauStatus,
  TrendDirection,
} from "./types";

/**
 * Plateau detection. A plateau is a *sustained* lack of improvement across
 * several valid exposures after confounders (poor recovery, scheduling, pain,
 * insufficient data, one anomalous session) have been accounted for. One flat
 * week — or one bad session — is never enough.
 */

const MIN_EXPOSURES_FOR_PLATEAU = 4;
const MIN_EXPOSURES_FOR_POSSIBLE = 3;

export interface PlateauInput {
  exercises: ExerciseProgress[];
  adherenceRate: number | null;
  completedSessions: number;
  plannedSessions: number | null;
  recoveryTrend: TrendDirection;
  meaningfulJointPain: boolean;
  /** Scheduling-related skips / ended-early events (not physiological). */
  scheduleConfounders: number;
  /** Total attempted exposures across all movements. */
  totalAttemptedExposures: number;
}

export function assessPlateau(input: PlateauInput): PlateauAssessment {
  const analyzed = input.exercises.filter((exercise) => exercise.exposureCount >= MIN_EXPOSURES_FOR_POSSIBLE);
  const flatCandidates = analyzed.filter((exercise) => exercise.direction === "flat" && !exercise.isolatedDip);

  const confounders: PlateauConfounder[] = [];

  if (input.totalAttemptedExposures < MIN_EXPOSURES_FOR_POSSIBLE) {
    return {
      status: "insufficient_data",
      confidence: "low",
      evidence: ["Not enough attempted exposures to evaluate a plateau."],
      confounders: [{ type: "insufficient_exposures", detail: `${input.totalAttemptedExposures} attempted exposures across all movements.` }],
    };
  }

  if (input.meaningfulJointPain) {
    confounders.push({ type: "pain", detail: "Meaningful joint pain was reported." });
  }
  if (input.recoveryTrend === "decreasing") {
    confounders.push({ type: "poor_recovery", detail: "Recovery has been trending worse." });
  }
  if (input.scheduleConfounders > 0) {
    confounders.push({ type: "scheduling", detail: `${input.scheduleConfounders} session(s) missed or cut short for scheduling reasons.` });
  }
  if (input.adherenceRate != null && input.adherenceRate < 0.6) {
    confounders.push({ type: "scheduling", detail: "Low adherence means missed training may explain stagnation." });
  }
  for (const exercise of analyzed) {
    if (exercise.direction === "flat" && exercise.exposureCount < MIN_EXPOSURES_FOR_PLATEAU) {
      confounders.push({
        type: "insufficient_exposures",
        detail: `${exercise.name} has only ${exercise.exposureCount} valid exposures.`,
      });
    }
  }
  // A movement that recently regressed on a single session while earlier
  // exposures were improving is noise, not a plateau.
  for (const exercise of input.exercises) {
    if (exercise.isolatedDip) {
      confounders.push({ type: "single_anomalous_session", detail: `${exercise.name} shows an isolated recent dip after an improving run.` });
    }
  }

  if (flatCandidates.length === 0) {
    return {
      status: "none",
      confidence: "medium",
      evidence: ["No movement shows a sustained flat pattern across valid exposures."],
      confounders,
    };
  }

  const shareFlat = flatCandidates.length / analyzed.length;
  const clean = confounders.length === 0;
  const exposuresStrong = flatCandidates.every((exercise) => exercise.exposureCount >= MIN_EXPOSURES_FOR_PLATEAU);

  let status: PlateauStatus = "possible";
  if (shareFlat >= 0.5 && clean && exposuresStrong) status = "likely";
  else if (shareFlat < 0.5 && !clean) status = "possible";

  const confidence: PlateauConfidence = status === "likely" && exposuresStrong ? "high" : status === "possible" ? "medium" : "low";

  const evidence: string[] = [];
  evidence.push(
    `${flatCandidates.length} of ${analyzed.length} analysed movements are flat: ${flatCandidates.map((exercise) => exercise.name).join(", ")}.`,
  );
  if (status === "likely") evidence.push("Load, reps and effort have been stable across several valid exposures with no clear confounder.");
  if (status === "possible") evidence.push("Some stagnation is present but confounders or limited exposures reduce certainty.");

  return { status, confidence, evidence, confounders };
}
