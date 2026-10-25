// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aMalformedMovesValueListsNothing,
  anAckCardIsRedAndCannotBeUndone,
  eachMoveIsOneLineWithItsOldAndNewPosition,
  theSentBodyHasNoMoves,
} from "./confirm-card.operations.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.284 — the reorder card's moves and the operational card (ADR 0106, DC2)", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists each move with its old and new position", () => eachMoveIsOneLineWithItsOldAndNewPosition());
  it("lists nothing for a malformed moves value", () => aMalformedMovesValueListsNothing());
  it("sends the body without the card-only moves", () => theSentBodyHasNoMoves());
  it("renders an acknowledge card red with the cannot-be-undone line", () => anAckCardIsRedAndCannotBeUndone());
});
