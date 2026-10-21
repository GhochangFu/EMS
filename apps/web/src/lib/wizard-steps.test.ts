import { describe, it } from "vitest";

import {
  aCreateHasAKeyWithNoParams,
  aFillNeverSetsAPageFixedField,
  aFillSetsAFieldThePageDoesNotFix,
  aFillSetsOnlyTheFreeFieldsBesideAFixedOne,
  aFillThatSetsNoFieldIsNull,
  aMissingParamHasNoKey,
  anExtraParamHasNoKey,
  aValueTheEntryRefusesHasNoKey,
  theKeyIsTheEntryAndItsPath,
  twoEntriesOfOnePathHaveTwoKeys,
  twoRecordsHaveTwoKeys,
} from "./wizard-steps.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — an open wizard's key and its page-fixed fields (ADR 0099 Amendment 4)", () => {
  it("keys a wizard by its entry and its path", () => theKeyIsTheEntryAndItsPath());
  it("gives two entries of one path two keys", () => twoEntriesOfOnePathHaveTwoKeys());
  it("keys a create with no params", () => aCreateHasAKeyWithNoParams());
  it("gives no key for a missing param", () => aMissingParamHasNoKey());
  it("gives no key for an extra param", () => anExtraParamHasNoKey());
  it("gives no key for a value the entry refuses", () => aValueTheEntryRefusesHasNoKey());
  it("gives two records of one entry two keys", () => twoRecordsHaveTwoKeys());
  it("never fills a page-fixed field: a fill of only that field is no change", () => aFillNeverSetsAPageFixedField());
  it("C2: gives null for a fill that sets no field", () => aFillThatSetsNoFieldIsNull());
  it("sets only the free fields beside a page-fixed one", () => aFillSetsOnlyTheFreeFieldsBesideAFixedOne());
  it("fills a field the page does not fix", () => aFillSetsAFieldThePageDoesNotFix());
});
