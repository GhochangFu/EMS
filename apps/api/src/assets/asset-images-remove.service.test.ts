import { describe, it } from "vitest";

import {
  assertRemoveAuditCarriesTheOrganizationAndTheTx,
  assertRemoveAuditNamesTheActionEntityAndImage,
  assertRemoveDeletesTheObjectAfterTheTransactionCommitted,
  assertRemoveDeletesTheRowsKey,
  assertRemoveObjectFailureStillResolves,
  assertRemoveObjectFailureWarnNeverCarriesTheKey,
  assertRemoveObjectFailureWarnsOnceNamingTheImageId,
  assertRemoveWithNoRowMakesNoStorageCall,
  assertRemoveWithNoRowRejectsNotFound,
} from "./asset-images-remove.service.spec";

/**
 * F3.4 (ADR 0066 decision 11, Amendment 3) — Vitest entry point for
 * `AssetImagesWriteService.remove` over fakes. Assertions live in the sibling
 * `.spec` (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.4 — AssetImagesWriteService.remove over fakes", () => {
  it("no row rejects NotFoundException", async () => {
    await assertRemoveWithNoRowRejectsNotFound();
  });

  it("no row makes no storage call and writes no audit row", async () => {
    await assertRemoveWithNoRowMakesNoStorageCall();
  });

  it("one row: the object is deleted after the transaction committed (tx:commit, then deleteObject)", async () => {
    await assertRemoveDeletesTheObjectAfterTheTransactionCommitted();
  });

  it("one row: deleteObject is called once with the row's key", async () => {
    await assertRemoveDeletesTheRowsKey();
  });

  it("the audit row carries the asset's organizationId and the tenant transaction as executor", async () => {
    await assertRemoveAuditCarriesTheOrganizationAndTheTx();
  });

  it("the audit row is master.asset_image.delete on asset_image with the image id", async () => {
    await assertRemoveAuditNamesTheActionEntityAndImage();
  });

  it("a failed object delete after the commit still resolves (decision 11)", async () => {
    await assertRemoveObjectFailureStillResolves();
  });

  it("a failed object delete warns once, naming the image id, err.name and the orphan", async () => {
    await assertRemoveObjectFailureWarnsOnceNamingTheImageId();
  });

  it("the orphan warn never carries the key", async () => {
    await assertRemoveObjectFailureWarnNeverCarriesTheKey();
  });
});
