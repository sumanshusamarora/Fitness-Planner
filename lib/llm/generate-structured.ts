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

export async function generateStructured<T>(
  options: StructuredGenerateOptions<T>,
): Promise<StructuredGenerationResult<T>> {
  const start = Date.now();
  const parsed = parseModelIdentifier(options.model);

  if (!hasProviderApiKey(parsed.providerId)) {
    return unavailable(getCoachLLMUnavailableReason(options.model));
  }

  const model = ensureModelResolvable(options.model);

  try {
    const result = await generateTextImpl({
      model,
      instructions: options.system,
      prompt: options.input,
      output: Output.object({ schema: options.schema, name: options.schemaName }),
      reasoning: toProviderReasoning(options.reasoningEffort),
      providerOptions: providerOptionsFor(options.model, options.reasoningEffort),
      timeout: options.timeoutMs,
    });

    return {
      ok: true,
      output: result.output as T,
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
