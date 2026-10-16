import { describe, it } from "vitest";

import * as A from "./copilot-propose-attachments.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 7 — the propose rules of a file turn (plan D8, D11)", () => {
  it("D8: a registry without the asset creates names none of the three", () => A.aRegistryWithoutAssetCreatesNamesNone());
  it("D8: an asset create called without the words is refused", () => A.anAssetCreateWithoutTheWordsIsRefused());
  it("D8: an asset create with the words passes the guard", () => A.anAssetCreateWithTheWordsPassesTheGuard());
  it("D11: a layout from a file carries the note", () => A.aLayoutFromAFileCarriesTheNote());
  it("D11: a layout after a file in the history carries the note", () => A.aLayoutAfterAFileInHistoryCarriesTheNote());
  it("D11: a layout without a file has no note", () => A.aLayoutWithoutAFileHasNoNote());
  it("D11: another card from a file has no note", () => A.anotherCardFromAFileHasNoNote());
});
