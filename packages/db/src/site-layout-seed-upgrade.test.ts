import { describe, it } from "vitest";

import {
  aMovedWidgetKeepsItsTab,
  anEditedDescriptionIsKept,
  aTabAlreadyAtV2WritesNothing,
  aTabAtItsV1RectsMovesToV2,
  aTemplateRowTheSeedDoesNotOwnIsKept,
  aWidgetTheTemplateDoesNotHoldKeepsItsTab,
  everyTemplateWidgetHasItsOwnIdentity,
  theNewDescriptionNamesNoRowSeedOrDemo,
  theSeedsV1TemplateRowIsSuperseded,
  theV1DescriptionIsReplaced,
  theV1TableNamesExactlyTheTemplateWidgets,
} from "./site-layout-seed-upgrade.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — the SMOC standard site layout's v1 → v2 seed upgrade", () => {
  it("replaces the v1 seed's copy description", () => {
    theV1DescriptionIsReplaced();
  });
  it("keeps an edited copy description", () => {
    anEditedDescriptionIsKept();
  });
  it("writes a description that names no row id, seed or demo", () => {
    theNewDescriptionNamesNoRowSeedOrDemo();
  });
  it("knows each template widget by its own tab, type and title", () => {
    everyTemplateWidgetHasItsOwnIdentity();
  });
  it("holds a v1 rect for exactly the template's widgets", () => {
    theV1TableNamesExactlyTheTemplateWidgets();
  });
  it("moves a tab still at its v1 rects to v2", () => {
    aTabAtItsV1RectsMovesToV2();
  });
  it("keeps a whole tab when one widget was moved", () => {
    aMovedWidgetKeepsItsTab();
  });
  it("keeps a tab holding a widget the template does not", () => {
    aWidgetTheTemplateDoesNotHoldKeepsItsTab();
  });
  it("writes nothing for a tab already at v2", () => {
    aTabAlreadyAtV2WritesNothing();
  });
  it("supersedes the seed's own v1 template row", () => {
    theSeedsV1TemplateRowIsSuperseded();
  });
  it("keeps a template row the seed does not own", () => {
    aTemplateRowTheSeedDoesNotOwnIsKept();
  });
});
