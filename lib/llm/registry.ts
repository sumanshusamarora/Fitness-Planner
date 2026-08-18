import { createProviderRegistry } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { getProviderApiKey, parseModelIdentifier } from "./config";

let configured = false;

function ensureProviderRegistryConfigured(): void {
  if (configured) return;

  const registry = createProviderRegistry({
    openai: createOpenAI({ apiKey: getProviderApiKey("openai") }),
    deepseek: createDeepSeek({ apiKey: getProviderApiKey("deepseek") }),
  });

  globalThis.AI_SDK_DEFAULT_PROVIDER = registry as unknown as typeof globalThis.AI_SDK_DEFAULT_PROVIDER;
  configured = true;
}

export function ensureModelResolvable(model: string): string {
  ensureProviderRegistryConfigured();
  const parsed = parseModelIdentifier(model);
  return parsed.fullId;
}

export function resetProviderRegistryForTests(): void {
  configured = false;
}
