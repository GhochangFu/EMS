import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useThemeStore } from "../../stores/theme-store";
import { AppShell } from "../app-shell";
import { RAIL_COLLAPSED_STORAGE_KEY } from "./rail-shell";

/**
 * `F4.346` (ADR 0118 Amendment 3 decision 2, plan S4) — the rail (`control-room-dark`) collapses.
 * It opens expanded with text labels; its button collapses it to codes, each code link keeping the
 * full label in its accessible name; the choice is stored under its own key, `bms-rail-collapsed`.
 * At ≤ `SHELL_RAIL_MAX_WIDTH` the rail is a 64 px slot, the stored choice is neither read nor
 * written, and the expanded rail is an overlay that closes on navigation (`F4.318`'s rules).
 */
const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function renderRail(path = "/alarms"): () => void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  useAuthStore.setState({ scope: GLOBAL });
  useThemeStore.getState().setDesign("control-room-dark");
  const user = { id: "u1", email: "admin@bms.local", displayName: "admin", role: "admin" } as unknown as AuthUser;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell user={user} kpiRibbon={<span />}>
          body
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return unmount;
}

const nav = () => screen.getByRole("navigation", { name: "Modules" });
const rail = () => screen.getByTestId("rail-aside");
const toggle = (name: "Collapse rail" | "Expand rail") => screen.getByRole("button", { name });

export function theStorageKeyIsItsOwn(): void {
  expect(RAIL_COLLAPSED_STORAGE_KEY).toBe("bms-rail-collapsed");
}

/** S4a — expanded by default: every item shows its full label, and the rail is 176 px (`w-44`). */
export function theRailOpensExpanded(): void {
  setViewportWidth(1440);
  renderRail();
  expect(rail()).toHaveClass("w-44");
  const alarm = within(nav()).getByRole("link", { name: "Alarm Centre" });
  expect(alarm.textContent).toBe("Alarm Centre");
  expect(toggle("Collapse rail")).toBeInTheDocument();
}

/**
 * S4b — the button collapses the rail to 64 px codes; each code link keeps its full label in its
 * accessible name; the choice is stored and read back at the next mount; the sidebar's key is not
 * touched.
 */
export function theButtonCollapsesToCodesAndTheChoicePersists(): void {
  setViewportWidth(1440);
  const unmount = renderRail();
  act(() => toggle("Collapse rail").click());
  expect(rail()).toHaveClass("w-16");
  const alarm = within(nav()).getByRole("link", { name: /Alarm Centre/ });
  expect(alarm.textContent).toBe("AC");
  expect(alarm.getAttribute("aria-label")).toBe("Alarm Centre (AC)");
  for (const link of within(nav()).getAllByRole("link")) {
    const name = link.getAttribute("aria-label") ?? "";
    expect(name.length, link.getAttribute("href") ?? "").toBeGreaterThan((link.textContent ?? "").length);
    expect(name).toContain(link.getAttribute("title") ?? "∅");
  }
  expect(localStorage.getItem("bms-rail-collapsed")).toBe("true");
  expect(localStorage.getItem("bms-sidebar-collapsed")).toBeNull();
  unmount();
  renderRail();
  expect(rail()).toHaveClass("w-16");
  act(() => toggle("Expand rail").click());
  expect(rail()).toHaveClass("w-44");
  expect(localStorage.getItem("bms-rail-collapsed")).toBe("false");
}

/**
 * S4c — at a phone width the rail is a 64 px slot although "expanded" is stored; Expand lays the
 * rail over the page from that slot without writing the key; a move to another page closes it.
 */
export function aPhoneWidthGetsTheSlotAndAnOverlayThatClosesOnNavigation(): void {
  setViewportWidth(390);
  localStorage.setItem("bms-rail-collapsed", "false");
  renderRail();
  expect(screen.getByTestId("rail-slot")).toHaveClass("w-16");
  expect(rail()).toHaveClass("w-16");
  act(() => toggle("Expand rail").click());
  expect(rail()).toHaveClass("w-44", "absolute");
  expect(screen.getByTestId("rail-slot")).toHaveClass("w-16");
  expect(localStorage.getItem("bms-rail-collapsed")).toBe("false");
  act(() => within(nav()).getByRole("link", { name: "Reports" }).click());
  expect(rail()).toHaveClass("w-16");
  expect(rail()).not.toHaveClass("z-30");
}
