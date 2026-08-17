import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { COACH_MODEL, getOpenAIClient, isAICoachAvailable } from "./client";
import {
  COACH_PROMPT_VERSION,
  CORE_AUTHORITATIVE_DATA,
  CORE_LONGITUDINAL_ADAPTATION,
  CORE_MEASUREMENT_SEMANTICS,
  CORE_OUTPUT_CONTRACT,
  CORE_PLAN_VS_ACTUAL,
  CORE_ROLE,
  CORE_SESSION_OUTCOME_SEMANTICS,
  CORE_TRAINING_PRINCIPLES,
  CORE_UNCERTAINTY,
  CORE_UNTRUSTED_TEXT,
} from "./prompts/core";
import { MODE_EXTRA_SESSION } from "./prompts/extra-session";
import { MODE_INITIAL_WEEK } from "./prompts/initial-week";
import { MODE_NEXT_WEEK } from "./prompts/next-week";
import { MODE_NUTRITION } from "./prompts/nutrition";
import { MODE_RECOVERY } from "./prompts/recovery";
import { MODE_SUBSTITUTION } from "./prompts/substitution";
import { MODE_WEEK_REBUILD } from "./prompts/week-rebuild";
import type { CoachMode, CoachReasoningEffort, CoachRunMetadata } from "./types";

const MODE_INSTRUCTIONS: Record<CoachMode, string> = {
  initial_week: MODE_INITIAL_WEEK,
  next_week: MODE_NEXT_WEEK,
  extra_session: MODE_EXTRA_SESSION,
  recovery_review: MODE_RECOVERY,
  exercise_substitution: MODE_SUBSTITUTION,
  nutrition_review: MODE_NUTRITION,
  week_rebuild: MODE_WEEK_REBUILD,
};

/** Larger planning decisions use more reasoning; small ones stay light. */
export const REASONING_EFFORT: Record<CoachMode, CoachReasoningEffort> = {
  initial_week: "high",
  next_week: "high",
  extra_session: "medium",
  recovery_review: "medium",
  exercise_substitution: "low",
  nutrition_review: "medium",
  week_rebuild: "high",
};

export interface CoachPrompt {
  instructions: string;
  input: string;
}

/** Composes the versioned core role with mode-specific instructions and a compact JSON context. */
export function buildCoachPrompt(
  mode: CoachMode,
  context: unknown,
  constraints?: Record<string, unknown>,
): CoachPrompt {
  const instructions = [
    CORE_ROLE,
    CORE_AUTHORITATIVE_DATA,
    CORE_UNTRUSTED_TEXT,
    CORE_TRAINING_PRINCIPLES,
    CORE_SESSION_OUTCOME_SEMANTICS,
    CORE_LONGITUDINAL_ADAPTATION,
    CORE_PLAN_VS_ACTUAL,
    CORE_MEASUREMENT_SEMANTICS,
    MODE_INSTRUCTIONS[mode],
    CORE_UNCERTAINTY,
    CORE_OUTPUT_CONTRACT,
  ].join("\n\n");

  const input = [
    `Coach mode: ${mode}`,
    "Structured coaching context:",
    JSON.stringify(context),
    constraints ? `Deterministic constraints: ${JSON.stringify(constraints)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { instructions, input };
}

export interface CoachDecisionRunOptions<T> {
  mode: CoachMode;
  schema: z.ZodType<T>;
  context: unknown;
  constraints?: Record<string, unknown>;
  /** Override the default reasoning effort for the mode. */
  reasoningEffort?: CoachReasoningEffort;
  /** Enable the web-search tool for this request. Default false. */
  allowWebResearch?: boolean;
  /** Override the configured coach model. */
  model?: string;
  timeoutMs?: number;
}

export type CoachDecisionResult<T> = { ok: true; decision: T; metadata: CoachRunMetadata };
export type CoachDecisionFailure = { ok: false; reason: string; code: "unavailable" | "invalid" | "error" };

/**
 * The single shared entry point for runtime LLM coaching. All GPT-5 calls go
 * through here. It never writes to the database and never mutates plans.
 */
export async function runCoachDecision<T>(
  options: CoachDecisionRunOptions<T>,
): Promise<CoachDecisionResult<T> | CoachDecisionFailure> {
  if (!isAICoachAvailable()) {
    return { ok: false, reason: "AI coach is not configured (no OPEN_API_KEY).", code: "unavailable" };
  }

  const { mode, schema } = options;
  const model = options.model ?? COACH_MODEL;
  const prompt = buildCoachPrompt(mode, options.context, options.constraints);
  const tools = options.allowWebResearch ? [{ type: "web_search" as const }] : undefined;

  try {
    const response = await getOpenAIClient().responses.parse({
      model,
      instructions: prompt.instructions,
      input: prompt.input,
      text: { format: zodTextFormat(schema, `coach_decision_${mode}`) },
      reasoning: { effort: options.reasoningEffort ?? REASONING_EFFORT[mode] },
      tools,
    });

    const decision = response.output_parsed as T | null;
    if (decision == null) {
      return { ok: false, reason: "Model did not return structured output.", code: "invalid" };
    }

    const researchUsed = Array.isArray(response.output)
      ? response.output.some((item) => item.type === "web_search_call")
      : false;

    const metadata: CoachRunMetadata = {
      provider: "openai",
      model,
      promptVersion: COACH_PROMPT_VERSION,
      mode,
      responseId: response.id ?? null,
      createdAt: new Date().toISOString(),
      researchUsed,
    };

    return { ok: true, decision, metadata };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Unknown coach error.", code: "error" };
  }
}
