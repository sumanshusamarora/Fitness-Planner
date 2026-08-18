import {
  DEFAULT_COACH_LLM_MODEL,
  getConfiguredCoachModel,
  getCoachLLMUnavailableReason,
  isCoachLLMAvailable,
} from "@/lib/llm/config";

/**
 * Runtime coach model configuration wrapper. Server-side only — never import
 * this module from a React client component.
 */
export const DEFAULT_COACH_MODEL = DEFAULT_COACH_LLM_MODEL;

export const COACH_MODEL = getConfiguredCoachModel();

/** Pure check — no network request. A missing/blank key means deterministic fallback. */
export function isAICoachAvailable(): boolean {
  return isCoachLLMAvailable(COACH_MODEL);
}

/** Optional detail message used by callers/logging when the LLM is unavailable. */
export function getAICoachUnavailableReason(): string {
  return getCoachLLMUnavailableReason(COACH_MODEL);
}

/** Kept for compatibility with existing imports in test helpers. */
export function resetOpenAIClient(): void {}
