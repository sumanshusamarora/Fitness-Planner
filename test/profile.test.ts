import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsername, validateUsername } from "@/lib/username";

test("username matching is case-insensitive and trimmed", () => {
  assert.equal(normalizeUsername("suman"), "suman");
  assert.equal(normalizeUsername("Suman"), "suman");
  assert.equal(normalizeUsername(" SUMAN "), "suman");
});

test("username validation rejects empty and invalid input", () => {
  assert.ok(validateUsername(""));
  assert.ok(validateUsername("   "));
  assert.ok(validateUsername("has space"));
  assert.equal(validateUsername("suman_42"), null);
  assert.equal(validateUsername("Suman"), null);
});
