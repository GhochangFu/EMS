import { describe, it } from "vitest";

import {
  aNoteWhenTheCrossingComesBeforeTheDueDay,
  anAssetIsAssembledIntoTheContract,
  anAssetWithNothingReportedIsAbsent,
  assetsAreOrdered,
  dueDaysUseThePanelsCeil,
  indicatorsAreOrderedAndTheNearestIsFirst,
  notesAreByDueDateAndOnlyTheAssetsOwn,
  notesChangeNothingElse,
} from "./degradation-rank.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — assembly, order and the schedule note (ADR 0138, plan §4.7, §4.8)", () => {
  it("an asset is assembled into the contract shape and parses", () => anAssetIsAssembledIntoTheContract());
  it("an asset with no reported indicator is absent", () => anAssetWithNothingReportedIsAbsent());
  it("indicators are ordered; the nearest is the first crossing", () => indicatorsAreOrderedAndTheNearestIsFirst());
  it("assets are ordered: crossings by nearest range, then beyond-only by label", () => assetsAreOrdered());
  it("due in 60 days against min 13 → one note; due in 5 → none", () => aNoteWhenTheCrossingComesBeforeTheDueDay());
  it("due days use the panel's ceil; min < due strictly", () => dueDaysUseThePanelsCeil());
  it("notes are by due date and only the asset's own", () => notesAreByDueDateAndOnlyTheAssetsOwn());
  it("with and without notes the asset is otherwise deep-equal", () => notesChangeNothingElse());
});
