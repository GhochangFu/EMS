// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  createSendsTrimmedNameNullDomainAndItems,
  editSendsTheWholeReorderedList,
  emptyListSaysSo,
  failsClosedForOtherRoles,
  listShowsTheTemplatesActiveFirst,
  refusalShowsTheServersSentence,
  retireAndRestoreSendTheActiveFlag,
  saveGuardsAndCancel,
} from "./work-order-checklist-templates-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the
 * jsdom docblock is here because this is the file Vitest collects (ADR 0042).
 */
describe("E3.1 Checklist Templates admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails closed for a location_admin and an operator: the sentence, no request", async () => {
    await failsClosedForOtherRoles();
  });

  it("lists templates with domain, item count and Retired marker, active first", async () => {
    await listShowsTheTemplatesActiveFirst();
  });

  it("says so when there are no templates", async () => {
    await emptyListSaysSo();
  });

  it("create sends the trimmed name, domain null and the items in order", async () => {
    await createSendsTrimmedNameNullDomainAndItems();
  });

  it("edit sends the whole list in its reordered form", async () => {
    await editSendsTheWholeReorderedList();
  });

  it("Save is guarded, the last item stays, Cancel sends nothing", async () => {
    await saveGuardsAndCancel();
  });

  it("Retire sends active false and Restore active true", async () => {
    await retireAndRestoreSendTheActiveFlag();
  });

  it("a refusal shows the server's sentence", async () => {
    await refusalShowsTheServersSentence();
  });
});
