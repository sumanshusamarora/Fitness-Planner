import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { getProviderApiKey, parseModelIdentifier } from "./config";

type ModelFactory = (modelId: string) => LanguageModel;

let cached: Record<string, ModelFactory> | null = null;

function factories(): Record<string, ModelFactory> {
  if (!cached) {
    cached = {
      openai: createOpenAI({ apiKey: getProviderApiKey("openai") }),
      deepseek: createDeepSeek({ apiKey: getProviderApiKey("deepseek") }),
    };
  }
  return cached;
}

/**
 * Resolves a `provider:model` identifier to a concrete language model object.
 *
 * We deliberately do NOT route through `createProviderRegistry` /
 * `AI_SDK_DEFAULT_PROVIDER` here: that registry emits v2-specification models,
 * and the AI SDK's v2→v4 compatibility proxy mangles structured-output results
 * (corrupting `usage`/`finishReason` and dropping the parsed output, surfacing
 * as "No output generated"). Passing the native model object avoids that layer.
 */
export function ensureModelResolvable(model: string): LanguageModel {
  const parsed = parseModelIdentifier(model);
  const factory = factories()[parsed.providerId];
  if (!factory) {
    throw new Error(`Unsupported LLM provider "${parsed.providerId}" for model "${model}".`);
  }
  return factory(parsed.modelId);
}

export function resetProviderRegistryForTests(): void {
  cached = null;
}
