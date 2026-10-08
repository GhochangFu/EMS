import { expect } from "vitest";

import { emptyTopicAsNull } from "./rtu-topic";

/** An empty topic maps to NULL. */
export function assertAnEmptyTopicIsNull(): void {
  expect(emptyTopicAsNull("")).toBeNull();
}

/** A whitespace-only topic is not empty, so it is kept as given. */
export function assertAWhitespaceTopicIsKept(): void {
  // F4.223 parity: strict equality, no trim.
  expect(emptyTopicAsNull(" ")).toBe(" ");
}

/** A named topic passes through unchanged. */
export function assertANamedTopicIsKept(): void {
  expect(emptyTopicAsNull("a/b")).toBe("a/b");
}
