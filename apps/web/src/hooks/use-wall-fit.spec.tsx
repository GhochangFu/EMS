import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { useWallFit } from "./use-wall-fit";

/**
 * `F3.77` follow-up (plan D5, owner ruling Q2) — `useWallFit`, the wall's computed zoom: the base
 * for the screen's width, reduced so the bar plus the content fit the screen's height, with the
 * growth hysteresis, re-measured on a resize of the content or of the window.
 *
 * Assertions live here; `use-wall-fit.test.tsx` is the Vitest entry point and carries the jsdom
 * docblock (ADR 0014, ADR 0042 decision 2). jsdom has no layout: `offsetHeight` is a prototype
 * getter that reads each probe's `data-h`, the window's size is stubbed, and a fake
 * `ResizeObserver` records its callback and targets so a case can fire it. A local fake, not
 * `dashboard-canvas.spec`'s `installFakeResizeObserver`: that one exposes no way to fire it.
 */

type FakeObserver = { callback: () => void; targets: Set<Element> };

let observers: FakeObserver[] = [];
let offsetHeightDescriptor: PropertyDescriptor | undefined;

function installFakeResizeObserver(): void {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly record: FakeObserver;
      constructor(callback: () => void) {
        this.record = { callback, targets: new Set() };
        observers.push(this.record);
      }
      observe(target: Element): void {
        this.record.targets.add(target);
      }
      unobserve(target: Element): void {
        this.record.targets.delete(target);
      }
      disconnect(): void {
        this.record.targets.clear();
      }
    },
  );
}

/** Every element's `offsetHeight` is its `data-h` (0 without one). Restored by `tearDownFit`. */
function installOffsetHeight(): void {
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0);
    },
  });
}

function setWindow(width: number, height: number): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
}

export function setUpFit(): void {
  installFakeResizeObserver();
  installOffsetHeight();
  setWindow(1920, 1080);
}

export function tearDownFit(): void {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (offsetHeightDescriptor !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
  } else {
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  }
  observers = [];
}

const BAR_PX = 48;

function Probe({ contentPx, tabKey }: { contentPx: number; tabKey?: string }) {
  const { zoom, barRef, contentRef } = useWallFit(tabKey);
  return (
    <>
      <div ref={barRef} data-h={BAR_PX} />
      <div ref={contentRef} data-testid="content" data-h={contentPx} />
      <output data-testid="zoom">{String(zoom)}</output>
    </>
  );
}

/**
 * Content that re-wraps with the zoom (the review finding's scenario): above 1.0 the CSS width is
 * narrower and the rows wrap, so bar + content is 1100 px; at 1.0 or below it is 1000 px. That is
 * 0.98 against 1.08 at 1080 px high — a jump of 0.10, twice the growth step.
 */
function WrapProbe({ tabKey }: { tabKey?: string }) {
  const { zoom, barRef, contentRef } = useWallFit(tabKey);
  return (
    <>
      <div ref={barRef} data-h={BAR_PX} />
      <div ref={contentRef} data-testid="content" data-h={zoom > 1 ? 1052 : 952} />
      <output data-testid="zoom">{String(zoom)}</output>
    </>
  );
}

function zoom(): string {
  return screen.getByTestId("zoom").textContent ?? "";
}

/** Fires every observer still watching a connected element, as a browser does after a layout. */
function fireObservers(): void {
  act(() => {
    for (const observer of observers) {
      if ([...observer.targets].some((target) => target.isConnected)) {
        observer.callback();
      }
    }
  });
}

/** Sets the content's height and fires the observers. */
function resizeContent(px: number): void {
  screen.getByTestId("content").dataset.h = String(px);
  fireObservers();
}

/** Mounts the wrap probe and fires the observer six times, one layout each: the zoom after each. */
function settleWrapProbe(): string[] {
  const seen: string[] = [];
  for (let fire = 0; fire < 6; fire += 1) {
    fireObservers();
    seen.push(zoom());
  }
  return seen;
}

/** H1 — 1920 × 1080, bar 48 + content 1000 = 1048 px: 1080 / 1048 = 1.0305 → 1.03, at the first layout. */
export function tallContentZoomsToFit(): void {
  render(<Probe contentPx={1000} />);
  expect(zoom()).toBe("1.03");
}

/** H2 — content that fits at the base keeps 1.25. */
export function contentThatFitsKeepsTheBase(): void {
  render(<Probe contentPx={700} />);
  expect(zoom()).toBe("1.25");
}

/** H3 — 3000 px wide: the base is 2.5, and content that fits keeps it (1080 / 428 = 2.52). */
export function aWideScreenKeepsItsBase(): void {
  setWindow(3000, 1080);
  render(<Probe contentPx={380} />);
  expect(zoom()).toBe("2.5");
}

/**
 * H4a — the observer fires with content 980 (fit 1.05): a growth of 0.02 is under the step, so the
 * zoom stays 1.03. Mutation: drop `settleWallZoom` => 1.05 => red.
 */
export function aSmallGrowthKeepsTheZoom(): void {
  render(<Probe contentPx={1000} />);
  resizeContent(980);
  expect(zoom()).toBe("1.03");
}

/** H4b — the observer fires with content 1200: 1080 / 1248 = 0.865 → 0.86. Mutation: observe nothing => red. */
export function aTallerContentShrinksTheZoom(): void {
  render(<Probe contentPx={1000} />);
  resizeContent(1200);
  expect(zoom()).toBe("0.86");
}

/** H5 — a window resize to 768 high re-measures: 768 / 1048 = 0.73. Mutation: no resize listener => red. */
export function aWindowResizeRecomputes(): void {
  render(<Probe contentPx={1000} />);
  act(() => {
    setWindow(1920, 768);
    window.dispatchEvent(new Event("resize"));
  });
  expect(zoom()).toBe("0.73");
}

/**
 * H7 (review finding) — a re-wrap jump bigger than the growth step settles instead of flipping:
 * 1.25 overflows (0.98), 0.98 grows to 1.08, 1.08 overflows again, and 1.08 is now the ceiling, so
 * the zoom stays 0.98 on every later layout. Mutation: ignore the ceiling => 1.08, 0.98, … => red.
 */
export function aRewrapJumpSettlesBelowTheCeiling(): void {
  render(<WrapProbe />);
  expect(settleWrapProbe().slice(-3)).toEqual(["0.98", "0.98", "0.98"]);
}

/**
 * H8 — a window resize clears the ceiling (a new width re-wraps differently), so the zoom may try
 * the growth again. Mutation: keep the ceiling on resize => stays 0.98 => red.
 */
export function aWindowResizeClearsTheCeiling(): void {
  render(<WrapProbe />);
  settleWrapProbe();
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
  expect(zoom()).toBe("1.08");
}

/**
 * H9 — a new tab clears the ceiling: the frame does not remount on a rotation, and a ceiling from
 * one tab must not hold a later tab's content that fits below the base. Mutation: drop the reset
 * on the key => the earlier tab's 1.25 ceiling refuses 1.25 => stays 1.03 => red.
 */
export function aNewTabClearsTheCeiling(): void {
  const { rerender } = render(<Probe contentPx={1000} tabKey="overview" />);
  expect(zoom()).toBe("1.03");
  rerender(<Probe contentPx={700} tabKey="water" />);
  expect(zoom()).toBe("1.25");
}

/** H6a — unmount disconnects the observer: it watches nothing afterwards (and watched both probes before). */
export function unmountDisconnectsTheObserver(): void {
  const { unmount } = render(<Probe contentPx={1000} />);
  expect(observers.map((observer) => observer.targets.size)).toEqual([2]);
  unmount();
  expect(observers.map((observer) => observer.targets.size)).toEqual([0]);
}

/** H6b — unmount removes the very `resize` listener the hook added. */
export function unmountRemovesTheResizeListener(): void {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { unmount } = render(<Probe contentPx={1000} />);
  const added = add.mock.calls.filter(([type]) => type === "resize").map(([, listener]) => listener);
  expect(added).toHaveLength(1);
  unmount();
  const removed = remove.mock.calls.filter(([type]) => type === "resize").map(([, listener]) => listener);
  expect(removed).toEqual(added);
}
