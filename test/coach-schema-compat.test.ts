import assert from "node:assert/strict";
import test from "node:test";
import { zodSchema } from "ai";
import { CoachDecisionSchemas } from "@/lib/coach/ai/schemas";

const EXPECTED_MODES = [
  "initial_week",
  "next_week",
  "extra_session",
  "week_rebuild",
  "recovery_review",
  "exercise_substitution",
  "nutrition_review",
] as const;

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  [key: string]: unknown;
};

function extractJsonSchema(mode: string): JsonSchema {
  const format = zodSchema(CoachDecisionSchemas[mode as keyof typeof CoachDecisionSchemas] as never) as unknown as {
    jsonSchema?: JsonSchema;
    json_schema?: JsonSchema;
  };

  const schema = format.jsonSchema ?? format.json_schema;
  assert.ok(schema, `Could not extract JSON schema for ${mode}`);
  return schema;
}

function assertNoOptionalObjectFields(schema: JsonSchema, path = "root") {
  const hasObjectProps = schema.properties && typeof schema.properties === "object";
  if (hasObjectProps) {
    const keys = Object.keys(schema.properties ?? {});
    const required = Array.isArray(schema.required) ? schema.required : [];
    assert.deepEqual(
      [...required].sort(),
      [...keys].sort(),
      `${path} has optional fields; Structured Outputs requires all properties to be required and nullable when absent.`,
    );

    for (const key of keys) {
      assertNoOptionalObjectFields((schema.properties ?? {})[key], `${path}.${key}`);
    }
  }

  if (schema.items && typeof schema.items === "object") {
    assertNoOptionalObjectFields(schema.items, `${path}[]`);
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (Array.isArray(variants)) {
      variants.forEach((variant, index) => {
        assertNoOptionalObjectFields(variant, `${path}.${key}[${index}]`);
      });
    }
  }
}

test("all runtime coach schemas compile to AI SDK structured schema format", () => {
  const registeredModes = Object.keys(CoachDecisionSchemas).sort();
  assert.deepEqual(registeredModes, [...EXPECTED_MODES].sort());

  for (const mode of EXPECTED_MODES) {
    const schema = extractJsonSchema(mode);
    assert.ok(schema, `${mode} did not compile to JSON schema`);
  }
});

test("no registered structured schema contains optional object fields", () => {
  for (const mode of EXPECTED_MODES) {
    const schema = extractJsonSchema(mode);
    assertNoOptionalObjectFields(schema, mode);
  }
});
