// `reflect-metadata` first, before `WorkOrdersService` is imported: its decorators read the polyfill.
import "reflect-metadata";

import { expect } from "vitest";

import { workOrderTitlePattern } from "./work-orders.service";

/**
 * `F4.284` (owner ruling DC7) — the title search `list_work_orders` sends as
 * `titleSearch` is literal text: `\`, `%` and `_` are escaped before the `ILIKE`.
 * Vitest entry point: the sibling `.test.ts`.
 */

export function aPlainSearchIsASubstring(): void {
  expect(workOrderTitlePattern("main lug")).toBe("%main lug%");
}

export function theLikeMetacharactersAreEscaped(): void {
  expect(workOrderTitlePattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
}
