import { describe, it } from "vitest";

import {
  assertAbsentBodyBecomesNullCaption,
  assertAllowedRemoveCallsTheServiceWithBothIds,
  assertAllowedUploadCallsTheServiceOnce,
  assertAllowedUploadPassesANonEmptyCaption,
  assertAllowedUploadPassesTheBufferAndFilename,
  assertAllowedUploadPassesTheMimetypeAsDeclaredType,
  assertBlankCaptionBecomesNull,
  assertBothHandlersRefuseWithTheScopeMessage,
  assertControllerIsGuardedByJwt,
  assertCreatedPrecedesUpload,
  assertDeleteRouteIsDeclaredAtALineStart,
  assertDeniedHandlerNeverCallsTheService,
  assertDeniedHandlerThrowsForbidden,
  assertDeniedUploadRefusesBeforeRequireFile,
  assertEmptyFileIsBadRequest,
  assertFileInterceptorCallDeclaresLimits,
  assertFileInterceptorFieldIsFile,
  assertFileInterceptorIsSpelledOnceAsACall,
  assertFileInterceptorLimit,
  assertMissingFileIsBadRequest,
  assertMissingFileNeverCallsTheService,
  assertNoContentPrecedesRemove,
  assertNoHandlerArgumentIsNamedKey,
  assertNonUuidAssetIdRejectsBeforeTheGuard,
  assertOverlongCaptionEscapesAsZodError,
  assertOverlongFilenameEscapesAsZodError,
  assertPostRouteIsDeclaredAtALineStart,
  assertRemoveChecksAccessBeforeTheService,
  assertRemoveWithANonUuidImageIdRejectsBeforeTheGuard,
  assertScanFindsBothHandlers,
  assertScanFindsTheAssetIdParam,
  assertUnknownFieldEscapesAsZodError,
  assertUploadChecksAccessBeforeRequireFile,
  assertUploadChecksAccessBeforeTheService,
  HANDLERS,
  INTERCEPTOR_LIMITS,
} from "./asset-images-write.controller.spec";

/**
 * F3.4 (ADR 0066 decision 7, Amendment 3 R-8/R-9) — Vitest entry point for
 * the asset-image write controller source scan and its stub behaviour.
 * Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file only
 * runs them.
 */
describe("F3.4 — asset-images write controller source scan", () => {
  it("the scan finds both handlers (positive control)", () => {
    assertScanFindsBothHandlers();
  });

  it("upload checks canManageAsset before calling the service", () => {
    assertUploadChecksAccessBeforeTheService();
  });

  it("upload checks canManageAsset before requireFile", () => {
    assertUploadChecksAccessBeforeRequireFile();
  });

  it("remove checks canManageAsset before calling the service", () => {
    assertRemoveChecksAccessBeforeTheService();
  });

  it("both handlers refuse with the asset-health 403 message", () => {
    assertBothHandlersRefuseWithTheScopeMessage();
  });

  it("declares @Post() at a line start", () => {
    assertPostRouteIsDeclaredAtALineStart();
  });

  it('declares @Delete(":imageId") at a line start', () => {
    assertDeleteRouteIsDeclaredAtALineStart();
  });

  it("the controller is JWT-guarded under assets/:assetId/images", () => {
    assertControllerIsGuardedByJwt();
  });

  it("@HttpCode(HttpStatus.CREATED) precedes async upload(", () => {
    assertCreatedPrecedesUpload();
  });

  it("@HttpCode(HttpStatus.NO_CONTENT) sits between async upload( and async remove(", () => {
    assertNoContentPrecedesRemove();
  });

  it("the FileInterceptor call declares limits (positive control)", () => {
    assertFileInterceptorCallDeclaresLimits();
  });

  it.each(INTERCEPTOR_LIMITS)("the FileInterceptor call carries %s inline", (literal) => {
    assertFileInterceptorLimit(literal);
  });

  it("FileInterceptor( is spelled exactly once in the file, so the f4.102 scan reads the call and nothing else", () => {
    assertFileInterceptorIsSpelledOnceAsACall();
  });

  it('the FileInterceptor reads the "file" field', () => {
    assertFileInterceptorFieldIsFile();
  });

  it("no handler argument is named key or objectKey", () => {
    assertNoHandlerArgumentIsNamedKey();
  });

  it('the key scan does find @Param("assetId") (positive control)', () => {
    assertScanFindsTheAssetIdParam();
  });
});

describe("F3.4 — asset-images write controller over stubs (the guard, measured)", () => {
  it.each(HANDLERS)("%s throws ForbiddenException when canManageAsset is false", async (handler) => {
    await assertDeniedHandlerThrowsForbidden(handler);
  });

  it.each(HANDLERS)("%s never calls the service when canManageAsset is false", async (handler) => {
    await assertDeniedHandlerNeverCallsTheService(handler);
  });

  it("a denied upload without a file is a 403, not requireFile's 400", async () => {
    await assertDeniedUploadRefusesBeforeRequireFile();
  });

  it("a non-uuid assetId escapes as ZodError before the guard and the service", async () => {
    await assertNonUuidAssetIdRejectsBeforeTheGuard();
  });

  it("upload calls the service once when allowed and returns its DTO (positive control)", async () => {
    await assertAllowedUploadCallsTheServiceOnce();
  });

  it("upload passes file.mimetype as declaredType", async () => {
    await assertAllowedUploadPassesTheMimetypeAsDeclaredType();
  });

  it("upload passes file.buffer and file.originalname through", async () => {
    await assertAllowedUploadPassesTheBufferAndFilename();
  });

  it("upload passes a non-empty caption unchanged (positive control)", async () => {
    await assertAllowedUploadPassesANonEmptyCaption();
  });

  it('upload maps caption "" to null', async () => {
    await assertBlankCaptionBecomesNull();
  });

  it("upload maps an absent body to caption null", async () => {
    await assertAbsentBodyBecomesNullCaption();
  });

  it('a missing file is a BadRequestException saying "Image file is required"', async () => {
    await assertMissingFileIsBadRequest();
  });

  it("a missing file never calls the service", async () => {
    await assertMissingFileNeverCallsTheService();
  });

  it("an empty file is a BadRequestException and never calls the service", async () => {
    await assertEmptyFileIsBadRequest();
  });

  it("a 1001-char caption escapes as ZodError and never calls the service", async () => {
    await assertOverlongCaptionEscapesAsZodError();
  });

  it("a 256-char filename escapes as ZodError and never calls the service", async () => {
    await assertOverlongFilenameEscapesAsZodError();
  });

  it("an unknown non-file field escapes as ZodError and never calls the service", async () => {
    await assertUnknownFieldEscapesAsZodError();
  });

  it("remove calls the service once with both ids when allowed (positive control)", async () => {
    await assertAllowedRemoveCallsTheServiceWithBothIds();
  });

  it("remove with a non-uuid imageId escapes as ZodError before the guard and the service", async () => {
    await assertRemoveWithANonUuidImageIdRejectsBeforeTheGuard();
  });
});
