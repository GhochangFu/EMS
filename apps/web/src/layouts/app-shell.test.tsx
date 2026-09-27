// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  describesTheLockedSettingsReason,
  doesNotReadAssets,
  drawsTheLockedSettingsAtThreeToOne,
  dropsTheControlRoom2dGroup,
  givesAnOperatorNoSettingsLink,
  givesAnOrganizationAdminTheSettingsLink,
  hidesTheEntryFromANoneScope,
  hidesTheEntryWhileTheScopeIsNull,
  highlightsTheEntryOnANestedPath,
  keepsOtherItemsExactMatch,
  letsTheLockedSettingsTakeFocus,
  locksSettingsAsAnAriaDisabledButton,
  placesTheEntryDirectlyAfterAlarmCentre,
  showsOneEntryToALocationScope,
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

  it("S14 draws the locked entry in text-white/70", () => {
    drawsTheLockedSettingsAtThreeToOne();
  });
});
