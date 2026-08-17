import OpenAI from "openai";

/**
 * The single OpenAI client for the runtime coach. Server-side only — never
 * import this module from a React client component.
 *
 * The application uses the `OPEN_API_KEY` environment variable (not
 * `OPENAI_API_KEY`). The key stays server-side and is never exposed to the
 * browser or logged.
 */
export const DEFAULT_COACH_MODEL = "gpt-5";

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export const COACH_MODEL = envOr("OPENAI_COACH_MODEL", DEFAULT_COACH_MODEL);

/** Pure check — no network request. A missing/blank key means deterministic fallback. */
export function isAICoachAvailable(): boolean {
  // Tests assert deterministic outcomes, so the AI coach is off by default
  // under the test runner (the manual smoke test runs outside NODE_ENV=test).
  if (process.env.NODE_ENV === "test") return false;
  const key = process.env.OPEN_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

let client: OpenAI | null = null;

/** Lazily create the shared client. Throws only when actually used without a key. */
export function getOpenAIClient(): OpenAI {
  if (client) return client;
  const key = process.env.OPEN_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error("OPEN_API_KEY is not set. The deterministic coach is used instead.");
  }
  client = new OpenAI({ apiKey: key });
  return client;
}

/** Used by tests to reset the cached client between scenarios. */
export function resetOpenAIClient(): void {
  client = null;
}
