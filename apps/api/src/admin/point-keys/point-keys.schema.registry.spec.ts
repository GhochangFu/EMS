import { expect } from "vitest";

import { REQUEST_SCHEMAS } from "../../openapi/openapi-registry";
import { STRICTNESS_LEDGER } from "../../testing/strict-body-ledger.data";
import { createPointKeyBodySchema, updatePointKeyBodySchema } from "./point-keys.schema";

/**
 * `F3.68` — the registry half of the point-key body cases. `REQUEST_SCHEMAS` and the strictness
 * ledger are `apps/api`, so this stayed here when the schemas moved to `packages/shared`
 * (`F3.86` PR 1); the pure schema cases moved with them to `point-key-writes.spec.ts`.
 */

/**
 * No new body, so no new registry or ledger row (plan "Measured
 * conventions"). Asserted by identity, not by text: the registry must still
 * hand the OpenAPI document these exact schema objects, so the new field
 * reaches the document with no second edit.
 */
export function registryAndLedgerStillNameTheBodies(): void {
  expect(REQUEST_SCHEMAS.PointKeysAdminController_create).toBe(createPointKeyBodySchema);
  expect(REQUEST_SCHEMAS.PointKeysAdminController_update).toBe(updatePointKeyBodySchema);
  expect(STRICTNESS_LEDGER.createPointKeyBodySchema).toBeDefined();
  expect(STRICTNESS_LEDGER.updatePointKeyBodySchema).toBeDefined();
}
