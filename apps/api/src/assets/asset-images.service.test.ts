import { describe, it } from "vitest";

import {
  assertARowOutsideTheContentTypeEnumThrows,
  assertBlindedFleetReadIsReachedWhenConfigured,
  assertContentIsServedWhenTheLengthIs,
  assertContentLengthMismatchRejectsNotFound,
  assertContentLengthMismatchWarnNamesTheImageIdAndBothNumbers,
  assertContentLengthMismatchWarnNeverCarriesTheKey,
  SERVED_CONTENT_LENGTHS,
  assertContentReturnsTheDtoAndTheBody,
  assertContentWithNoObjectAskedStorageForTheRowsKey,
  assertContentWithNoObjectRejectsNotFound,
  assertContentWithNoObjectWarnNamesTheImageId,
  assertContentWithNoObjectWarnNeverCarriesTheKey,
  assertContentWithNoObjectWarnsOnce,
  assertContentWithNoRowNeverReachesStorage,
  assertContentWithNoRowRejectsNotFound,
  assertListAnswersEmptyWhenTheAssetResolvesToNoOrganization,
  assertListDtoCarriesTheId,
  assertListDtoHasNoObjectKey,
  assertListDtoNeverCarriesTheKeyValue,
  assertListReturnsOneDtoPerRow,
  assertListRunsInsideTheTenantTransaction,
  assertListSerialisesCreatedAtAsIso,
  assertTransportErrorMessageIsUnreachable,
  assertTransportErrorRejectsServiceUnavailable,
  assertTransportErrorResponseNeverCarriesTheKey,
  assertTransportErrorWarnNamesTheImageIdAndTheErrorName,
  assertTransportErrorWarnNeverCarriesTheKey,
  assertUnconfiguredMessageNamesTheVariable,
  assertUnconfiguredRejectsServiceUnavailable,
  assertUnconfiguredTouchesNoPool,
  SERVICE_METHODS,
} from "./asset-images.service.spec";

/**
 * F3.3 (ADR 0066 decisions 3, 4; Amendment 1 Q-F) — Vitest entry point for
 * `AssetImagesService` over fakes. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.3 — AssetImagesService over fakes", () => {
  it.each(SERVICE_METHODS)("%s rejects with ServiceUnavailableException when unconfigured", async (method) => {
    await assertUnconfiguredRejectsServiceUnavailable(method);
  });

  it.each(SERVICE_METHODS)("%s's 503 names OBJECT_STORAGE_ENDPOINT", async (method) => {
    await assertUnconfiguredMessageNamesTheVariable(method);
  });

  it.each(SERVICE_METHODS)("%s touches no pool when unconfigured", async (method) => {
    await assertUnconfiguredTouchesNoPool(method);
  });

  it("the blinded fleet read is reached once when configured (positive control)", async () => {
    await assertBlindedFleetReadIsReachedWhenConfigured();
  });

  it("list returns one DTO per row", async () => {
    await assertListReturnsOneDtoPerRow();
  });

  it("list's DTO carries the id (positive control)", async () => {
    await assertListDtoCarriesTheId();
  });

  it("list's DTO has no objectKey property", async () => {
    await assertListDtoHasNoObjectKey();
  });

  it("list's DTO never carries the key value", async () => {
    await assertListDtoNeverCarriesTheKeyValue();
  });

  it("list serialises createdAt as an ISO string", async () => {
    await assertListSerialisesCreatedAtAsIso();
  });

  it("list runs inside the tenant transaction", async () => {
    await assertListRunsInsideTheTenantTransaction();
  });

  it("list answers [] with no tenant read when the asset resolves to no organization", async () => {
    await assertListAnswersEmptyWhenTheAssetResolvesToNoOrganization();
  });

  it("content with no row rejects NotFoundException", async () => {
    await assertContentWithNoRowRejectsNotFound();
  });

  it("content with no row never reaches storage", async () => {
    await assertContentWithNoRowNeverReachesStorage();
  });

  it("content with a row and no object rejects NotFoundException", async () => {
    await assertContentWithNoObjectRejectsNotFound();
  });

  it("content with no object warns exactly once", async () => {
    await assertContentWithNoObjectWarnsOnce();
  });

  it("the no-object warn names the image id", async () => {
    await assertContentWithNoObjectWarnNamesTheImageId();
  });

  it("the no-object warn never carries the key", async () => {
    await assertContentWithNoObjectWarnNeverCarriesTheKey();
  });

  it("content asked storage for the row's key (positive control)", async () => {
    await assertContentWithNoObjectAskedStorageForTheRowsKey();
  });

  it("a transport error rejects ServiceUnavailableException", async () => {
    await assertTransportErrorRejectsServiceUnavailable();
  });

  it("a transport error's 503 says Object storage is unreachable", async () => {
    await assertTransportErrorMessageIsUnreachable();
  });

  it("the transport warn names the image id and err.name", async () => {
    await assertTransportErrorWarnNamesTheImageIdAndTheErrorName();
  });

  it("the transport warn never carries the key", async () => {
    await assertTransportErrorWarnNeverCarriesTheKey();
  });

  it("the transport 503 never carries the key", async () => {
    await assertTransportErrorResponseNeverCarriesTheKey();
  });

  it("content returns the DTO and streams the bytes", async () => {
    await assertContentReturnsTheDtoAndTheBody();
  });

  it("a Content-Length that differs from the row's byteSize rejects NotFoundException", async () => {
    await assertContentLengthMismatchRejectsNotFound();
  });

  it("the length-mismatch warn names the image id and both numbers", async () => {
    await assertContentLengthMismatchWarnNamesTheImageIdAndBothNumbers();
  });

  it("the length-mismatch warn never carries the key", async () => {
    await assertContentLengthMismatchWarnNeverCarriesTheKey();
  });

  it.each(SERVED_CONTENT_LENGTHS)("content is served when the object's length is $label", async (scenario) => {
    await assertContentIsServedWhenTheLengthIs(scenario);
  });

  it("a row whose content_type is outside the enum answers the stored-contract 500, never a bare ZodError", async () => {
    await assertARowOutsideTheContentTypeEnumThrows();
  });
});
