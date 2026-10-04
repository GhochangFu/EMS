import {
  addAssetGroupMemberBodySchema,
  addUserGrantBodySchema,
  createAssetGroupBodySchema,
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateAssetGroupBodySchema,
  updateUserBodySchema,
} from "@bms/shared";
import type { ZodTypeAny } from "zod";
import { expect } from "vitest";

import { STRICTNESS_LEDGER } from "../testing/strict-body-ledger.data";
import { REQUEST_SCHEMAS } from "./openapi-registry";

/**
 * `F3.78` — every request body the asset-group and user-administration routes
 * take is registered by operationId, so the served document describes it
 * (the `F4.20` omission) and the strictness ledger walk reaches it.
 */
export const F378_BODIES: ReadonlyArray<readonly [string, ZodTypeAny]> = [
  ["AssetGroupsAdminController_create", createAssetGroupBodySchema],
  ["AssetGroupsAdminController_update", updateAssetGroupBodySchema],
  ["AssetGroupsAdminController_addMember", addAssetGroupMemberBodySchema],
  ["UsersAdminController_create", createUserBodySchema],
  ["UsersAdminController_update", updateUserBodySchema],
  ["UsersAdminController_temporaryPassword", temporaryPasswordBodySchema],
  ["UserGrantsAdminController_add", addUserGrantBodySchema],
];

/** The registry hands the document this exact schema object for the operation. */
export function registryHoldsBody(operationId: string): void {
  const entry = F378_BODIES.find(([id]) => id === operationId);
  expect(entry, `${operationId} is not in F378_BODIES`).toBeDefined();
  expect(REQUEST_SCHEMAS[operationId]).toBe(entry?.[1]);
}

/**
 * Each `.strict()` body of this unit has a recorded ledger decision — all seven since the
 * F4.189 ruling (2026-10-04) made the last three `.strict()`.
 */
export function ledgerRecordsStrictBodies(): void {
  for (const label of [
    "createAssetGroupBodySchema",
    "addAssetGroupMemberBodySchema",
    "createUserBodySchema",
    "updateAssetGroupBodySchema",
    "updateUserBodySchema",
    "temporaryPasswordBodySchema",
    "addUserGrantBodySchema",
  ]) {
    expect(STRICTNESS_LEDGER[label]?.strict, `${label} is not ledgered strict`).toBe(true);
  }
}
