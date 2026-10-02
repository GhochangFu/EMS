import { describe, it } from "vitest";

import {
  acceptsAMimicTabKeyNamingADomainTab,
  rejectsAMimicTabKeyNamingADomainlessTab,
  acceptsAnInstantiateBodyWithANullAssetGroup,
  aPatchBodyKeepsAnOmittedTabsUndefined,
  rejectsAPatchBodyWithADuplicateKeyAcrossTabs,
  acceptsASiteCreateBodyWithTabsAndDefaultsTheTarget,
  acceptsASiteInstantiateBody,
  rejectsALayoutMimicInsideATab,
  rejectsAnAssetGroupCreateBodyWithTabs,
  rejectsAnInstantiateBodyNamingBothArms,
  rejectsASiteCreateBodyWithTopLevelWidgets,
  theTargetBodyRuleRefusesEachMismatch,
  acceptsASiteTemplateCardNamingItsOwnTab,
  rejectsAnAssetGroupTemplateWithATopLevelModuleCard,
  rejectsAPatchCardNamingAMissingTab,
  rejectsASiteTemplateCardNamingAMissingTab,
  acceptsAPatchBodyWhoseMimicNamesThePreset,
  acceptsAPatchBodyWhoseWidgetCarriesNeitherKind,
  acceptsAPatchBodyWhoseWidgetCarriesOnlyARoleBinding,
  rejectsACreateBodyWhoseMimicNamesALayout,
  rejectsAPatchBodyWhoseChartWidgetCarriesAMetricSource,
  rejectsAPatchBodyWhoseMimicNamesALayout,
  rejectsAPatchBodyWhoseWidgetCarriesBothKinds,
  stillRejectsAnInstantiateBodyWhoseAssetGroupIsNotAUuid,
  theInstantiateSlugTakesTheSameCharsetAsTheDashboardWriteDoor,
} from "./dashboard-templates.schema.spec";

/** `F3.61` Task 2 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). One `it()` per claim, so a failing claim reddens only its own
 * assertion. */
describe("F3.61 — the template PATCH body refuses a both-kinds widget and a mis-shaped source", () => {
  it("rejects a PATCH body whose one widget carries both kinds", () => {
    rejectsAPatchBodyWhoseWidgetCarriesBothKinds();
  });

  it("accepts a PATCH body whose widget carries only a role binding (the both-kinds case minus sources)", () => {
    acceptsAPatchBodyWhoseWidgetCarriesOnlyARoleBinding();
  });

  it("accepts a PATCH body whose widget carries neither kind", () => {
    acceptsAPatchBodyWhoseWidgetCarriesNeitherKind();
  });

  it("rejects a PATCH body whose one widget is a chart carrying a metric source (Amendment 1)", () => {
    rejectsAPatchBodyWhoseChartWidgetCarriesAMetricSource();
  });
});

/** `E4.2` U8b — the organization-wide instantiate arm at the request boundary
 * (ADR 0072 decision 1, an amendment to ADR 0049 decision 4). */
describe("E4.2 — the instantiate body takes a null asset group", () => {
  it("accepts a null assetGroupId", () => {
    acceptsAnInstantiateBodyWithANullAssetGroup();
  });

  it("still rejects an assetGroupId that is neither a uuid nor null", () => {
    stillRejectsAnInstantiateBodyWhoseAssetGroupIsNotAUuid();
  });

  it("applies the same slug charset as POST /dashboards (E4.2 PR 2 security review)", () => {
    theInstantiateSlugTakesTheSameCharsetAsTheDashboardWriteDoor();
  });
});

/** `F3.32c` / ADR 0081 decision 5 — a template holds a preset mimic only. */
describe("F3.32c — a template body refuses a layout-arm mimic", () => {
  it("rejects a PATCH body whose mimic names a layout", () => {
    rejectsAPatchBodyWhoseMimicNamesALayout();
  });

  it("rejects a POST body whose mimic names a layout", () => {
    rejectsACreateBodyWhoseMimicNamesALayout();
  });

  it("accepts a PATCH body whose mimic names the preset (positive control)", () => {
    acceptsAPatchBodyWhoseMimicNamesThePreset();
  });
});

/** `F3.73` plan D4 and D6 — the template target at the request boundary. */
describe("F3.73 — the template target, content tabs and the instantiate site arm", () => {
  it("refuses a site-target create body with top-level widgets", () => {
    rejectsASiteCreateBodyWithTopLevelWidgets();
  });

  it("refuses an asset-group create body with tabs", () => {
    rejectsAnAssetGroupCreateBodyWithTabs();
  });

  it("accepts a site create body with tabs only, and defaults the target", () => {
    acceptsASiteCreateBodyWithTabsAndDefaultsTheTarget();
  });

  it("refuses a layout-arm mimic inside a tab", () => {
    rejectsALayoutMimicInsideATab();
  });

  it("a PATCH body keeps an omitted content.tabs undefined", () => {
    aPatchBodyKeepsAnOmittedTabsUndefined();
  });

  it("refuses a PATCH body whose two tabs share one widget key", () => {
    rejectsAPatchBodyWithADuplicateKeyAcrossTabs();
  });

  it("accepts a site instantiate body", () => {
    acceptsASiteInstantiateBody();
  });

  it("refuses an instantiate body naming both arms", () => {
    rejectsAnInstantiateBodyNamingBothArms();
  });

  it("the body/target rule refuses a site body on a group template and the reverse", () => {
    theTargetBodyRuleRefusesEachMismatch();
  });

  it("refuses an asset-group template's top-level module card", () => {
    rejectsAnAssetGroupTemplateWithATopLevelModuleCard();
  });

  it("refuses a site template's card naming a tab it does not hold", () => {
    rejectsASiteTemplateCardNamingAMissingTab();
  });

  it("refuses a PATCH card naming a tab the content does not hold", () => {
    rejectsAPatchCardNamingAMissingTab();
  });

  it("accepts a site template's card naming its own tab", () => {
    acceptsASiteTemplateCardNamingItsOwnTab();
  });

  it("refuses a mimic tabKey naming a tab with no domain", () => {
    rejectsAMimicTabKeyNamingADomainlessTab();
  });

  it("accepts a mimic tabKey naming a domain tab", () => {
    acceptsAMimicTabKeyNamingADomainTab();
  });
});
