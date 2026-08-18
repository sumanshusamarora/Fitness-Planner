import type { ParsedModelIdentifier } from "./types";

export const DEFAULT_COACH_LLM_MODEL = "openai:gpt-5";

function envOr(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function withOpenAIPrefix(modelId: string): string {
  return modelId.includes(":") ? modelId : `openai:${modelId}`;
}

export function getConfiguredCoachModel(): string {
  const explicit = envOr("COACH_LLM_MODEL");
  if (explicit) return withOpenAIPrefix(explicit);

  const legacyOpenAIModel = envOr("OPENAI_COACH_MODEL");
  if (legacyOpenAIModel) return withOpenAIPrefix(legacyOpenAIModel);

  return DEFAULT_COACH_LLM_MODEL;
}

export function parseModelIdentifier(input: string): ParsedModelIdentifier {
  const normalized = input.trim();
  const split = normalized.indexOf(":");

  if (split <= 0 || split === normalized.length - 1) {
    throw new Error(`Invalid model identifier \"${input}\". Expected format provider:model.`);
  }

  const providerId = normalized.slice(0, split).toLowerCase();
  const modelId = normalized.slice(split + 1);
  return { providerId, modelId, fullId: `${providerId}:${modelId}` };
}

export function getProviderApiKeyEnvName(providerId: string): string | null {
  if (providerId === "openai") return "OPEN_API_KEY";
  if (providerId === "deepseek") return "DEEPSEEK_API_KEY";
  return null;
}

export function hasProviderApiKey(providerId: string): boolean {
  const envName = getProviderApiKeyEnvName(providerId);
  if (!envName) return false;
  return envOr(envName) != null;
}

export function getProviderApiKey(providerId: string): string | undefined {
  const envName = getProviderApiKeyEnvName(providerId);
  if (!envName) return undefined;
  return envOr(envName) ?? undefined;
}

export function isCoachLLMAvailable(model = getConfiguredCoachModel()): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const parsed = parseModelIdentifier(model);
  return hasProviderApiKey(parsed.providerId);
}

export function getCoachLLMUnavailableReason(model = getConfiguredCoachModel()): string {
  const parsed = parseModelIdentifier(model);
  const envName = getProviderApiKeyEnvName(parsed.providerId);

  if (!envName) {
    return `Unsupported LLM provider \"${parsed.providerId}\" for model \"${model}\".`;
  }

  return `${envName} is not set for selected model \"${model}\".`;
}
