import { describe, it } from "vitest";

import {
  assertAHeaderThrowDestroysTheBodyAndPropagates,
  assertControllerIsGuardedByJwtOnTheReportsPrefix,
  assertDownloadPipelinesTheBodyToRes,
  assertDownloadReachesTheServiceOnceAndStreamsTheBytes,
  assertDownloadRefusesANonUuidIdBeforeTheService,
  assertDownloadSetsEveryHeaderBeforeThePipeline,
  assertDownloadSetsHeader,
  assertDownloadSourceSetsHeader,
  assertDownloadWarnsInThePipelineCallback,
  assertListCoercesAnExplicitLimit,
  assertListDefaultsTheLimitTo50,
  assertListRefusesALimitOverTheMax,
  assertNoHandlerArgumentIsNamedKey,
  assertRemoveAnswers204,
  assertRemoveHandsTheParsedIdToTheService,
  assertRegistryKeysNameRealHandlers,
  assertRemoveRefusesANonUuidIdBeforeTheService,
  assertSaveAcceptsTheLastDayOfFebruary,
  assertSaveAnswers201,
  assertSaveHandsTheParsedBodyAndTheJwtToTheService,
  assertSaveParsesBeforeTheService,
  assertSaveRefusesACalendarInvalidDateBeforeTheService,
  assertSaveRefusesAnUnknownKeyBeforeTheService,
  assertScanFindsAParamDecorator,
  DOWNLOAD_HEADER_LITERALS,
  DOWNLOAD_HEADERS,
  HEADER_COUNT,
} from "./report-files.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (§4.6). */
describe("F3.5a — ReportFilesController (ADR 0071 decision 11)", () => {
  describe("download: the five headers on the response", () => {
    for (const [name, expected] of DOWNLOAD_HEADERS) {
      it(`sets ${name}: ${expected}`, async () => {
        await assertDownloadSetsHeader(name, expected);
      });
    }

    it("positive control: reaches the service once with the JWT and the id, and streams the bytes", async () => {
      await assertDownloadReachesTheServiceOnceAndStreamsTheBytes();
    });

    it("refuses a non-uuid id with a 400 before the service", async () => {
      await assertDownloadRefusesANonUuidIdBeforeTheService();
    });

    for (let call = 1; call <= HEADER_COUNT; call += 1) {
      it(`destroys the body when header call ${call} throws, and propagates the throw`, async () => {
        await assertAHeaderThrowDestroysTheBodyAndPropagates(call);
      });
    }
  });

  describe("download: the scan", () => {
    for (const literal of DOWNLOAD_HEADER_LITERALS) {
      it(`spells ${literal}`, () => {
        assertDownloadSourceSetsHeader(literal);
      });
    }

    it("sets every header before the pipeline call", () => {
      assertDownloadSetsEveryHeaderBeforeThePipeline();
    });

    it("pipelines the body to @Res(), never body.pipe(res)", () => {
      assertDownloadPipelinesTheBodyToRes();
    });

    it("warns naming the file id in the pipeline callback", () => {
      assertDownloadWarnsInThePipelineCallback();
    });
  });

  describe("save", () => {
    it("refuses an unknown body key with a 400 before the service (.strict())", async () => {
      await assertSaveRefusesAnUnknownKeyBeforeTheService();
    });

    it("positive control: hands the parsed body and the JWT to the service", async () => {
      await assertSaveHandsTheParsedBodyAndTheJwtToTheService();
    });

    it("refuses a calendar-invalid startDate (2026-02-30) with a 400 naming the field, before the service", async () => {
      await assertSaveRefusesACalendarInvalidDateBeforeTheService("startDate", "2026-02-30");
    });

    it("refuses a calendar-invalid endDate (2026-02-30) with a 400 naming the field, before the service", async () => {
      await assertSaveRefusesACalendarInvalidDateBeforeTheService("endDate", "2026-02-30");
    });

    it("refuses an Invalid-Date month (2026-13-01) with a 400, not a RangeError", async () => {
      await assertSaveRefusesACalendarInvalidDateBeforeTheService("startDate", "2026-13-01");
    });

    it("positive control: accepts 2026-02-28 and hands it to the service unchanged", async () => {
      await assertSaveAcceptsTheLastDayOfFebruary();
    });

    it("answers 201", () => {
      assertSaveAnswers201();
    });

    it("parses before it calls the service (scan)", () => {
      assertSaveParsesBeforeTheService();
    });
  });

  describe("list", () => {
    it("refuses limit=500 with a 400 before the service", async () => {
      await assertListRefusesALimitOverTheMax();
    });

    it("defaults the limit to 50", async () => {
      await assertListDefaultsTheLimitTo50();
    });

    it("positive control: coerces an explicit limit", async () => {
      await assertListCoercesAnExplicitLimit();
    });
  });

  describe("remove", () => {
    it("hands the parsed id and the JWT to the service", async () => {
      await assertRemoveHandsTheParsedIdToTheService();
    });

    it("refuses a non-uuid id with a 400 before the service", async () => {
      await assertRemoveRefusesANonUuidIdBeforeTheService();
    });

    it("answers 204", () => {
      assertRemoveAnswers204();
    });
  });

  describe("decision 4 and the guard", () => {
    it("has no handler argument named key or objectKey", () => {
      assertNoHandlerArgumentIsNamedKey();
    });

    it("positive control: the scan finds a @Param() decorator", () => {
      assertScanFindsAParamDecorator();
    });

    it("registers save and list under keys that name real handlers (ADR 0029)", () => {
      assertRegistryKeysNameRealHandlers();
    });

    it("carries @UseGuards(JwtAuthGuard) on the reports prefix", () => {
      assertControllerIsGuardedByJwtOnTheReportsPrefix();
    });
  });
});
