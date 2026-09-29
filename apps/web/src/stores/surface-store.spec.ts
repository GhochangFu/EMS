import { expect, vi } from "vitest";

/**
 * `F3.71` — the surface store (ADR 0085 decision 1, plan §3). Assertions live here;
 * `surface-store.test.ts` is the Vitest entry point and carries the jsdom docblock (ADR 0014).
 *
 * Every case imports a fresh module after setting the attribute, so the store's initial state is
 * read from the attribute the boot script set — a store that hard-coded `"neumorphic"` fails U1.
 */

async function freshStore(attribute: "neumorphic" | "flat" | null) {
  if (attribute === null) document.documentElement.removeAttribute("data-surface");
  else document.documentElement.setAttribute("data-surface", attribute);
  vi.resetModules();
  return import("./surface-store");
}

function throwingStorage(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
}

/** U1 — a flat attribute starts the store at Flat. */
export async function u1InitialSurfaceFollowsAFlatAttribute(): Promise<void> {
  const { useSurfaceStore } = await freshStore("flat");
  expect(useSurfaceStore.getState().surface).toBe("flat");
}

/** U1 — a neumorphic attribute starts the store at Neumorphic. */
export async function u1InitialSurfaceFollowsANeumorphicAttribute(): Promise<void> {
  const { useSurfaceStore } = await freshStore("neumorphic");
  expect(useSurfaceStore.getState().surface).toBe("neumorphic");
}

/** U1 — no attribute (the boot script never ran) starts the store at the default, Neumorphic. */
export async function u1AMissingAttributeStartsNeumorphic(): Promise<void> {
  const { useSurfaceStore } = await freshStore(null);
  expect(useSurfaceStore.getState().surface).toBe("neumorphic");
}

/** U2 — `setSurface("flat")` sets `data-surface="flat"`. */
export async function u2SetFlatSetsTheAttribute(): Promise<void> {
  const { useSurfaceStore } = await freshStore("neumorphic");
  useSurfaceStore.getState().setSurface("flat");
  expect(document.documentElement.dataset.surface).toBe("flat");
}

/** U2 — `setSurface("flat")` writes `"flat"` to `bms.surface`. */
export async function u2SetFlatWritesFlat(): Promise<void> {
  const { useSurfaceStore } = await freshStore("neumorphic");
  useSurfaceStore.getState().setSurface("flat");
  expect(localStorage.getItem("bms.surface")).toBe("flat");
}

/** U2 — `setSurface("flat")` moves the store. */
export async function u2SetFlatMovesTheState(): Promise<void> {
  const { useSurfaceStore } = await freshStore("neumorphic");
  useSurfaceStore.getState().setSurface("flat");
  expect(useSurfaceStore.getState().surface).toBe("flat");
}

/** U3 — `setSurface("neumorphic")` writes `"neumorphic"`; it does not remove the key. */
export async function u3SetNeumorphicWritesNeumorphic(): Promise<void> {
  const { useSurfaceStore } = await freshStore("flat");
  useSurfaceStore.getState().setSurface("neumorphic");
  expect(localStorage.getItem("bms.surface")).toBe("neumorphic");
}

/** U4 — a `localStorage.setItem` that throws still flips the attribute. */
export async function u4AThrowingStorageStillFlipsTheAttribute(): Promise<void> {
  const { useSurfaceStore } = await freshStore("neumorphic");
  throwingStorage();
  useSurfaceStore.getState().setSurface("flat");
  expect(document.documentElement.dataset.surface).toBe("flat");
}

/** U4 — a `localStorage.setItem` that throws still moves the store. */
export async function u4AThrowingStorageStillMovesTheStore(): Promise<void> {
  const { useSurfaceStore } = await freshStore("neumorphic");
  throwingStorage();
  useSurfaceStore.getState().setSurface("flat");
  expect(useSurfaceStore.getState().surface).toBe("flat");
}
