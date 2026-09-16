import { OBJECT_KEY_PREFIX } from "../storage/object-key";
import {
  ASSET_ID,
  assert,
  capturingWarns,
  errorMessage,
  errorName,
  FIXTURE_KEY,
  harness,
  IMAGE_ID,
  JWT,
  namedError,
  ORG_ID,
  OTHER_ID,
} from "./asset-images-write.service.spec";
import type { Harness, Scenario } from "./asset-images-write.service.spec";

/**
 * `F3.4` (ADR 0066 decision 11, Amendment 3 R-2) — `AssetImagesWriteService.
 * remove` over the fakes `asset-images-write.service.spec.ts` exports. The
 * split keeps each spec under AGENTS.md §4.5's cap; the harness, the
 * constants and the warn capture are shared, not copied. Assertions live
 * here; `asset-images-remove.service.test.ts` is the Vitest entry point.
 *
 * The one ordered `calls` list is what proves "the row's transaction
 * committed **before** the object was deleted": `["tx:commit",
 * "deleteObject"]` is a deep-equal on the delta, never a lifetime count.
 * The fixture row's key ends in `OTHER_ID`, so "the warn names the image
 * id" and "the warn never carries the key" are independent claims.
 */

async function runRemove(scenario: Scenario): Promise<{ err: unknown; warns: string[]; h: Harness }> {
  const h = harness(scenario);
  let err: unknown;
  const { warns } = await capturingWarns(async () => {
    try {
      await h.service.remove(JWT, ASSET_ID, IMAGE_ID);
    } catch (e) {
      err = e;
    }
  });
  return { err, warns, h };
}

export async function assertRemoveWithNoRowRejectsNotFound(): Promise<void> {
  const { err } = await runRemove({ deleteRows: [] });
  assert(
    errorName(err) === "NotFoundException" && errorMessage(err) === "Asset image not found",
    `no row threw ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertRemoveWithNoRowMakesNoStorageCall(): Promise<void> {
  const { h } = await runRemove({ deleteRows: [] });
  assert(
    h.calls.length === 0 && h.audit.inputs.length === 0,
    `no row reached storage or audit: [${h.calls.join(", ")}], audits ${h.audit.inputs.length}`,
  );
}

const oneRow = (): Scenario => ({ deleteRows: [{ objectKey: FIXTURE_KEY }] });

export async function assertRemoveDeletesTheObjectAfterTheTransactionCommitted(): Promise<void> {
  const { err, h } = await runRemove(oneRow());
  assert(err === undefined, `remove rejected: ${errorName(err)}`);
  assert(
    JSON.stringify(h.calls) === JSON.stringify(["tx:commit", "deleteObject"]),
    `expected [tx:commit, deleteObject], saw [${h.calls.join(", ")}]`,
  );
}

export async function assertRemoveDeletesTheRowsKey(): Promise<void> {
  const { h } = await runRemove(oneRow());
  assert(
    h.deleteKeys.length === 1 && h.deleteKeys[0] === FIXTURE_KEY,
    `expected one deleteObject on the row's key, saw ${h.deleteKeys.join(", ")}`,
  );
}

export async function assertRemoveAuditCarriesTheOrganizationAndTheTx(): Promise<void> {
  const { h } = await runRemove(oneRow());
  const input = h.audit.inputs[0];
  assert(
    h.audit.inputs.length === 1 && input?.organizationId === ORG_ID && h.audit.executors[0] === h.tx,
    `audit row was ${JSON.stringify(input)}, executor is tx: ${String(h.audit.executors[0] === h.tx)}`,
  );
}

export async function assertRemoveAuditNamesTheActionEntityAndImage(): Promise<void> {
  const { h } = await runRemove(oneRow());
  const input = h.audit.inputs[0];
  assert(
    input?.action === "master.asset_image.delete" && input.entityType === "asset_image" && input.entityId === IMAGE_ID,
    `audit row was ${JSON.stringify(input)}`,
  );
}

const objectDeleteDown = (): Scenario => ({
  ...oneRow(),
  deleteObject: async () => {
    throw namedError("TimeoutError");
  },
});

export async function assertRemoveObjectFailureStillResolves(): Promise<void> {
  const { err, h } = await runRemove(objectDeleteDown());
  assert(
    err === undefined && h.calls.includes("deleteObject"),
    `remove must resolve past a failed object delete; threw ${errorName(err)}`,
  );
}

export async function assertRemoveObjectFailureWarnsOnceNamingTheImageId(): Promise<void> {
  const { warns } = await runRemove(objectDeleteDown());
  assert(warns.length === 1, `expected one warn, saw ${warns.length}: ${warns.join(" | ")}`);
  assert(
    warns[0]?.includes(IMAGE_ID) === true && warns[0]?.includes("TimeoutError") === true && warns[0]?.includes("orphan") === true,
    `the warn must name the image id, err.name and the orphan: ${warns[0]}`,
  );
}

/** Independent of the row above: the fixture key ends in `OTHER_ID`, so a logged key fails here and only here. */
export async function assertRemoveObjectFailureWarnNeverCarriesTheKey(): Promise<void> {
  const { warns } = await runRemove(objectDeleteDown());
  const joined = warns.join("\n");
  assert(
    !joined.includes(OBJECT_KEY_PREFIX) && !joined.includes(OTHER_ID),
    `the orphan warn must not carry the key: ${warns.join(" | ")}`,
  );
}
