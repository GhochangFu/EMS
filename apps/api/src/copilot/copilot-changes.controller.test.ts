import { describe, it } from "vitest";

import {
  aChangeThatIsNotPendingIs409,
  aChangeWithoutAConversationStoresNoLine,
  aMalformedIdIs409WithoutAQuery,
  aPendingChangeIsRejectedWithAnActionLine,
} from "./copilot-changes.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — POST /copilot/changes/:id/reject (ADR 0099 decision 4)", () => {
  it("rejects a pending change and stores one action line", () => aPendingChangeIsRejectedWithAnActionLine());
  it("answers 409 for a change that is not pending", () => aChangeThatIsNotPendingIs409());
  it("answers 409 for a malformed id without a query", () => aMalformedIdIs409WithoutAQuery());
  it("stores no line for a change without a conversation", () => aChangeWithoutAConversationStoresNoLine());
});
