// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  describesTheLockedSettingsReason,
  drawsNoImgElementInTheHeader,
  doesNotReadAssets,
  drawsTheIdleThemeButtonAtEightyFive,
  drawsTheLockedSettingsAtThreeToOne,
  drawsThePressedThemeButtonOnTheWash,
  dropsTheControlRoom2dGroup,
  givesAnOperatorNoSettingsLink,
  givesAnOrganizationAdminTheSettingsLink,
  givesEveryRailItemAUniqueCode,
  hidesTheEntryFromANoneScope,
  hidesTheNotificationsEntryFromALocationAdmin,
  hidesTheEntryWhileTheScopeIsNull,
  doesNotHighlightTheEntryElsewhere,
  hasNoDashboardEntry,
  highlightsTheEntryOnANestedPath,
  highlightsTheEntryOnTheRoot,
  keepsOtherItemsExactMatch,
  keysEveryOverrideByARealPath,
  keepsTheVisibleCodeInEveryCollapsedName,
  labelsEveryCollapsedLinkWithItsTitleAndCode,
  letsTheLockedSettingsTakeFocus,
  locksSettingsAsAnAriaDisabledButton,
  namesTheExpandedLinkByItsLabel,
  namesDashboardsAndNoDashboardWhenCollapsed,
  placesTheEntryDirectlyAfterAlarmCentre,
  placesTheSwitchAfterTheUserBlock,
  placesTheSwitchBeforeLogout,
  readsNoTrinetraInTheShell,
  readsTheFullItemList,
  showsDsForDashboardsWhenCollapsed,
  selectsTheAreaOfADrillDown,
  selectsTheHubOnTheHubPath,
  showsTheHubAndFiveAreasToAnOrganizationAdmin,
  showsOneEntryToALocationScope,
  showsTheDescriptorInTheHeader,
  showsTheNameInTheFooter,
  showsTheWordmarkInTheHeader,
  showsTheFullLabelWhenExpanded,
  showsUniqueCodesWhenCollapsed,
} from "./app-shell.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 *
 * The cleanup is file-level so every `describe` gets it. It also removes the
 * `bms-sidebar-collapsed` key: `AppShell` reads it at mount, so a collapsed
 * case would otherwise leak its rail into every later render.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  window.localStorage.removeItem("bms-sidebar-collapsed");
});

describe("F3.66 Control Room sidebar entry", () => {
  it("S1 shows one entry, to /control-room, to a location scope", () => {
    showsOneEntryToALocationScope();
  });

  it("S2 hides the entry from a none scope", () => {
    hidesTheEntryFromANoneScope();
  });

  it("S3 hides the entry while the scope is null", () => {
    hidesTheEntryWhileTheScopeIsNull();
  });

  it("S4 drops the Control Room 2D group", () => {
    dropsTheControlRoom2dGroup();
  });

  it("S5 issues no fetchAssets() from the shell", async () => {
    await doesNotReadAssets();
  });

  it("S6 highlights the entry on a nested /control-room/* path", () => {
    highlightsTheEntryOnANestedPath();
  });

  it("S7 places the entry directly after Alarm Centre", () => {
    placesTheEntryDirectlyAfterAlarmCentre();
  });

  it("S8 keeps every other item exact-match", () => {
    keepsOtherItemsExactMatch();
  });

  it("S9 shows the hub and the five Master Data areas to an organization_admin (F3.76)", () => {
    showsTheHubAndFiveAreasToAnOrganizationAdmin();
  });

  it("S10 hides the Notifications area entry from a location_admin (F3.76)", () => {
    hidesTheNotificationsEntryFromALocationAdmin();
  });

  it("M1 selects the Sites & Equipment entry on a drill-down (F3.76)", () => {
    selectsTheAreaOfADrillDown();
  });

  it("M2 selects the hub entry on /admin only (F3.76)", () => {
    selectsTheHubOnTheHubPath();
  });
});

describe("F3.72 the Control Room entry replaces Dashboard (plan D6)", () => {
  it("S17 has no Dashboard entry; Dashboards is the positive control", () => {
    hasNoDashboardEntry();
  });

  it("S18 highlights the Control Room entry on /", () => {
    highlightsTheEntryOnTheRoot();
  });

  it("S18b does not highlight the Control Room entry on /alarms", () => {
    doesNotHighlightTheEntryElsewhere();
  });
});

describe("F4.164 locked Settings entry", () => {
  it("S9 is a button named Settings with aria-disabled=true", () => {
    locksSettingsAsAnAriaDisabledButton();
  });

  it("S10 is described by the locked reason through aria-describedby", () => {
    describesTheLockedSettingsReason();
  });

  it("S11 takes keyboard focus", () => {
    letsTheLockedSettingsTakeFocus();
  });

  it("S12 gives an operator no Settings link", () => {
    givesAnOperatorNoSettingsLink();
  });

  it("S13 gives an organization_admin the /admin link and no locked button", () => {
    givesAnOrganizationAdminTheSettingsLink();
  });

  it("S14 draws the locked entry in text-on-dark/70", () => {
    drawsTheLockedSettingsAtThreeToOne();
  });
});

describe("F4.164 collapsed rail", () => {
  it("L1 gives every rail item a unique collapsed code", () => {
    givesEveryRailItemAUniqueCode();
  });

  it("L2 reads the full item list, hidden items included", () => {
    readsTheFullItemList();
  });

  it("L3 keys every override by the path of a rail item", () => {
    keysEveryOverrideByARealPath();
  });

  it("L4 labels every collapsed link with its title and its visible code", () => {
    labelsEveryCollapsedLinkWithItsTitleAndCode();
  });

  it("L5 names Dashboards (DS) and no Dashboard (D) when collapsed", () => {
    namesDashboardsAndNoDashboardWhenCollapsed();
  });

  it("L6a shows unique codes when collapsed", () => {
    showsUniqueCodesWhenCollapsed();
  });

  it("L6b shows DS for Dashboards when collapsed", () => {
    showsDsForDashboardsWhenCollapsed();
  });

  it("L7 shows the full label when expanded", () => {
    showsTheFullLabelWhenExpanded();
  });

  it("L8 keeps the visible code in every collapsed link's accessible name (WCAG 2.5.3)", () => {
    keepsTheVisibleCodeInEveryCollapsedName();
  });

  it("L9 names the expanded Dashboards link exactly Dashboards", () => {
    namesTheExpandedLinkByItsLabel();
  });
});

describe("F3.65c the theme switch in the header", () => {
  it("S15a places the Theme group after the user block", () => {
    placesTheSwitchAfterTheUserBlock();
  });

  it("S15b places the Theme group before the Logout button", () => {
    placesTheSwitchBeforeLogout();
  });

  it("S16a draws the pressed button in bg-on-dark/15 text-on-dark", () => {
    drawsThePressedThemeButtonOnTheWash();
  });

  it("S16b draws the idle button in text-on-dark/85", () => {
    drawsTheIdleThemeButtonAtEightyFive();
  });
});

describe("F3.33 the IONSiTE NEXUS wordmark in the shell", () => {
  it("B1 shows the wordmark in the header as a named image", () => {
    showsTheWordmarkInTheHeader();
  });

  it("B2 draws no img element in the header", () => {
    drawsNoImgElementInTheHeader();
  });

  it("B3 shows the descriptor in the header", () => {
    showsTheDescriptorInTheHeader();
  });

  it("B4 shows IONSiTE NEXUS in the footer", () => {
    showsTheNameInTheFooter();
  });

  it("B5 reads no TRINETRA in the shell", () => {
    readsNoTrinetraInTheShell();
  });
});
