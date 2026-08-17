/** Shared types for the runtime AI coach. Server-side only. */

export type CoachMode =
  | "initial_week"
  | "next_week"
  | "extra_session"
  | "recovery_review"
  | "exercise_substitution"
  | "nutrition_review";

export type CoachReasoningEffort = "low" | "medium" | "high";

/**
 * Metadata attached to any coaching decision that came from the OpenAI
 * reasoner. Persisted inside proposal JSONB so decisions stay auditable
 * without a separate audit subsystem.
 */
export interface CoachRunMetadata {
  provider: "openai";
  model: string;
  promptVersion: string;
  mode: CoachMode;
  responseId: string | null;
  createdAt: string;
  researchUsed: boolean;
}

/** The OpenAI reasoner was not available (no key, outage, parse/validation). */
export class CoachUnavailableError extends Error {
  readonly code = "COACH_UNAVAILABLE";
  constructor(message = "The AI coach is unavailable.") {
    super(message);
    this.name = "CoachUnavailableError";
  }
}

/** The model returned a structurally valid but semantically invalid proposal. */
export class CoachInvalidError extends Error {
  readonly code = "COACH_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "CoachInvalidError";
  }
}
