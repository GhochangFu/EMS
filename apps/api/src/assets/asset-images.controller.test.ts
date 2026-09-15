import { describe, it } from "vitest";

import {
  assertABodyErrorAfterHeadersWarnsWithTheImageId,
  assertAllowedContentCallsTheServiceOnceAndStreamsTheBytes,
  assertAllowedContentSendsNosniff,
  assertAllowedListCallsTheServiceOnce,
  assertBothHandlersRefuseWithTheScopeMessage,
  assertContentChecksAccessBeforeTheService,
  assertContentHandlerTakesRes,
  assertContentPipelinesTheBodyToRes,
  assertContentRouteIsDeclaredAtALineStart,
  assertContentSetsContentLengthFromTheRow,
  assertContentSetsEveryHeaderBeforeThePipeline,
  assertContentSetsHeader,
  assertContentWarnsInThePipelineCallback,
  assertControllerDoesNotHandleIfNoneMatch,
  assertControllerIsGuardedByJwt,
  assertDeniedHandlerNeverCallsTheService,
  assertDeniedHandlerThrowsForbidden,
  assertListChecksAccessBeforeTheService,
  assertListHandlerDoesNotTakeRes,
  assertNoHandlerArgumentIsNamedKey,
  assertScanFindsBothHandlers,
  assertScanFindsTheAssetIdParam,
  DECISION_6_HEADERS,
  HANDLERS,
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

  it("content pipelines the body to res, never body.pipe(res)", () => {
    assertContentPipelinesTheBodyToRes();
  });

  it("content sets every header before the pipeline call", () => {
    assertContentSetsEveryHeaderBeforeThePipeline();
  });

  it("content warns with the image id in the pipeline callback", () => {
    assertContentWarnsInThePipelineCallback();
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

describe("F3.3 — asset-images controller over stubs (the guard, measured)", () => {
  it.each(HANDLERS)("%s throws ForbiddenException when canReadAsset is false", async (handler) => {
    await assertDeniedHandlerThrowsForbidden(handler);
  });

  it.each(HANDLERS)("%s never calls the service when canReadAsset is false", async (handler) => {
    await assertDeniedHandlerNeverCallsTheService(handler);
  });

  it("list calls the service once when allowed (positive control)", async () => {
    await assertAllowedListCallsTheServiceOnce();
  });

  it("content calls the service once when allowed and streams the bytes (positive control)", async () => {
    await assertAllowedContentCallsTheServiceOnceAndStreamsTheBytes();
  });

  it("content sends X-Content-Type-Options: nosniff", async () => {
    await assertAllowedContentSendsNosniff();
  });

  it("a body error after the headers warns once, naming the image id and never err.message", async () => {
    await assertABodyErrorAfterHeadersWarnsWithTheImageId();
  });
});
