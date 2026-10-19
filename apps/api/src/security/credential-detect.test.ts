import { describe, expect, it } from "vitest";

import { looksLikeCredential as viaLlm } from "../llm/credential-detect";
import { looksLikeCredential } from "./credential-detect";

/**
 * F3.24b: the predicate lives at a neutral path so the worker closure can use
 * it without importing `llm/` (`tests/f4.24-worker-imports-no-api-loop`). The
 * `llm/` path re-exports it; its own spec keeps the behaviour claims.
 */
describe("F3.24b — looksLikeCredential at the neutral security path", () => {
  it("detects a password assignment", () => {
    expect(looksLikeCredential("password: hunter2")).toBe(true);
  });
  it("leaves ordinary text alone", () => {
    expect(looksLikeCredential("flow rate")).toBe(false);
  });
  it("is the same function the llm path re-exports", () => {
    expect(viaLlm).toBe(looksLikeCredential);
  });
});
