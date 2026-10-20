import { describe, it } from "vitest";

import {
  aCreateHasAKeyWithNoParams,
  aFillNeverSetsAPageFixedField,
  aFillSetsAFieldThePageDoesNotFix,
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
  it("never fills a page-fixed field", () => aFillNeverSetsAPageFixedField());
  it("fills a field the page does not fix", () => aFillSetsAFieldThePageDoesNotFix());
});
