import { expect } from "vitest";

import { emptyTopicAsNull } from "./rtu-topic";

export function assertAnEmptyTopicIsNull(): void {
  expect(emptyTopicAsNull("")).toBeNull();
}

export function assertAWhitespaceTopicIsKept(): void {
  // F4.223 parity: strict equality, no trim.
  expect(emptyTopicAsNull(" ")).toBe(" ");
}

export function assertANamedTopicIsKept(): void {
  expect(emptyTopicAsNull("a/b")).toBe("a/b");
}
