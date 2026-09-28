import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { readDocumentTheme, type Theme } from "../lib/theme";
import { useThemeStore } from "../stores/theme-store";
import { ThemeSwitch } from "./theme-switch";

/**
 * `F3.65c` U10 — the visible Light / Dark switch (ADR 0078 decision 4, plan U10). Assertions live
 * here; `theme-switch.test.tsx` is the Vitest entry point and carries the jsdom docblock
 * (ADR 0014, ADR 0042 decision 2).
 *
 * `startIn(theme)` sets the attribute the boot script in `index.html` would have set and moves
 * the store to what it reads from that attribute — the store's own read of the attribute at
 * creation is held by the theme-store spec's S1; here the claim is that the control shows the
 * store's theme and moves it.
 */

function startIn(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  useThemeStore.setState({ theme: readDocumentTheme() });
  render(<ThemeSwitch />);
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Theme" });
}

function light(): HTMLElement {
  return within(group()).getByRole("button", { name: "Light" });
}

function dark(): HTMLElement {
  return within(group()).getByRole("button", { name: "Dark" });
}

/** W1 — a group named "Theme" holds exactly two buttons, "Light" then "Dark". */
export function w1NamesAGroupOfTwoButtons(): void {
  startIn("light");
  const names = within(group())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual(["Light", "Dark"]);
}

/** W2 — under `data-theme="light"` Light is pressed. */
export function w2PressesLightInLight(): void {
  startIn("light");
  expect(light().getAttribute("aria-pressed")).toBe("true");
}

/** W2 — under `data-theme="light"` Dark is not pressed. */
export function w2LeavesDarkUnpressedInLight(): void {
  startIn("light");
  expect(dark().getAttribute("aria-pressed")).toBe("false");
}

/** W2 — under `data-theme="dark"` Dark is pressed on mount. */
export function w2PressesDarkInDark(): void {
  startIn("dark");
  expect(dark().getAttribute("aria-pressed")).toBe("true");
}

/** W2 — under `data-theme="dark"` Light is not pressed on mount. */
export function w2LeavesLightUnpressedInDark(): void {
  startIn("dark");
  expect(light().getAttribute("aria-pressed")).toBe("false");
}

/** W3 — clicking Dark sets `data-theme="dark"` on `<html>`, without a reload. */
export async function w3DarkSetsTheAttribute(): Promise<void> {
  startIn("light");
  await userEvent.click(dark());
  expect(document.documentElement.dataset.theme).toBe("dark");
}

/** W3 — clicking Dark writes `"dark"` to `bms.theme`. */
export async function w3DarkWritesDark(): Promise<void> {
  startIn("light");
  await userEvent.click(dark());
  expect(localStorage.getItem("bms.theme")).toBe("dark");
}

/** W3 — clicking Dark presses Dark. */
export async function w3DarkPressesDark(): Promise<void> {
  startIn("light");
  await userEvent.click(dark());
  expect(dark().getAttribute("aria-pressed")).toBe("true");
}

/** W3 — clicking Dark releases Light. */
export async function w3DarkReleasesLight(): Promise<void> {
  startIn("light");
  await userEvent.click(dark());
  expect(light().getAttribute("aria-pressed")).toBe("false");
}

/** W4 — clicking Light writes `"light"`; it does not remove the key (plan D1). */
export async function w4LightWritesLight(): Promise<void> {
  startIn("dark");
  await userEvent.click(light());
  expect(localStorage.getItem("bms.theme")).toBe("light");
}

/** W4 — clicking Light sets `data-theme="light"`. */
export async function w4LightSetsTheAttribute(): Promise<void> {
  startIn("dark");
  await userEvent.click(light());
  expect(document.documentElement.dataset.theme).toBe("light");
}

/** W5 — Tab reaches Dark: Light first, then Dark (native buttons, document order). */
export async function w5TabReachesDark(): Promise<void> {
  startIn("light");
  await userEvent.tab();
  await userEvent.tab();
  expect(document.activeElement).toBe(dark());
}

/** W5 — Enter on the focused Dark button activates it. */
export async function w5EnterActivatesDark(): Promise<void> {
  startIn("light");
  dark().focus();
  await userEvent.keyboard("{Enter}");
  expect(document.documentElement.dataset.theme).toBe("dark");
}

/** W5 — Space on the focused Dark button activates it. */
export async function w5SpaceActivatesDark(): Promise<void> {
  startIn("light");
  dark().focus();
  await userEvent.keyboard(" ");
  expect(document.documentElement.dataset.theme).toBe("dark");
}

/** W6 — a `localStorage.setItem` that throws still flips the attribute. */
export async function w6AThrowingStorageStillFlipsTheAttribute(): Promise<void> {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  startIn("light");
  await userEvent.click(dark());
  expect(document.documentElement.dataset.theme).toBe("dark");
}

/** W6 — a `localStorage.setItem` that throws still presses Dark. */
export async function w6AThrowingStorageStillPressesDark(): Promise<void> {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  startIn("light");
  await userEvent.click(dark());
  expect(dark().getAttribute("aria-pressed")).toBe("true");
}

/** W7 — the Light button shows the sun glyph, not a word. */
export function w7LightShowsTheSunGlyph(): void {
  startIn("light");
  expect(light().querySelector('svg[data-icon="sun"]')).not.toBeNull();
}

/** W7 — the Dark button shows the moon glyph, not a word. */
export function w7DarkShowsTheMoonGlyph(): void {
  startIn("light");
  expect(dark().querySelector('svg[data-icon="moon"]')).not.toBeNull();
}

/** W7 — neither button carries visible text; the name comes from `aria-label`. */
export function w7ButtonsCarryNoVisibleText(): void {
  startIn("light");
  expect([light().textContent, dark().textContent]).toEqual(["", ""]);
}

/** W7 — each glyph is hidden from assistive technology, so the name is not read twice. */
export function w7GlyphsAreAriaHidden(): void {
  startIn("light");
  expect(
    [...group().querySelectorAll("svg")].map((svg) => svg.getAttribute("aria-hidden")),
  ).toEqual(["true", "true"]);
}

/** W7 — each button has a hover tooltip naming its theme. */
export function w7ButtonsHaveATooltip(): void {
  startIn("light");
  expect([light().getAttribute("title"), dark().getAttribute("title")]).toEqual([
    "Light theme",
    "Dark theme",
  ]);
}
