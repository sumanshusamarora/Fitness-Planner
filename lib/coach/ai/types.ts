/** Shared types for the runtime AI coach. Server-side only. */

export type CoachMode =
  | "initial_week"
  | "next_week"
  | "extra_session"
  | "recovery_review"
  | "exercise_substitution"
  | "nutrition_review"
  | "week_rebuild";

export type CoachReasoningEffort = "low" | "medium" | "high";

/**
 * Metadata attached to any coaching decision that came from an LLM provider.
 * Persisted inside proposal JSONB so decisions stay auditable without a
 * separate audit subsystem.
 */
export interface CoachRunMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  mode: CoachMode;
  source: "llm" | "deterministic_fallback";
  responseId: string | null;
  createdAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
