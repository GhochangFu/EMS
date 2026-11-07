// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aNewerCopyReadsAsSkippedInPreviewAndResult,
  aPendingBulkSubmitIsDisabledAndBusy,
  cleanupBulkReplace,
  submitCallsTheBulkRouteAndListsTheSkips,
  submitIsAbsentUntilThePreviewIsRead,
  thePreviewListsEachSite,
} from "./replace-site-layouts-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.320 PR 2 Replace existing copies (the apply-to-sites dialog)", () => {
  afterEach(() => {
    cleanupBulkReplace();
  });

  it("D1 lists each site's held copy, edit flag and outcome before the confirm", async () => {
    await thePreviewListsEachSite();
  });

  it("D2 calls the bulk route once and lists the replaced site and each skip's reason", async () => {
    await submitCallsTheBulkRouteAndListsTheSkips();
  });

  it("D3 a pending bulk Submit is disabled and aria-busy", async () => {
    await aPendingBulkSubmitIsDisabledAndBusy();
  });

  it("D4 offers no Submit while the preview loads or after it fails, Cancel only", async () => {
    await submitIsAbsentUntilThePreviewIsRead();
  });

  it("D5 shows a copy newer than the template as a newer_version skip, before and after", async () => {
    await aNewerCopyReadsAsSkippedInPreviewAndResult();
  });
});
