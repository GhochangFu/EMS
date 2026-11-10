import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, DesignSystem } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useThemeStore } from "../../stores/theme-store";
import { AppShell } from "../app-shell";
import { HEADER_FOLD_MAX_WIDTH, RAIL_HEADER_FOLD_MAX_WIDTH } from "./shell-header";

/**
 * `F4.347` — the chrome header never runs past the screen. On a narrow viewport the user, Theme,
 * Surface, Appearance and Logout fold into one Menu button (the sidebar shell at ≤ 767 px, the rail
 * shell below `xl`, where its status strip and one-line user need about 1,150 px). The panel opens
 * on the button and closes on Escape, a press outside it, Appearance, and a move to another page.
 * On a phone the rail's status strip moves into the panel. Above the fold widths nothing changes.
 */
const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function renderShell(design: DesignSystem, width: number): void {
  setViewportWidth(width);
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  useAuthStore.setState({ scope: GLOBAL });
  useThemeStore.getState().setDesign(design);
  const user = { id: "u1", email: "admin@bms.local", displayName: "Admin User", role: "admin" } as unknown as AuthUser;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/alarms"]}>
        <AppShell user={user} kpiRibbon={<span />}>
          body
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const header = () => screen.getByRole("banner");
const menuButton = () => within(header()).getByRole("button", { name: "Menu" });
const panel = () => screen.queryByRole("group", { name: "Account and display" });

export function theFoldWidthsAreThoseMeasured(): void {
  expect(HEADER_FOLD_MAX_WIDTH).toBe(767);
  expect(RAIL_HEADER_FOLD_MAX_WIDTH).toBe(1279);
}

/** H1 — the sidebar shell on a phone: one Menu button; its panel holds every folded control. */
export function aPhoneFoldsTheSidebarHeaderIntoAMenu(): void {
  renderShell("nexus-soft", 390);
  expect(within(header()).queryByRole("button", { name: "Logout" })).toBeNull();
  expect(within(header()).queryByRole("button", { name: "Appearance" })).toBeNull();
  expect(within(header()).queryByText("Admin User")).toBeNull();
  expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  expect(panel()).toBeNull();

  act(() => menuButton().click());
  expect(menuButton()).toHaveAttribute("aria-expanded", "true");
  const open = panel()!;
  expect(menuButton()).toHaveAttribute("aria-controls", open.id);
  expect(within(open).getByText("Admin User")).toBeInTheDocument();
  expect(within(open).getByRole("group", { name: "Theme" })).toBeInTheDocument();
  expect(within(open).getByRole("group", { name: "Surface" })).toBeInTheDocument();
  expect(within(open).getByRole("button", { name: "Appearance" })).toBeInTheDocument();
  expect(within(open).getByRole("button", { name: "Logout" })).toBeInTheDocument();

  // A press on a control inside the panel keeps it open (the outside test runs on `pointerdown`).
  const dark = within(open).getByRole("button", { name: "Dark" });
  fireEvent.pointerDown(dark);
  act(() => dark.click());
  expect(panel()).not.toBeNull();

  // A press on Menu itself while open closes the panel once: `pointerdown` does not close it, the
  // click toggles it.
  fireEvent.pointerDown(menuButton());
  act(() => menuButton().click());
  expect(panel()).toBeNull();
  expect(menuButton()).toHaveAttribute("aria-expanded", "false");
}

/** H2 — Escape, a press outside and Appearance each close the panel; Appearance opens its dialog. */
export function thePanelClosesOnEscapeOutsideAppearanceAndNavigation(): void {
  renderShell("swiss-grid", 390);
  act(() => menuButton().click());
  within(panel()!).getByRole("button", { name: "Logout" }).focus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(menuButton());

  act(() => menuButton().click());
  fireEvent.pointerDown(screen.getByText("body"));
  expect(panel()).toBeNull();

  act(() => menuButton().click());
  act(() => within(panel()!).getByRole("button", { name: "Appearance" }).click());
  expect(panel()).toBeNull();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
}

/** H2b — a move to another page closes the panel. */
export function thePanelClosesOnNavigation(): void {
  renderShell("bento-ops", 390);
  act(() => menuButton().click());
  expect(panel()).not.toBeNull();
  act(() => screen.getAllByRole("link", { name: "Reports" })[0]!.click());
  expect(panel()).toBeNull();
}

/** H3 — above 767 px the sidebar header is unchanged: no Menu, the controls in the row. */
export function aDesktopKeepsTheSidebarRow(): void {
  renderShell("enterprise-flat", 768);
  expect(within(header()).queryByRole("button", { name: "Menu" })).toBeNull();
  expect(within(header()).getByRole("button", { name: "Logout" })).toBeInTheDocument();
  expect(within(header()).getByText("Admin User")).toBeInTheDocument();
  // The subtitle shows from `xl` only.
  expect(within(header()).getByText(/Integrated Building/)).toHaveClass("hidden", "xl:inline");
}

/** H4 — the rail below `xl` folds the user and controls, but keeps the status strip in the row. */
export function theRailFoldsBelowXlAndKeepsItsStrip(): void {
  renderShell("control-room-dark", 1279);
  expect(within(header()).getByTestId("rail-status-strip")).toBeInTheDocument();
  expect(within(header()).queryByRole("button", { name: "Logout" })).toBeNull();
  act(() => menuButton().click());
  expect(within(panel()!).queryByTestId("rail-status-strip")).toBeNull();
  expect(within(panel()!).getByRole("button", { name: "Logout" })).toBeInTheDocument();
}

/** H5 — the rail on a phone moves the status strip into the panel. */
export function theRailOnAPhoneMovesTheStripIntoThePanel(): void {
  renderShell("control-room-dark", 390);
  expect(screen.queryByTestId("rail-status-strip")).toBeNull();
  act(() => menuButton().click());
  expect(within(panel()!).getByTestId("rail-status-strip")).toBeInTheDocument();
}

/** H6 — the rail at `xl` and wider is unchanged: no Menu, the user line and controls in the row. */
export function theRailAtXlKeepsItsRow(): void {
  renderShell("control-room-dark", 1280);
  expect(within(header()).queryByRole("button", { name: "Menu" })).toBeNull();
  expect(within(header()).getByRole("button", { name: "Logout" })).toBeInTheDocument();
  expect(within(header()).getByTestId("rail-status-strip")).toBeInTheDocument();
}
