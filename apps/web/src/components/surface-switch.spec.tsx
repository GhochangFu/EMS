import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { readDocumentSurface, type Surface } from "../lib/surface";
import { useSurfaceStore } from "../stores/surface-store";
import { SurfaceSwitch } from "./surface-switch";

/**
 * `F3.71` — the visible Neumorphic / Flat switch (ADR 0085 decision 1, plan §3). Assertions live
 * here; `surface-switch.test.tsx` is the Vitest entry point and carries the jsdom docblock
 * (ADR 0014). `startIn(surface)` sets the attribute the boot script would have set and moves the
 * store to what it reads from it — the store's own read at creation is held by its U1.
 */

function startIn(surface: Surface): void {
  document.documentElement.setAttribute("data-surface", surface);
  useSurfaceStore.setState({ surface: readDocumentSurface() });
  render(<SurfaceSwitch />);
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Surface" });
}

function neumorphic(): HTMLElement {
  return within(group()).getByRole("button", { name: "Neumorphic" });
}

function flat(): HTMLElement {
  return within(group()).getByRole("button", { name: "Flat" });
}

/** W1 — a group named "Surface" holds exactly two buttons, "Neumorphic" then "Flat". */
export function w1NamesAGroupOfTwoButtons(): void {
  startIn("neumorphic");
  const names = within(group())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual(["Neumorphic", "Flat"]);
}

/** W2 — under `data-surface="neumorphic"` Neumorphic is pressed. */
export function w2PressesNeumorphicInNeumorphic(): void {
  startIn("neumorphic");
  expect(neumorphic().getAttribute("aria-pressed")).toBe("true");
}

/** W2 — under `data-surface="neumorphic"` Flat is not pressed. */
export function w2LeavesFlatUnpressedInNeumorphic(): void {
  startIn("neumorphic");
  expect(flat().getAttribute("aria-pressed")).toBe("false");
}

/** W2 — under `data-surface="flat"` Flat is pressed on mount. */
export function w2PressesFlatInFlat(): void {
  startIn("flat");
  expect(flat().getAttribute("aria-pressed")).toBe("true");
}

/** W3 — clicking Flat sets `data-surface="flat"` on `<html>`, without a reload. */
export async function w3FlatSetsTheAttribute(): Promise<void> {
  startIn("neumorphic");
  await userEvent.click(flat());
  expect(document.documentElement.dataset.surface).toBe("flat");
}

/** W3 — clicking Flat writes `"flat"` to `bms.surface`. */
export async function w3FlatWritesFlat(): Promise<void> {
  startIn("neumorphic");
  await userEvent.click(flat());
  expect(localStorage.getItem("bms.surface")).toBe("flat");
}

/** W3 — clicking Flat presses Flat. */
export async function w3FlatPressesFlat(): Promise<void> {
  startIn("neumorphic");
  await userEvent.click(flat());
  expect(flat().getAttribute("aria-pressed")).toBe("true");
}

/** W4 — clicking Neumorphic writes `"neumorphic"`; it does not remove the key. */
export async function w4NeumorphicWritesNeumorphic(): Promise<void> {
  startIn("flat");
  await userEvent.click(neumorphic());
  expect(localStorage.getItem("bms.surface")).toBe("neumorphic");
}

/** W4 — clicking Neumorphic sets `data-surface="neumorphic"`. */
export async function w4NeumorphicSetsTheAttribute(): Promise<void> {
  startIn("flat");
  await userEvent.click(neumorphic());
  expect(document.documentElement.dataset.surface).toBe("neumorphic");
}

/** W5 — Space on the focused Flat button activates it (a native button). */
export async function w5SpaceActivatesFlat(): Promise<void> {
  startIn("neumorphic");
  flat().focus();
  await userEvent.keyboard(" ");
  expect(document.documentElement.dataset.surface).toBe("flat");
}

/** W6 — a `localStorage.setItem` that throws still flips the attribute. */
export async function w6AThrowingStorageStillFlipsTheAttribute(): Promise<void> {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  startIn("neumorphic");
  await userEvent.click(flat());
  expect(document.documentElement.dataset.surface).toBe("flat");
}

/** W7 — each button shows its glyph and no visible text. */
export function w7ButtonsShowAGlyphAndNoText(): void {
  startIn("neumorphic");
  expect([
    neumorphic().querySelector('svg[data-icon="layers"]') !== null,
    flat().querySelector('svg[data-icon="square"]') !== null,
    neumorphic().textContent,
    flat().textContent,
  ]).toEqual([true, true, "", ""]);
}

/** W7 — each button has a hover tooltip naming its style. */
export function w7ButtonsHaveATooltip(): void {
  startIn("neumorphic");
  expect([neumorphic().getAttribute("title"), flat().getAttribute("title")]).toEqual([
    "Neumorphic surfaces",
    "Flat surfaces",
  ]);
}
