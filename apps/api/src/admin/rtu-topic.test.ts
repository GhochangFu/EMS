import { describe, it } from "vitest";

import {
  assertAnEmptyTopicIsNull,
  assertANamedTopicIsKept,
  assertAWhitespaceTopicIsKept,
} from "./rtu-topic.spec";

/**
 * `F4.228` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns nothing but the block structure.
 */
describe("F4.228 — emptyTopicAsNull", () => {
  it("stores an empty topic as NULL", () => {
    assertAnEmptyTopicIsNull();
  });
  it("keeps a whitespace topic as sent (no trim, F4.223 parity)", () => {
    assertAWhitespaceTopicIsKept();
  });
  it("keeps a named topic", () => {
    assertANamedTopicIsKept();
  });
});
