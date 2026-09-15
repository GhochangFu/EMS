import { describe, it } from "vitest";

import {
  assertBothHandlersRefuseWithTheScopeMessage,
  assertContentChecksAccessBeforeTheService,
  assertContentDestroysTheResponseOnAStreamError,
  assertContentHandlerTakesRes,
  assertContentPipesTheBody,
  assertContentRouteIsDeclaredAtALineStart,
  assertContentSetsContentLengthFromTheRow,
  assertContentSetsHeader,
  assertControllerDoesNotHandleIfNoneMatch,
  assertControllerIsGuardedByJwt,
  assertListChecksAccessBeforeTheService,
  assertListHandlerDoesNotTakeRes,
  assertNoHandlerArgumentIsNamedKey,
  assertScanFindsBothHandlers,
  assertScanFindsTheAssetIdParam,
  DECISION_6_HEADERS,
} from "./asset-images.controller.spec";

/**
 * F3.3 (ADR 0066 decisions 4, 6) — Vitest entry point for the asset-image
 * controller source scan. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.3 — asset-images controller source scan", () => {
  it("the scan finds both handlers (positive control)", () => {
    assertScanFindsBothHandlers();
  });

  it("list checks canReadAsset before calling the service", () => {
    assertListChecksAccessBeforeTheService();
  });

  it("content checks canReadAsset before calling the service", () => {
    assertContentChecksAccessBeforeTheService();
  });

  it("both handlers refuse with the asset-health 403 message", () => {
    assertBothHandlersRefuseWithTheScopeMessage();
  });

  it("declares the content route at a line start", () => {
    assertContentRouteIsDeclaredAtALineStart();
  });

  it("content takes @Res() to stream", () => {
    assertContentHandlerTakesRes();
  });

  it("list does not take @Res()", () => {
    assertListHandlerDoesNotTakeRes();
  });

  it.each(DECISION_6_HEADERS)("content sets %s", (literal) => {
    assertContentSetsHeader(literal);
  });

  it("content sets Content-Length from the row", () => {
    assertContentSetsContentLengthFromTheRow();
  });

  it("content pipes the body", () => {
    assertContentPipesTheBody();
  });

  it("content destroys the response on a stream error", () => {
    assertContentDestroysTheResponseOnAStreamError();
  });

  it("does not handle If-None-Match", () => {
    assertControllerDoesNotHandleIfNoneMatch();
  });

  it("no handler argument is named key or objectKey", () => {
    assertNoHandlerArgumentIsNamedKey();
  });

  it("the key scan does find @Param(\"assetId\") (positive control)", () => {
    assertScanFindsTheAssetIdParam();
  });

  it("the controller is JWT-guarded under assets/:assetId/images", () => {
    assertControllerIsGuardedByJwt();
  });
});
