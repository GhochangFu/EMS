import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import { FRESH_MS } from "../../lib/schematic-telemetry";
import { useReportNewestRead } from "../dashboards/newest-read-context";
import { WallFrame } from "./wall-frame";

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D8, D9) — the wall frame: no app shell, the
 * site name, a seconds clock, the newest read's "Updated" / "Live data paused since" line, the
 * interval select, the Resume control and Exit wall.
 *
 * Assertions live here; `wall-frame.test.tsx` is the Vitest entry point and carries the jsdom
 * docblock (ADR 0014, ADR 0042 decision 2). The child is a stand-in that reports a read through
 * `useReportNewestRead` and carries two tab links, as `SiteDashboardView` would. Fake timers fake
 * the interval functions and `Date` only, so user-event's own delays still run.
 */

const SITE = "/control-room/site/p1";
const READ_AT = new Date(2026, 9, 2, 10, 15, 30).getTime();

export function setUpFrame(): void {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(READ_AT + 5_000);
}

export function tearDownFrame(): void {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (offsetHeightDescriptor !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
    offsetHeightDescriptor = undefined;
  }
}

let offsetHeightDescriptor: PropertyDescriptor | undefined;

/**
 * `F3.77` follow-up — jsdom has no layout: the bar (`[data-wall-bar]`) is 48 px, the content
 * wrapper (`[data-wall-content]`) `contentPx`, every other element 0, on a 1920 × 1080 window.
 * Restored by `tearDownFrame`.
 */
function layOut(contentPx: number): void {
  vi.stubGlobal("innerWidth", 1920);
  vi.stubGlobal("innerHeight", 1080);
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-wall-bar") ? 48 : this.hasAttribute("data-wall-content") ? contentPx : 0;
    },
  });
}

function Reporter({ ms }: { ms: number | null }) {
  const report = useReportNewestRead();
  useEffect(() => {
    report(ms);
  }, [report, ms]);
  return (
    <div>
      <Link to={`${SITE}/overview`}>Overview</Link>
      <Link to={`${SITE}/sld`}>SLD</Link>
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderFrame(readMs: number | null = READ_AT): void {
  render(
    <MemoryRouter initialEntries={[`${SITE}/sld?wall=1&every=30`]}>
      <Routes>
        <Route
          path="/control-room/site/:locationId/:tab?"
          element={
            <>
              <WallFrame
                siteName="Lotapata"
                sitePath={SITE}
                tabKeys={["overview", "sld"]}
                currentKey="sld"
                everyS={30}
              >
                <Reporter ms={readMs} />
              </WallFrame>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** F1 — no app-shell landmark (header banner, nav, footer); the site name is the `h1`. */
export function theFrameHasNoShellLandmarks(): void {
  renderFrame();
  expect(screen.getByRole("heading", { level: 1, name: "Lotapata" })).toBeInTheDocument();
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("contentinfo")).toBeNull();
}

/** F2 — the bar's clock shows seconds and moves each second. */
export function theClockShowsSeconds(): void {
  renderFrame();
  const clock = screen.getByTestId("wall-clock");
  expect(clock.textContent).toMatch(/10:15:35/);
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(clock.textContent).toMatch(/10:15:36/);
}

/** F3 — a fresh reported read shows as "Updated hh:mm:ss". */
export function aFreshReadShowsUpdated(): void {
  renderFrame();
  expect(screen.getByTestId("wall-read")).toHaveTextContent("Updated 10:15:30");
}

/** F4 — once the read is past `FRESH_MS`, the bar's own clock turns the line to paused. */
export function aStaleReadShowsPaused(): void {
  vi.setSystemTime(READ_AT);
  renderFrame();
  expect(screen.getByTestId("wall-read"), "control: live while fresh").toHaveTextContent("Updated 10:15:30");
  act(() => {
    vi.advanceTimersByTime(FRESH_MS + 1_000);
  });
  expect(screen.getByTestId("wall-read")).toHaveTextContent("Live data paused since 10:15:30");
}

/** F5 — no read at all is "Live data paused", with no time. */
export function noReadShowsPausedWithNoTime(): void {
  renderFrame(null);
  expect(screen.getByTestId("wall-read").textContent).toBe("Live data paused");
}

/** F6 — the interval select rewrites `every` in the URL and keeps the tab. */
export function theSelectChangesEvery(): void {
  renderFrame();
  const select = screen.getByRole("combobox", { name: "Rotate every" });
  expect(select).toHaveValue("30");
  fireEvent.change(select, { target: { value: "60" } });
  expect(screen.getByTestId("location").textContent).toBe(`${SITE}/sld?wall=1&every=60`);
}

/** F7 — "Exit wall" links to the bare tab path, without the wall parameters. */
export function exitWallLinksToTheBareTabPath(): void {
  renderFrame();
  expect(screen.getByRole("link", { name: "Exit wall" })).toHaveAttribute("href", `${SITE}/sld`);
}

/** F8 — Resume shows only while paused; a click on it resumes and hides it again. */
export function resumeShowsOnlyWhilePaused(): void {
  renderFrame();
  expect(screen.queryByRole("button", { name: "Paused — Resume" }), "control: hidden while running").toBeNull();
  fireEvent.pointerDown(screen.getByRole("link", { name: "SLD" }));
  const resume = screen.getByRole("button", { name: "Paused — Resume" });
  fireEvent.click(resume);
  expect(screen.queryByRole("button", { name: "Paused — Resume" })).toBeNull();
}

/** F9 — the keyboard reaches the Resume control and the tabs. */
export async function tabReachesResumeAndTheTabs(): Promise<void> {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  renderFrame();
  // The first key pauses (it is pressed outside the bar), and Resume appears.
  const reached: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    await user.tab();
    const active = document.activeElement;
    reached.push(active?.textContent ?? "");
  }
  expect(reached).toEqual(expect.arrayContaining(["Paused — Resume", "Overview", "SLD"]));
}

function wallRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("[data-wall-root]");
  expect(root, "the zoomed wall root").not.toBeNull();
  return root as HTMLElement;
}

/**
 * F10a (`F3.77` follow-up, plan D5) — the wall root's zoom is the computed fit of the bar plus the
 * content wrapper: 1080 / (48 + 1000) → 1.03, not the stylesheet's old constant 1.25. Mutation: a
 * fixed `zoom: 1.25`, or `contentRef` on another element => red.
 */
export function theRootZoomIsTheComputedFit(): void {
  layOut(1000);
  renderFrame();
  expect(wallRoot().style.zoom).toBe("1.03");
}

/**
 * F10b — `min-h-screen` sits on an unzoomed outer element, never on the zoomed root, so `100vh`
 * is never resolved inside the zoomed box. Mutation: `min-h-screen` back on the root => red.
 */
export function theScreenHeightIsOutsideTheZoom(): void {
  layOut(1000);
  renderFrame();
  const root = wallRoot();
  expect([root.classList.contains("min-h-screen"), root.parentElement?.classList.contains("min-h-screen")]).toEqual([
    false,
    true,
  ]);
  expect(root.parentElement?.style.zoom, "the outer element is not zoomed").toBe("");
}
