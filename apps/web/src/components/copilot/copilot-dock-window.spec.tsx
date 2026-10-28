import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { CopilotStatusDto } from "@bms/shared";

import * as systemStatusApi from "../../api/system-status";
import { AppShell } from "../../layouts/app-shell";
import { bindSessionStores } from "../../lib/query-cache-session";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { COPILOT_WINDOW_KEY, useCopilotWindowStore } from "../../stores/copilot-window-store";
import { OPERATIONAL } from "../system-status-indicator.spec";
import { COPILOT_OFF, openPanel, READY, renderDock, settle, stub } from "./copilot-dock.spec";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6; owner ruling P6) — the dock's window
 * wired into the dock and `AppShell`: the page push, the mode buttons, the
 * resize, the sheet, the session exit and a refused storage.
 *
 * Assertions live here; `copilot-dock-window.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014).
 * `copilot-dock.spec.tsx` gains no case (858 lines). Every API read is a spy.
 * jsdom's viewport is 1024 × 768.
 */

const ADMIN = { id: "u1", email: "admin@bms.local", displayName: "admin", role: "admin" } as unknown as AuthUser;
const PANEL = { name: "Copilot" };
const FAB_CLOSE = { name: "Close the copilot" };

function renderShell(status: CopilotStatusDto = READY): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  stub(status);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/alarms"]}>
        <AppShell user={ADMIN} kpiRibbon={null}>
          <p>page</p>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function shellRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("div.min-h-screen");
  if (root === null) throw new Error("fixture: the AppShell root renders");
  return root;
}

function storedWindow(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(COPILOT_WINDOW_KEY);
  return raw === null ? null : (JSON.parse(raw) as { state: Record<string, unknown> }).state;
}

/** Mutation: `AppShell` ignores the hook (`paddingRight: 0`). */
export async function aDockedPanelPushesThePageByItsWidth(): Promise<void> {
  useCopilotWindowStore.setState({ open: true, mode: "docked", width: 420 });
  renderShell();
  await screen.findByRole("complementary", PANEL);
  await waitFor(() => expect(shellRoot().style.paddingRight).toBe("420px"));
}

/** Mutation: `copilotPagePush` drops the `mode === "docked"` check. */
export async function aFloatingPanelPushesNothing(): Promise<void> {
  useCopilotWindowStore.setState({ open: true, mode: "floating", width: 420 });
  renderShell();
  await screen.findByRole("complementary", PANEL);
  expect(shellRoot().style.paddingRight).toBe("0px");
}

/**
 * Critic (medium): the copilot turned off renders no dock, so a stored docked
 * window leaves no gutter. Mutation: drop `mounted > 0` from `copilotPagePush`
 * (or the dock's `mount()` effect moves above the status check).
 */
export async function anUnavailableCopilotPushesNothing(): Promise<void> {
  useCopilotWindowStore.setState({ open: true, mode: "docked", width: 420 });
  renderShell(COPILOT_OFF);
  await settle();
  await settle();
  expect(shellRoot().style.paddingRight).toBe("0px");
}

/** Mutation: the mode buttons call nothing in the store. */
export async function dockToTheSideStoresTheDockedMode(): Promise<void> {
  stub(READY);
  renderDock("admin");
  await openPanel();
  fireEvent.click(screen.getByRole("button", { name: "Dock to the side" }));
  expect(storedWindow()?.mode).toBe("docked");
}

/** Mutation: the dock's `onResize` writes nothing. */
export async function arrowLeftOnTheHandleStoresTheWiderPanel(): Promise<void> {
  stub(READY);
  renderDock("admin");
  await openPanel();
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the copilot panel: left edge" }), { key: "ArrowLeft" });
  expect(useCopilotWindowStore.getState().width).toBe(396);
}

/** Mutation: the button always renders. */
export async function aDockedPanelHidesTheButton(): Promise<void> {
  stub(READY);
  useCopilotWindowStore.setState({ open: true, mode: "docked" });
  renderDock("admin");
  await screen.findByRole("complementary", PANEL);
  expect(screen.queryByRole("button", FAB_CLOSE)).toBeNull();
}

/** The adjacent positive: a floating open panel keeps the button. Mutation: the button renders only when closed. */
export async function aFloatingPanelKeepsTheButton(): Promise<void> {
  stub(READY);
  useCopilotWindowStore.setState({ open: true, mode: "floating" });
  renderDock("admin");
  await screen.findByRole("complementary", PANEL);
  expect(screen.getByRole("button", FAB_CLOSE)).toBeInTheDocument();
}

/** Mutation: the dock passes `sheet={false}` to the frame. */
export async function aNarrowScreenShowsTheSheet(): Promise<void> {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
  stub(READY);
  useCopilotWindowStore.setState({ open: true, mode: "docked" });
  renderDock("admin");
  expect((await screen.findByRole("complementary", PANEL)).dataset.mode).toBe("sheet");
}

/** Signed in, bound as `main.tsx` binds, with the panel open; answers the unbind. */
async function openWhileSignedIn(): Promise<() => void> {
  useAuthStore.getState().setSession("token-a", ADMIN, null, null);
  const unbind = bindSessionStores(useAuthStore, new QueryClient());
  stub(READY);
  useCopilotWindowStore.getState().setOpen(true);
  renderDock("admin");
  await screen.findByRole("complementary", PANEL);
  return unbind;
}

/** Ruling P6: a logout closes the panel. Mutation: remove `clearCopilotWindow()` from `clearCopilotSession`. */
export async function aLogoutClosesThePanel(): Promise<void> {
  const unbind = await openWhileSignedIn();
  try {
    act(() => useAuthStore.getState().clearSession());
    expect(screen.queryByRole("complementary", PANEL)).toBeNull();
  } finally {
    unbind();
  }
}

/** Ruling P6: a logout removes the window key. Mutation: drop `persist.clearStorage()` from `clearCopilotWindow`. */
export async function aLogoutRemovesTheWindowKey(): Promise<void> {
  const unbind = await openWhileSignedIn();
  try {
    expect(storedWindow()).not.toBeNull();
    act(() => useAuthStore.getState().clearSession());
    expect(window.localStorage.getItem(COPILOT_WINDOW_KEY)).toBeNull();
  } finally {
    unbind();
  }
}

/** The dock renders without storage. Mutation: drop the `try`/`catch` around `localStorage.setItem`. */
export async function aRefusedStorageStillOpensThePanel(): Promise<void> {
  stub(READY);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  renderDock("admin");
  await openPanel();
  expect(screen.getByRole("complementary", PANEL)).toBeInTheDocument();
}
