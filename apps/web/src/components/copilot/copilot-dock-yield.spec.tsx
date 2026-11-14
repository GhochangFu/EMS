import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotWindowMode } from "../../stores/copilot-window-store";
import { CopilotDockFrame } from "./copilot-dock-frame";
import { renderDock, stub } from "./copilot-dock.spec";

/**
 * `F4.362` leftover 4 (AWS check, 2026-11-14) — at 598 px the dock is a full-screen sheet and covered the
 * page's wizard dialog, so a click on its Reason field landed in the dock. While a page dialog is open
 * (`role="dialog"`, `role="alertdialog"` or `aria-modal="true"` outside the dock), the sheet, the maximized
 * window and the docked panel drop under every modal layer (`z-30`; the page's overlays are `z-40` and
 * `z-50`); the small floating window stays on top, so a user can still talk to the copilot beside a wizard.
 * Vitest entry point: the sibling `.test.tsx`.
 */

function renderWith(mode: CopilotWindowMode, sheet: boolean, dialog: string | null) {
  const page = (open: string | null) =>
    open === null ? null : (
      <div className="fixed inset-0 z-50">
        <div {...{ [open.split("=")[0]!]: open.split("=")[1] }} aria-label="Cancel maintenance window">
          <input aria-label="Reason (optional)" />
        </div>
      </div>
    );
  const frame = (open: string | null) => (
    <>
      {page(open)}
      <CopilotDockFrame
        mode={mode}
        size={{ width: 380, height: 520 }}
        sheet={sheet}
        onModeChange={vi.fn()}
        onResize={vi.fn()}
        onClose={vi.fn()}
        header={<h2>Copilot</h2>}
      >
        <p>body</p>
      </CopilotDockFrame>
    </>
  );
  const view = render(frame(dialog));
  return {
    panel: () => screen.getByRole("complementary", { name: "Copilot" }),
    rerender: (open: string | null) => view.rerender(frame(open)),
    unmount: () => view.unmount(),
  };
}

const layer = (panel: HTMLElement): string | undefined => panel.className.split(" ").find((name) => name.startsWith("z-"));

/** The sheet yields to an open page dialog and comes back on top when it closes. Mutation: never yield → red. */
export async function theSheetYieldsToAPageDialog(): Promise<void> {
  const { panel, rerender } = renderWith("floating", true, "role=dialog");
  await waitFor(() => expect(layer(panel())).toBe("z-30"));
  expect(panel().dataset.yields).toBe("true");
  act(() => rerender(null));
  await waitFor(() => expect(layer(panel())).toBe("z-50"));
  expect(panel().dataset.yields).toBeUndefined();
}

/** An `aria-modal` or an `alertdialog` counts; the maximized window and the docked panel yield too. */
export async function everyCoveringShapeYieldsToAnyModal(): Promise<void> {
  for (const [mode, open] of [
    ["maximized", "aria-modal=true"],
    ["docked", "role=alertdialog"],
  ] as const) {
    const { panel, rerender, unmount } = renderWith(mode, false, open);
    await waitFor(() => expect(layer(panel()), mode).toBe("z-30"));
    act(() => rerender(null));
    await waitFor(() => expect(layer(panel()), mode).not.toBe("z-30"));
    unmount();
  }
}

/** The floating window stays on top beside a wizard; with no dialog open nothing yields. */
export async function theFloatingWindowAndAQuietPageKeepTheirLayer(): Promise<void> {
  const floating = renderWith("floating", false, "role=dialog");
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  expect(layer(floating.panel())).toBe("z-50");
  expect(floating.panel().dataset.yields).toBeUndefined();
}

/** A dialog the dock draws inside its own panel is the dock's, not the page's: the dock keeps its layer. */
export async function aDialogInsideTheDockDoesNotYield(): Promise<void> {
  render(
    <CopilotDockFrame
      mode="maximized"
      size={{ width: 380, height: 520 }}
      sheet={false}
      onModeChange={vi.fn()}
      onResize={vi.fn()}
      onClose={vi.fn()}
      header={<h2>Copilot</h2>}
    >
      <div role="dialog" aria-label="Inside" />
    </CopilotDockFrame>,
  );
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  expect(layer(screen.getByRole("complementary", { name: "Copilot" }))).toBe("z-50");
}

/**
 * The closed dock's launcher (bottom right, `z-50`) yields too: at a narrow width it sat over the dialog's
 * Submit button. Mutation: the launcher keeps `z-50` → red.
 */
export async function theLauncherYieldsToAPageDialog(): Promise<void> {
  stub();
  renderDock("admin");
  const launcher = await screen.findByRole("button", { name: "Open the copilot" });
  expect(layer(launcher)).toBe("z-50");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  act(() => {
    document.body.appendChild(dialog);
  });
  await waitFor(() => expect(layer(screen.getByRole("button", { name: "Open the copilot" }))).toBe("z-30"));
  act(() => dialog.remove());
  await waitFor(() => expect(layer(screen.getByRole("button", { name: "Open the copilot" }))).toBe("z-50"));
}
