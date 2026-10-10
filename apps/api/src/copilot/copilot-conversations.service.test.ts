import { describe, it } from "vitest";

import {
  assertCreateInsertsTheCallerAndTheBinding,
  assertGetReturnsNullOrTheDetail,
  assertOrganizationExistsReadsTheLookup,
  assertTheListIsBounded,
} from "./copilot-conversations.service.spec";

describe("F3.85 — CopilotConversationsService (ADR 0099 decision 8, plan section 7 PR 5)", () => {
  it("create inserts the caller and the binding in one withUser transaction", () =>
    assertCreateInsertsTheCallerAndTheBinding());
  it("the list passes COPILOT_CONVERSATION_LIST_LIMIT to the query", () => assertTheListIsBounded());
  it("get returns null for a hidden conversation and the mapped detail otherwise", () =>
    assertGetReturnsNullOrTheDetail());
  it("organizationExists answers from the organization lookup", () => assertOrganizationExistsReadsTheLookup());
});
