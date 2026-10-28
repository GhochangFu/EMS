import { describe, it } from "vitest";

import {
  aLimitOverTheCapIsRefused,
  aNonUuidCursorIsRefused,
  anUnknownQueryKeyIsRefused,
  aPagedDetailCarriesHasEarlier,
  aStringLimitParsesToANumber,
  aZeroLimitIsRefused,
  theListSchemaParsesConversations,
  theOldDetailShapeStillParses,
} from "./copilot-conversation-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.292 — the paged conversation detail contracts (ADR 0099 Amendment 9 E7)", () => {
  it("parses a string limit to a number", () => aStringLimitParsesToANumber());
  it("refuses a limit of 0", () => aZeroLimitIsRefused());
  it("refuses a limit over the cap of 200", () => aLimitOverTheCapIsRefused());
  it("refuses a non-uuid before", () => aNonUuidCursorIsRefused());
  it("refuses an unknown query key", () => anUnknownQueryKeyIsRefused());
  it("carries hasEarlier on a paged detail", () => aPagedDetailCarriesHasEarlier());
  it("still parses a detail without hasEarlier", () => theOldDetailShapeStillParses());
  it("parses the conversation list", () => theListSchemaParsesConversations());
});
