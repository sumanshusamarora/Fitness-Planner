import type { z } from "zod";

export type LLMProviderId = "openai" | "deepseek" | string;
export type LLMReasoningEffort = "low" | "medium" | "high";

export interface ParsedModelIdentifier {
  providerId: LLMProviderId;
  modelId: string;
  fullId: string;
}

export interface StructuredGenerateOptions<T> {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  input: string;
  reasoningEffort?: LLMReasoningEffort;
  allowWebResearch?: boolean;
  timeoutMs?: number;
  /** Maximum output tokens (reasoning + generated text). Reasoning models need a generous budget. */
  maxOutputTokens?: number;
}

export interface StructuredGenerationMetadata {
  provider: string;
  model: string;
  latencyMs: number;
  responseId: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type StructuredGenerationSuccess<T> = {
  ok: true;
  output: T;
  metadata: StructuredGenerationMetadata;
};

export type StructuredGenerationFailure = {
  ok: false;
  code: "unavailable" | "invalid" | "error";
  reason: string;
};

export type StructuredGenerationResult<T> = StructuredGenerationSuccess<T> | StructuredGenerationFailure;
