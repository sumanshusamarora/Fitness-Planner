import type { WeeklyPlanProposal } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

/** Runtime guard for JSONB and eventual model/provider output. */
export function parseWeeklyPlanProposal(value: unknown): WeeklyPlanProposal {
  if (!isRecord(value)) throw new Error("Proposal must be an object.");
  if (
    (typeof value.sourceWeekId !== "number" && value.sourceWeekId !== null) ||
    typeof value.proposedWeekNumber !== "number"
  ) {
    throw new Error("Proposal is missing its source or proposed week.");
  }
  if (typeof value.proposedStartsOn !== "string" || !isRecord(value.summary)) {
    throw new Error("Proposal is missing its schedule or summary.");
  }
  if (!Array.isArray(value.changes) || !Array.isArray(value.days) || !Array.isArray(value.questions)) {
    throw new Error("Proposal must contain changes, days, and questions.");
  }
  const confidence = value.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "needs-input") {
    throw new Error("Proposal confidence is invalid.");
  }
  for (const change of value.changes) {
    if (!isRecord(change) || typeof change.exerciseId !== "number" || typeof change.exerciseName !== "string") {
      throw new Error("Proposal contains an invalid exercise change.");
    }
    if (!isRecord(change.previous) || !isRecord(change.proposed)) {
      throw new Error("Proposal change is missing before/after values.");
    }
    if (!hasNumber(change.previous.weightKg) || !hasNumber(change.proposed.weightKg)) {
      throw new Error("Proposal contains an invalid load.");
    }
    if (!Array.isArray(change.evidence) || typeof change.reason !== "string") {
      throw new Error("Proposal change requires evidence and a reason.");
    }
  }
  return value as unknown as WeeklyPlanProposal;
}
