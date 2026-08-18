import { generateText, NoObjectGeneratedError, Output } from "ai";
import { getCoachLLMUnavailableReason, hasProviderApiKey, parseModelIdentifier } from "./config";
import { ensureModelResolvable } from "./registry";
import type {
  LLMReasoningEffort,
  StructuredGenerateOptions,
  StructuredGenerationFailure,
  StructuredGenerationResult,
} from "./types";

type GenerateTextLike = typeof generateText;
type GenerateTextCall = Parameters<typeof generateText>[0];

let generateTextImpl: GenerateTextLike = generateText;

/**
 * Reasoning models (gpt-5, o-series) count both reasoning tokens and the final
 * output against `max_output_tokens`. Leaving it unset makes the model spend
 * its whole budget on reasoning and return "no output". This default gives the
 * largest weekly plans room to reason and still emit the full JSON proposal.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16000;

/** Bounded so a stalled provider call falls back to the deterministic coach instead of hanging. */
const DEFAULT_TIMEOUT_MS = 600000;

/**
 * How many times to re-attempt after a transient invalid/empty structured
 * output. DeepSeek documents that its JSON mode "may occasionally return empty
 * content", and reasoning models can emit schema-mismatched JSON — a single
 * retry materially raises reliability before we fall back to the deterministic
 * coach.
 */
const DEFAULT_MAX_RETRIES = 1;

const RETRY_DELAY_MS = 300;

function toProviderReasoning(effort?: LLMReasoningEffort): "low" | "medium" | "high" | undefined {
  if (!effort) return undefined;
  return effort;
}

function providerOptionsFor(model: string, reasoningEffort?: LLMReasoningEffort): GenerateTextCall["providerOptions"] {
  const parsed = parseModelIdentifier(model);
  const effort = toProviderReasoning(reasoningEffort);

  if (!effort) return undefined;

  if (parsed.providerId === "openai") {
    return { openai: { reasoningEffort: effort } };
  }

  if (parsed.providerId === "deepseek") {
    return { deepseek: { reasoningEffort: effort } };
  }

  return undefined;
}

export function setGenerateStructuredGenerateTextForTests(fn: GenerateTextLike | null): void {
  generateTextImpl = fn ?? generateText;
}

function unavailable(reason: string): StructuredGenerationFailure {
  return { ok: false, code: "unavailable", reason };
}

async function attemptGenerate<T>(
  options: StructuredGenerateOptions<T>,
  model: GenerateTextCall["model"],
  start: number,
): Promise<StructuredGenerationResult<T>> {
  try {
    const result = await generateTextImpl({
      model,
      instructions: options.system,
      prompt: options.input,
      output: Output.object({ schema: options.schema, name: options.schemaName }),
      reasoning: toProviderReasoning(options.reasoningEffort),
      providerOptions: providerOptionsFor(options.model, options.reasoningEffort),
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    let output: T;
    try {
      output = result.output as T;
    } catch (error) {
      // Empty/whitespace model response (e.g. DeepSeek's occasional empty JSON
      // mode output) surfaces as a throw on `.output` access. Treat it as a
      // transient, retryable invalid output rather than a hard provider error.
      return {
        ok: false,
        code: "invalid",
        reason: error instanceof Error ? error.message : "No output generated.",
      };
    }

    return {
      ok: true,
      output,
      metadata: {
        provider: result.finalStep.model.provider,
        model: result.finalStep.model.modelId,
        responseId: result.response.id ?? null,
        latencyMs: Date.now() - start,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return {
        ok: false,
        code: "invalid",
        reason: error.message,
      };
    }

    return {
      ok: false,
      code: "error",
      reason: error instanceof Error ? error.message : "Unknown structured generation error.",
    };
  }
}

export async function generateStructured<T>(
  options: StructuredGenerateOptions<T>,
): Promise<StructuredGenerationResult<T>> {
  const start = Date.now();
  const parsed = parseModelIdentifier(options.model);

  if (!hasProviderApiKey(parsed.providerId)) {
    return unavailable(getCoachLLMUnavailableReason(options.model));
  }

  const model = ensureModelResolvable(options.model);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  let last: StructuredGenerationResult<T> = {
    ok: false,
    code: "error",
    reason: "Structured generation did not run.",
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await attemptGenerate<T>(options, model, start);
    if (last.ok) return last;
    // Only retry transient invalid/empty outputs. Hard errors (auth, network,
    // unsupported) and missing configuration fall through immediately.
    if (last.code !== "invalid") return last;
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return last;
}
