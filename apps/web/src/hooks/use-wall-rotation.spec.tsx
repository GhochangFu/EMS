import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { expect, vi } from "vitest";

import { useWallRotation, type WallRotationOptions } from "./use-wall-rotation";

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D8) — the wall's rotation: one `setInterval` of
 * `every` seconds that replaces the URL with the next tab's wall URL, paused by a key or a pointer
 * anywhere but the wall's own bar, and restarted by `resume()`.
 *
 * Assertions live here; `use-wall-rotation.test.tsx` is the Vitest entry point and carries the
 * jsdom docblock (ADR 0014, ADR 0042 decision 2). `useNavigate` is a module mock so the spec
 * reads the exact call, `replace` included. Fake timers fake only the interval functions.
 */
const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

const SITE = "/control-room/site/p1";
const OPTIONS: WallRotationOptions = {
  sitePath: SITE,
  tabKeys: ["overview", "sld", "hvac"],
  currentKey: "overview",
  everyS: 15,
};

export function setUpRotation(): void {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  mocks.navigate.mockReset();
}

export function tearDownRotation(): void {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
}

function renderRotation(options: WallRotationOptions = OPTIONS) {
  return renderHook((props: WallRotationOptions) => useWallRotation(props), { initialProps: options });
}

/** R1 — after `every` seconds the URL is replaced by the next tab's wall URL; not a ms before. */
export function itAdvancesAfterEveryWithReplace(): void {
  renderRotation();
  act(() => {
    vi.advanceTimersByTime(14_999);
  });
  expect(mocks.navigate, "control: nothing before the interval").not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).toHaveBeenCalledWith(`${SITE}/sld?wall=1&every=15`, { replace: true });
}

/** R2 — a key pressed anywhere on the document pauses: no advance follows. */
export function aKeydownPausesTheRotation(): void {
  const { result } = renderRotation();
  expect(result.current.paused, "control: running before the key").toBe(false);
  act(() => {
    fireEvent.keyDown(document.body, { key: "a" });
  });
  expect(result.current.paused).toBe(true);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
}

/** R3a — a pointer pressed on the page (the canvas) pauses. */
export function aPointerdownOnThePagePauses(): void {
  const canvas = document.createElement("div");
  document.body.appendChild(canvas);
  const { result } = renderRotation();
  act(() => {
    fireEvent.pointerDown(canvas);
  });
  expect(result.current.paused).toBe(true);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
}

/** R3b — a pointer or a key inside `[data-wall-bar]` does not pause: the bar's controls work. */
export function aPointerdownInTheBarDoesNotPause(): void {
  const bar = document.createElement("div");
  bar.setAttribute("data-wall-bar", "");
  const control = document.createElement("button");
  bar.appendChild(control);
  document.body.appendChild(bar);
  const { result } = renderRotation();
  act(() => {
    fireEvent.pointerDown(control);
    fireEvent.keyDown(control, { key: "Enter" });
  });
  expect(result.current.paused).toBe(false);
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
}

/** R4 — `resume()` restarts the rotation with a full interval. */
export function resumeRestartsTheRotation(): void {
  const { result } = renderRotation();
  act(() => {
    fireEvent.keyDown(document.body, { key: "a" });
  });
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(mocks.navigate, "control: paused before resume").not.toHaveBeenCalled();
  act(() => {
    result.current.resume();
  });
  expect(result.current.paused).toBe(false);
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(mocks.navigate).toHaveBeenCalledWith(`${SITE}/sld?wall=1&every=15`, { replace: true });
}

/** R5 — the bare path (no tab key) is the first tab, so the first turn goes to the second. */
export function theBarePathAdvancesToTheSecondTab(): void {
  renderRotation({ ...OPTIONS, currentKey: undefined, everyS: 30 });
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(mocks.navigate).toHaveBeenCalledWith(`${SITE}/sld?wall=1&every=30`, { replace: true });
}

/** R6 — one tab (or none) never rotates. */
export function oneTabNeverRotates(): void {
  renderRotation({ ...OPTIONS, tabKeys: ["overview"] });
  act(() => {
    vi.advanceTimersByTime(120_000);
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
}

/** R7 — unmount clears the timer and both document listeners. */
export function unmountClearsTheTimerAndTheListeners(): void {
  const remove = vi.spyOn(document, "removeEventListener");
  const { unmount } = renderRotation();
  unmount();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
  const removed = remove.mock.calls.map(([type, , options]) => `${type}:${String(options)}`);
  expect(removed).toEqual(expect.arrayContaining(["keydown:true", "pointerdown:true"]));
  remove.mockRestore();
}
