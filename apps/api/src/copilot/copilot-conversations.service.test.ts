import { describe, it } from "vitest";

import {
  assertAFullPageIsOldestFirst,
  assertAMissingCursorThrows,
  assertAnExactPageHasNoEarlier,
  assertAnUnpagedReadKeepsTheOldShape,
  assertAPagedReadAsksOneRowMore,
  assertARowOverThePageSetsHasEarlier,
  assertCreateInsertsTheCallerAndTheBinding,
  assertGetReturnsNullOrTheDetail,
  assertNoUserLineTitlesNothing,
  assertOrganizationExistsReadsTheLookup,
  assertTheListIsBounded,
  assertTheTitleIsCutAt200,
  assertTheTitleCutKeepsASurrogatePairWhole,
  assertTheTitleIsTheFirstUserLine,
  assertTheTitleSkipsABlankLine,
  assertTheTitleSkipsAnAttachmentRecord,
} from "./copilot-conversations.service.spec";

describe("F3.85 — CopilotConversationsService (ADR 0099 decision 8, plan section 7 PR 5)", () => {
  it("create inserts the caller and the binding in one withUser transaction", () =>
    assertCreateInsertsTheCallerAndTheBinding());
  it("the list passes COPILOT_CONVERSATION_LIST_LIMIT to the query", () => assertTheListIsBounded());
  it("get returns null for a hidden conversation and the mapped detail otherwise", () =>
    assertGetReturnsNullOrTheDetail());
  it("organizationExists answers from the organization lookup", () => assertOrganizationExistsReadsTheLookup());
});

describe("F4.292 — the paged read and the title (ADR 0099 Amendment 9 E7)", () => {
  it("a paged read asks the query for limit + 1 rows", () => assertAPagedReadAsksOneRowMore());
  it("a full page comes back oldest first", () => assertAFullPageIsOldestFirst());
  it("a row over the page sets hasEarlier", () => assertARowOverThePageSetsHasEarlier());
  it("an exact page has no earlier", () => assertAnExactPageHasNoEarlier());
  it("a read with no page keeps the old shape", () => assertAnUnpagedReadKeepsTheOldShape());
  it("a before the lookup misses throws CopilotCursorNotFoundError", () => assertAMissingCursorThrows());
  it("the title is the first user line, trimmed", () => assertTheTitleIsTheFirstUserLine());
  it("the title is cut at 200 characters", () => assertTheTitleIsCutAt200());
  it("the title cut keeps a surrogate pair whole", () => assertTheTitleCutKeepsASurrogatePairWhole());
  it("the title skips an attachment record line", () => assertTheTitleSkipsAnAttachmentRecord());
  it("the title skips a blank line", () => assertTheTitleSkipsABlankLine());
  it("a turn with no user line titles nothing", () => assertNoUserLineTitlesNothing());
});
