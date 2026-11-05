import { expect } from "vitest";

import { createPointKeyStateBodySchema, updatePointKeyStateBodySchema } from "@bms/shared";

import { REQUEST_SCHEMAS } from "../../openapi/openapi-registry";
import { STRICTNESS_LEDGER } from "../../testing/strict-body-ledger.data";

/**
 * `F4.309` (plan C11, ADR 0029) — the two write bodies reach the OpenAPI document and the
 * strict-body ledger. By identity: the registry must hand the document these very schema objects,
 * so a later field reaches it with no second edit. `GET` and `DELETE` take no body and are absent.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
export function bothBodiesAreRegisteredAndLedgered(): void {
  expect(REQUEST_SCHEMAS.PointKeyStatesAdminController_create).toBe(createPointKeyStateBodySchema);
  expect(REQUEST_SCHEMAS.PointKeyStatesAdminController_update).toBe(updatePointKeyStateBodySchema);
  expect(REQUEST_SCHEMAS.PointKeyStatesAdminController_list).toBeUndefined();
  expect(REQUEST_SCHEMAS.PointKeyStatesAdminController_remove).toBeUndefined();
  expect(STRICTNESS_LEDGER.createPointKeyStateBodySchema).toBeDefined();
  expect(STRICTNESS_LEDGER.updatePointKeyStateBodySchema).toBeDefined();
}
