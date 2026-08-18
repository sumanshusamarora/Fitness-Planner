/**
 * Deterministic domain errors for the state-safety boundary. Every guard throws
 * a `DomainError` with a stable `code` so API routes can return a machine
 * readable conflict (409 by default) plus a short, actionable message.
 */
export type DomainErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_IN_PROGRESS"
  | "SESSION_ALREADY_FINALIZED"
  | "SESSION_HAS_ACTUAL_WORK"
  | "PLAN_DAY_NOT_FOUND"
  | "PLAN_DAY_IS_REST"
  | "PLAN_DAY_IS_EXTRA"
  | "PLAN_DAY_ALREADY_STARTED"
  | "EXERCISE_NOT_FOUND"
  | "INVALID_SET_INPUT"
  | "SET_NOT_FOUND"
  | "ACTIVITY_NOT_FOUND"
  | "EXERCISE_NOT_SKIPPED"
  | "EXERCISE_ALREADY_FINALIZED"
  | "EXERCISE_REPLACED"
  | "ADDED_EXERCISE_HAS_ACTUAL_WORK"
  | "NO_REPLACEMENT_TO_RESTORE"
  | "REPLACEMENT_HAS_ACTUAL_WORK"
  | "ORIGINAL_HAS_ACTUAL_WORK"
  | "PLAN_DAY_NOT_EXTRA"
  | "PLAN_DAY_ALREADY_REMOVED"
  | "PLAN_REVISION_NOT_FOUND"
  | "PLAN_REVISION_ALREADY_RESTORED"
  | "PLAN_REVISION_NOT_RESTORABLE"
  | "PLAN_REVISION_STALE"
  | "PLAN_REVISION_DAY_STARTED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;

  constructor(message: string, code: DomainErrorCode, status = 409) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Normalises any thrown error into a JSON body + HTTP status for route
 * handlers. `DomainError`s keep their stable code/status (mostly 409 state
 * conflicts); anything else falls back to a short message.
 */
export function toErrorBody(
  error: unknown,
  fallback: string,
  fallbackStatus = 400,
): { body: { error: string; code?: string }; status: number } {
  if (error instanceof DomainError) {
    return { body: { error: error.message, code: error.code }, status: error.status };
  }
  return {
    body: { error: error instanceof Error ? error.message : fallback },
    status: fallbackStatus,
  };
}