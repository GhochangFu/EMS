import { describe, it } from "vitest";

import {
  aBadPointKeyOrUnitIsNotSendable,
  aCardWithNothingToSayIsNotSendable,
  aChangedNumberOrderOrKindGivesAnotherHash,
  anAssetNamedTwiceKeepsOnePlaceholder,
  restoreTurnsPlaceholdersBackIntoSegments,
  theCanonicalTextHoldsNoNameAndNoUuid,
  theSameCardGivesTheSameHash,
} from "./findings-pseudonymise.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — pseudonymise the findings facts (ADR 0135 Amendment 8)", () => {
  it("the same card gives the same hash", () => theSameCardGivesTheSameHash());
  it("a changed number, asset order or kind gives another hash", () => aChangedNumberOrderOrKindGivesAnotherHash());
  it("the canonical text holds no fixture name and no UUID", () => theCanonicalTextHoldsNoNameAndNoUuid());
  it("an asset named twice keeps one placeholder", () => anAssetNamedTwiceKeepsOnePlaceholder());
  it("a bad point key or unit is not sendable", () => aBadPointKeyOrUnitIsNotSendable());
  it("a card with nothing to say is not sendable", () => aCardWithNothingToSayIsNotSendable());
  it("restore turns placeholders back into segments", () => restoreTurnsPlaceholdersBackIntoSegments());
});
