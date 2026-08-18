import assert from "node:assert/strict";
import test from "node:test";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";
import {
  getConfiguredCoachModel,
  getCoachLLMUnavailableReason,
  parseModelIdentifier,
} from "@/lib/llm/config";
import {
  generateStructured,
  setGenerateStructuredGenerateTextForTests,
} from "@/lib/llm/generate-structured";
import { resetProviderRegistryForTests } from "@/lib/llm/registry";

const ORIGINAL_ENV = {
  COACH_LLM_MODEL: process.env.COACH_LLM_MODEL,
  OPENAI_COACH_MODEL: process.env.OPENAI_COACH_MODEL,
  OPEN_API_KEY: process.env.OPEN_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};

function restoreEnv() {
  process.env.COACH_LLM_MODEL = ORIGINAL_ENV.COACH_LLM_MODEL;
  process.env.OPENAI_COACH_MODEL = ORIGINAL_ENV.OPENAI_COACH_MODEL;
  process.env.OPEN_API_KEY = ORIGINAL_ENV.OPEN_API_KEY;
  process.env.DEEPSEEK_API_KEY = ORIGINAL_ENV.DEEPSEEK_API_KEY;
}

test.afterEach(() => {
  setGenerateStructuredGenerateTextForTests(null);
  restoreEnv();
  resetProviderRegistryForTests();
});

test("model config prefers COACH_LLM_MODEL with provider:model format", () => {
  process.env.COACH_LLM_MODEL = "deepseek:deepseek-chat";
  process.env.OPENAI_COACH_MODEL = "gpt-5";

  assert.equal(getConfiguredCoachModel(), "deepseek:deepseek-chat");
});

test("legacy OPENAI_COACH_MODEL maps to provider-prefixed OpenAI model", () => {
  delete process.env.COACH_LLM_MODEL;
  process.env.OPENAI_COACH_MODEL = "gpt-5-mini";

  assert.equal(getConfiguredCoachModel(), "openai:gpt-5-mini");
});

test("defaults split high-effort reasoning onto terra and quick decisions onto luna", () => {
  delete process.env.COACH_LLM_MODEL;
  delete process.env.OPENAI_COACH_MODEL;

  assert.equal(getConfiguredCoachModel(), "openai:gpt-5.6-luna");
  assert.equal(getConfiguredCoachModel("low"), "openai:gpt-5.6-luna");
  assert.equal(getConfiguredCoachModel("medium"), "openai:gpt-5.6-luna");
  assert.equal(getConfiguredCoachModel("high"), "openai:gpt-5.6-terra");
});

test("model parser resolves provider and model ids", () => {
  assert.deepEqual(parseModelIdentifier("openai:gpt-5"), {
    providerId: "openai",
    modelId: "gpt-5",
    fullId: "openai:gpt-5",
  });
  assert.deepEqual(parseModelIdentifier("deepseek:deepseek-chat"), {
    providerId: "deepseek",
    modelId: "deepseek-chat",
    fullId: "deepseek:deepseek-chat",
  });
});

test("missing selected provider key returns unavailable without calling provider", async () => {
  process.env.OPEN_API_KEY = "";
  let calls = 0;

  setGenerateStructuredGenerateTextForTests((async () => {
    calls += 1;
    throw new Error("should not be called");
  }) as typeof import("ai").generateText);

  const result = await generateStructured({
    model: "openai:gpt-5",
    schema: z.object({ ok: z.boolean() }),
    schemaName: "test_schema",
    system: "system",
    input: "input",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "unavailable");
    assert.equal(result.reason, getCoachLLMUnavailableReason("openai:gpt-5"));
  }
  assert.equal(calls, 0);
});

test("structured generation returns typed output and normalized metadata", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";

  setGenerateStructuredGenerateTextForTests((async () => {
    return {
      output: { answer: "ok" },
      finalStep: { model: { provider: "deepseek", modelId: "deepseek-chat" } },
      response: { id: "resp_1" },
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    } as unknown;
  }) as typeof import("ai").generateText);

  const result = await generateStructured({
    model: "deepseek:deepseek-chat",
    schema: z.object({ answer: z.string() }),
    schemaName: "deepseek_test",
    system: "system",
    input: "input",
    reasoningEffort: "medium",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.answer, "ok");
    assert.equal(result.metadata.provider, "deepseek");
    assert.equal(result.metadata.model, "deepseek-chat");
    assert.equal(result.metadata.responseId, "resp_1");
    assert.equal(result.metadata.inputTokens, 11);
    assert.equal(result.metadata.outputTokens, 7);
    assert.equal(result.metadata.totalTokens, 18);
    assert.ok(result.metadata.latencyMs >= 0);
  }
});

test("schema-generation parse failure maps to invalid code", async () => {
  process.env.OPEN_API_KEY = "test-key";

  setGenerateStructuredGenerateTextForTests((async () => {
    throw new NoObjectGeneratedError({
      message: "Could not generate valid object.",
      text: "not json",
      response: { id: "r1", modelId: "gpt-5", timestamp: new Date() },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      finishReason: "stop",
    });
  }) as typeof import("ai").generateText);

  const result = await generateStructured({
    model: "openai:gpt-5",
    schema: z.object({ ok: z.boolean() }),
    schemaName: "invalid_schema",
    system: "system",
    input: "input",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid");
});

test("provider runtime error maps to error code", async () => {
  process.env.OPEN_API_KEY = "test-key";

  setGenerateStructuredGenerateTextForTests((async () => {
    throw new Error("provider timeout");
  }) as typeof import("ai").generateText);

  const result = await generateStructured({
    model: "openai:gpt-5",
    schema: z.object({ ok: z.boolean() }),
    schemaName: "error_schema",
    system: "system",
    input: "input",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "error");
    assert.match(result.reason, /provider timeout/i);
  }
});
