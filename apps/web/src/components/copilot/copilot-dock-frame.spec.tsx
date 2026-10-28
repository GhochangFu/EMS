import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotWindowMode } from "../../stores/copilot-window-store";
import { CopilotDockFrame } from "./copilot-dock-frame";
import { useCopilotSheet, useViewportSize } from "./use-copilot-viewport";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6; owner ruling P6) — the dock's window
 * frame. Assertions live here; `copilot-dock-frame.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0014).
 * jsdom's viewport is 1024 × 768.
 */

type Props = { mode?: CopilotWindowMode; sheet?: boolean; width?: number; height?: number };

function renderFrame({ mode = "floating", sheet = false, width = 380, height = 520 }: Props = {}) {
  const onModeChange = vi.fn();
  const onResize = vi.fn();
  const onClose = vi.fn();
  render(
    <CopilotDockFrame
      mode={mode}
      size={{ width, height }}
      sheet={sheet}
      onModeChange={onModeChange}
      onResize={onResize}
      onClose={onClose}
      header={<h2>Copilot</h2>}
    >
      <p>body</p>
    </CopilotDockFrame>,
  );
  return { onModeChange, onResize, onClose, panel: screen.getByRole("complementary", { name: "Copilot" }) };
}

const LEFT = { name: "Resize the copilot panel: left edge" };
const TOP = { name: "Resize the copilot panel: top edge" };
const MODES = { name: "Copilot window mode" };

/** Mutation: `data-mode` is always `"floating"`. */
export function theDataModeIsTheMode(): void {
  expect(renderFrame({ mode: "maximized" }).panel.dataset.mode).toBe("maximized");
}

/** Mutation: a mode button calls `onModeChange(mode)` with the current mode. */
export function maximizeAsksForTheMaximizedMode(): void {
  const { onModeChange } = renderFrame();
  fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
  expect(onModeChange).toHaveBeenCalledWith("maximized");
}

/** Mutation: `aria-pressed={mode !== b.mode}`. */
export function theCurrentModesButtonIsPressed(): void {
  renderFrame({ mode: "maximized" });
  expect(screen.getByRole("button", { name: "Maximize" })).toHaveAttribute("aria-pressed", "true");
}

/** Mutation: the floating style drops `width`. */
export function aFloatingPanelTakesTheStoredWidth(): void {
  expect(renderFrame().panel.style.width).toBe("380px");
}

/** Mutation: the floating style drops `height`. */
export function aFloatingPanelTakesTheStoredHeight(): void {
  expect(renderFrame().panel.style.height).toBe("520px");
}

/**
 * Review (minor): the floating bounds are the drawn room (the viewport less
 * 48 × 128 px), so a stored size never outgrows what shows and the handle
 * follows the pointer. Mutation: the floating bounds are the full viewport.
 */
export function aFloatingHeightTallerThanTheRoomIsCapped(): void {
  expect(renderFrame({ height: 5000 }).panel.style.height).toBe("640px");
}

/** The same, for the width. Mutation: `floatingBounds` keeps the full viewport width. */
export function aFloatingWidthWiderThanTheRoomIsCapped(): void {
  expect(renderFrame({ width: 5000 }).panel.style.width).toBe("976px");
}

/** Mutation: flip the sign of the left-edge arithmetic in `resizedSize`. */
export function aLeftDragOfFortyPixelsAsksForWidthFourTwenty(): void {
  const { onResize } = renderFrame();
  const handle = screen.getByRole("separator", LEFT);
  fireEvent.pointerDown(handle, { clientX: 600, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 560, clientY: 300, pointerId: 1 });
  expect(onResize).toHaveBeenLastCalledWith({ width: 420, height: 520 }, { width: 976, height: 640 });
}

/** Mutation: `onPointerEnd` does not end the drag. */
export function aMoveAfterThePointerUpResizesNothing(): void {
  const { onResize } = renderFrame();
  const handle = screen.getByRole("separator", LEFT);
  fireEvent.pointerDown(handle, { clientX: 600, clientY: 300, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 600, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 500, clientY: 300, pointerId: 1 });
  expect(onResize).not.toHaveBeenCalled();
}

/** Mutation: ArrowLeft is not wired (`onKeyDown` removed). */
export function arrowLeftOnTheLeftHandleGrowsTheWidthBySixteen(): void {
  const { onResize } = renderFrame();
  fireEvent.keyDown(screen.getByRole("separator", LEFT), { key: "ArrowLeft" });
  expect(onResize).toHaveBeenCalledWith({ width: 396, height: 520 }, { width: 976, height: 640 });
}

/** The adjacent positive of the docked case below: a floating panel has a top handle. */
export function aFloatingPanelHasATopHandle(): void {
  renderFrame();
  expect(screen.getByRole("separator", TOP)).toBeInTheDocument();
}

/** Mutation: the top handle renders in the docked mode too. */
export function aDockedPanelHasNoTopHandle(): void {
  renderFrame({ mode: "docked" });
  expect(screen.queryByRole("separator", TOP)).toBeNull();
}

/** Mutation: the left handle renders in the floating mode only. */
export function aDockedPanelHasALeftHandle(): void {
  renderFrame({ mode: "docked" });
  expect(screen.getByRole("separator", LEFT)).toBeInTheDocument();
}

/** Ruling P6: the docked width is the stored width. Mutation: the docked style drops `width`. */
export function aDockedPanelTakesTheStoredWidth(): void {
  expect(renderFrame({ mode: "docked", width: 420 }).panel.style.width).toBe("420px");
}

/** Critic (low): a stored width wider than the screen leaves the page 320 px. Mutation: docked bounds = the viewport. */
export function aDockedWidthWiderThanTheScreenIsClamped(): void {
  expect(renderFrame({ mode: "docked", width: 1400 }).panel.style.width).toBe("704px");
}

/** Mutation: the left handle renders in the maximized mode too. */
export function aMaximizedPanelHasNoHandle(): void {
  renderFrame({ mode: "maximized" });
  expect(screen.queryAllByRole("separator")).toHaveLength(0);
}

/** Mutation: remove the `sheet` branch (`shape = mode`). */
export function theSheetSaysSheet(): void {
  expect(renderFrame({ sheet: true }).panel.dataset.mode).toBe("sheet");
}

/** Mutation: render the mode group in the sheet too. */
export function theSheetHasNoModeGroup(): void {
  renderFrame({ sheet: true });
  expect(screen.queryByRole("group", MODES)).toBeNull();
}

/** The adjacent positive: a floating panel has the mode group. */
export function aFloatingPanelHasTheModeGroup(): void {
  renderFrame();
  expect(screen.getByRole("group", MODES)).toBeInTheDocument();
}

/** Mutation: the handles render on `mode`, not on the shape. */
export function theSheetHasNoHandle(): void {
  renderFrame({ sheet: true });
  expect(screen.queryAllByRole("separator")).toHaveLength(0);
}

/** Mutation: Close calls nothing. */
export function closeCallsOnClose(): void {
  const { onClose } = renderFrame();
  fireEvent.click(screen.getByRole("button", { name: "Close the copilot panel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
}

/** 768 px is the first width that is not a sheet. Mutation: `<=` becomes `<` with the bound 768. */
export function a768PxViewportIsNotASheet(): void {
  vi.stubGlobal("innerWidth", 768);
  expect(renderHook(() => useCopilotSheet()).result.current).toBe(false);
}

/** 767 px is a sheet. Mutation: `<=` becomes `<`. */
export function a767PxViewportIsASheet(): void {
  vi.stubGlobal("innerWidth", 767);
  expect(renderHook(() => useCopilotSheet()).result.current).toBe(true);
}

/** The first render already says sheet: no floating flash on a phone. Mutation: the hook starts `false` and sets in an effect. */
export function aNarrowViewportIsASheetFromTheFirstRender(): void {
  vi.stubGlobal("innerWidth", 500);
  const seen: boolean[] = [];
  renderHook(() => {
    const sheet = useCopilotSheet();
    seen.push(sheet);
    return sheet;
  });
  expect(seen[0]).toBe(true);
}

/** Mutation: the sheet reads the width once and does not follow `resize`. */
export function aResizeToANarrowWindowMovesTheSheet(): void {
  vi.stubGlobal("innerWidth", 1200);
  const { result } = renderHook(() => useCopilotSheet());
  act(() => {
    vi.stubGlobal("innerWidth", 600);
    window.dispatchEvent(new Event("resize"));
  });
  expect(result.current).toBe(true);
}

/** Mutation: `useViewportSize` does not listen for `resize`. */
export function aResizeOfTheWindowMovesTheViewport(): void {
  const { result } = renderHook(() => useViewportSize());
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1500 });
    window.dispatchEvent(new Event("resize"));
  });
  expect(result.current.width).toBe(1500);
}
