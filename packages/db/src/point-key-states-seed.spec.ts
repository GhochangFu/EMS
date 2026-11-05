import { expect } from "vitest";

import * as db from "./index";
import { POINT_KEY_STATE_SEED } from "./point-key-states-seed";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 3 (owner ruling Q3 (a)) — the package root exports
 * the seed's literal itself, so the API's "seeded" check compares with the very rows the seed
 * writes (the `HEALTH_BANDS` precedent). Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
export function thePackageRootExportsTheSeedLiteral(): void {
  expect((db as Record<string, unknown>).POINT_KEY_STATE_SEED).toBe(POINT_KEY_STATE_SEED);
  // Only the literal: the seed function stays internal to the package.
  expect((db as Record<string, unknown>).seedPointKeyStates).toBeUndefined();
}
