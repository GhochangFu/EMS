import { describe, it } from "vitest";

import {
  aPointKeyNarrowsTheList,
  aTenantAdministratorIsRefusedBeforeTheRead,
  listsEveryRowByKeyThenValue,
  theDescriptionSaysASeededRowIsReadOnly,
  aSmallListAnswersEveryRow,
  controlCharacterLabelsFitTheBudget,
  quotedLabelsFitTheBudgetAndSayTruncated,
  theServicesRowsAreParsed,
  theToolTakesOnlyAPointKey,
} from "./point-key-state-read-tools.spec";

/** `F4.309` PR 3 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.309 PR 3 — list_point_key_states (ADR 0099 Amendment 13 decision 3, ruling Q1)", () => {
  it("lists every row's id, key, value, label, tone and seeded, by key then value", () => listsEveryRowByKeyThenValue());
  it("refuses a tenant administrator before the read", () => aTenantAdministratorIsRefusedBeforeTheRead());
  it("narrows to one point key", () => aPointKeyNarrowsTheList());
  it("answers every row of a list that fits, truncated false", () => aSmallListAnswersEveryRow());
  it("keeps as many quoted-label rows as fit, as parseable JSON under the cut, truncated", () =>
    quotedLabelsFitTheBudgetAndSayTruncated());
  it("keeps control-character labels on the longest key parseable under the cut, truncated", () =>
    controlCharacterLabelsFitTheBudget());
  it("parses the service's rows through the guarded parse", () => theServicesRowsAreParsed());
  it("takes only an optional pointKey", () => theToolTakesOnlyAPointKey());
  it("says in its description that a seeded row is read-only", () => theDescriptionSaysASeededRowIsReadOnly());
});
