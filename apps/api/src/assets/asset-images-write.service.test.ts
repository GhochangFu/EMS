import { describe, it } from "vitest";

import {
  assertAnUnreadableCountMakesNoStorageCall,
  assertAnUnreadableCountRejectsConflict,
  assertBlindedFleetReadIsReachedWhenConfigured,
  assertCleanupFailureStillThrowsTheOriginalError,
  assertCleanupFailureWarnNeverCarriesTheKey,
  assertCleanupFailureWarnsOnceNamingTheImageIdAndErrorName,
  assertDeclaredTextPlainMakesNoStorageCall,
  assertDeclaredTextPlainRejectsBadRequest,
  assertDeclaredTypeRefusalNeverEchoesTheDeclaredString,
  assertEmptyBufferRejectsBadRequest,
  assertFleetPreCountAtCapMakesNoStorageCall,
  assertFleetPreCountAtCapRejectsConflict,
  assertInsertFailureDeletesTheKeyItPut,
  assertInsertFailurePutsThenDeletesTheObject,
  assertInsertFailureRethrowsByName,
  assertOversizeBufferRejectsPayloadTooLarge,
  assertPngBytesDeclaredJpegMakesNoStorageCall,
  assertPngBytesDeclaredJpegRejectsMismatch,
  assertPngBytesDeclaredPngReachPutObjectOnce,
  assertPutFailureOpensNoTenantTransaction,
  assertPutFailureRejectsServiceUnavailable,
  assertPutFailureWarnAndResponseNeverCarryTheKey,
  assertPutFailureWarnNamesTheImageIdAndErrorName,
  assertTenantCountAtCapPutsThenDeletesTheObject,
  assertTenantCountAtCapRejectsConflict,
  assertUnconfiguredRemoveRejectsServiceUnavailable,
  assertUnconfiguredUploadRejectsServiceUnavailable,
  assertUnconfiguredUploadTouchesNoPool,
  assertUnrecognisedBytesRejectBadRequest,
  assertUploadAuditCarriesTheAssetOrganizationAndTheTx,
  assertUploadAuditNamesTheActionEntityAndImage,
  assertUploadAuditPayloadCarriesNoFilenameOrCaption,
  assertUploadDtoByteSizeIsTheBufferLength,
  assertUploadDtoCarriesTheInsertedId,
  assertUploadDtoContentTypeIsTheSniffedType,
  assertUploadDtoHasNoObjectKey,
  assertUploadDtoSha256IsTheBufferHash,
  assertUploadPutsTheObjectBeforeTheTransactionCommits,
  assertUploadStoresTheResolvedActorAsCreatedBy,
  assertVanishedAssetUnderForUpdateRejectsNotFound,
} from "./asset-images-write.service.spec";

/**
 * F3.4 (ADR 0066 Amendment 3, R-1..R-6) — Vitest entry point for
 * `AssetImagesWriteService.upload` over fakes. Assertions live in the sibling
 * `.spec` (§4.6/ADR 0014); this file only runs them. The `remove` rows are
 * `asset-images-remove.service.test.ts`.
 */
describe("F3.4 — AssetImagesWriteService.upload over fakes", () => {
  it("upload rejects ServiceUnavailableException when unconfigured", async () => {
    await assertUnconfiguredUploadRejectsServiceUnavailable();
  });

  it("upload touches no pool when unconfigured", async () => {
    await assertUnconfiguredUploadTouchesNoPool();
  });

  it("the blinded fleet read is reached once when configured (positive control)", async () => {
    await assertBlindedFleetReadIsReachedWhenConfigured();
  });

  it("remove rejects ServiceUnavailableException when unconfigured, before any pool read", async () => {
    await assertUnconfiguredRemoveRejectsServiceUnavailable();
  });

  it("a declared text/plain rejects BadRequestException", async () => {
    await assertDeclaredTextPlainRejectsBadRequest();
  });

  it("a declared text/plain makes no storage call", async () => {
    await assertDeclaredTextPlainMakesNoStorageCall();
  });

  it("the declared-type 400 is the fixed sentence and never echoes the declared string", async () => {
    await assertDeclaredTypeRefusalNeverEchoesTheDeclaredString();
  });

  it("PNG bytes declared image/jpeg reject a 400 that says does not match", async () => {
    await assertPngBytesDeclaredJpegRejectsMismatch();
  });

  it("PNG bytes declared image/jpeg make no storage call", async () => {
    await assertPngBytesDeclaredJpegMakesNoStorageCall();
  });

  it("the same PNG bytes declared image/png reach putObject once (positive control)", async () => {
    await assertPngBytesDeclaredPngReachPutObjectOnce();
  });

  it("bytes with no image signature reject a 400 that says not a JPEG, with no storage call", async () => {
    await assertUnrecognisedBytesRejectBadRequest();
  });

  it("an empty buffer rejects 400 Image file is required, with no storage call", async () => {
    await assertEmptyBufferRejectsBadRequest();
  });

  it("MAX_ASSET_IMAGE_BYTES + 1 bytes reject PayloadTooLargeException, with no storage call", async () => {
    await assertOversizeBufferRejectsPayloadTooLarge();
  });

  it("a fleet pre-count at the cap rejects ConflictException naming the cap", async () => {
    await assertFleetPreCountAtCapRejectsConflict();
  });

  it("a fleet pre-count at the cap makes no storage call", async () => {
    await assertFleetPreCountAtCapMakesNoStorageCall();
  });

  it("a count that reads back as NaN rejects ConflictException (the compare is fail-closed)", async () => {
    await assertAnUnreadableCountRejectsConflict();
  });

  it("a count that reads back as NaN makes no storage call", async () => {
    await assertAnUnreadableCountMakesNoStorageCall();
  });

  it("a tenant-transaction count at the cap (the race) rejects ConflictException", async () => {
    await assertTenantCountAtCapRejectsConflict();
  });

  it("a tenant-transaction count at the cap puts, then deletes, the object (the delta)", async () => {
    await assertTenantCountAtCapPutsThenDeletesTheObject();
  });

  it("an asset that vanished under FOR UPDATE rejects NotFoundException after put and cleanup", async () => {
    await assertVanishedAssetUnderForUpdateRejectsNotFound();
  });

  it("an insert failure is rethrown by name", async () => {
    await assertInsertFailureRethrowsByName();
  });

  it("an insert failure puts, then deletes, the object (the delta)", async () => {
    await assertInsertFailurePutsThenDeletesTheObject();
  });

  it("the cleanup deletes the exact key putObject wrote", async () => {
    await assertInsertFailureDeletesTheKeyItPut();
  });

  it("a failed cleanup still throws the original error", async () => {
    await assertCleanupFailureStillThrowsTheOriginalError();
  });

  it("a failed cleanup warns once, naming the image id and err.name", async () => {
    await assertCleanupFailureWarnsOnceNamingTheImageIdAndErrorName();
  });

  it("the cleanup warn never carries the key (the F4.145 positive control)", async () => {
    await assertCleanupFailureWarnNeverCarriesTheKey();
  });

  it("a put failure rejects 503 Object storage is unreachable", async () => {
    await assertPutFailureRejectsServiceUnavailable();
  });

  it("a put failure opens no tenant transaction", async () => {
    await assertPutFailureOpensNoTenantTransaction();
  });

  it("the put-failure warn names the image id and err.name", async () => {
    await assertPutFailureWarnNamesTheImageIdAndErrorName();
  });

  it("neither the put-failure warn nor the 503 carries the key", async () => {
    await assertPutFailureWarnAndResponseNeverCarryTheKey();
  });

  it("the upload DTO carries the inserted id (positive control)", async () => {
    await assertUploadDtoCarriesTheInsertedId();
  });

  it("the upload DTO has no objectKey", async () => {
    await assertUploadDtoHasNoObjectKey();
  });

  it("the upload DTO's sha256 is the buffer's hash", async () => {
    await assertUploadDtoSha256IsTheBufferHash();
  });

  it("the upload DTO's contentType is the sniffed type", async () => {
    await assertUploadDtoContentTypeIsTheSniffedType();
  });

  it("the upload DTO's byteSize is the buffer's length", async () => {
    await assertUploadDtoByteSizeIsTheBufferLength();
  });

  it("createdBy is the actor resolved on the fleet pool", async () => {
    await assertUploadStoresTheResolvedActorAsCreatedBy();
  });

  it("the object is put before the one tenant transaction commits, with no warn", async () => {
    await assertUploadPutsTheObjectBeforeTheTransactionCommits();
  });

  it("the audit row carries the asset's organizationId and the tenant transaction as executor", async () => {
    await assertUploadAuditCarriesTheAssetOrganizationAndTheTx();
  });

  it("the audit row is master.asset_image.create on asset_image with the image id", async () => {
    await assertUploadAuditNamesTheActionEntityAndImage();
  });

  it("the audit payload carries ids and the type, never the filename or the caption", async () => {
    await assertUploadAuditPayloadCarriesNoFilenameOrCaption();
  });
});
