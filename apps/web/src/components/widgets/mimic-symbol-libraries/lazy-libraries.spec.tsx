import { render, screen, waitFor } from "@testing-library/react";
import { librarySymbolEntries, type MimicSymbolLibraryCode } from "@bms/shared";
import { expect, vi } from "vitest";

import type { MimicGlyphKind } from "../../../lib/mimic";

/**
 * `F3.32h` (ADR 0086 slice-2 ruling R12) — the `qet`, `wmpid` and `drawio` libraries load on first
 * use. Each claim resets the module registry and imports the store fresh, so no claim sees a load
 * an earlier one made. `lazy-libraries.test.tsx` is the Vitest entry.
 */

type Store = typeof import(".");

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import(".");
}

function firstKey(code: MimicSymbolLibraryCode): string {
  const key = librarySymbolEntries(code)[0]?.key;
  expect(key, `${code} holds at least one key`).toBeDefined();
  return key ?? "";
}

/** L1 — a `qet` key has no shapes before its library loads, and has them after. */
export async function aLazyKeyHasShapesOnlyAfterItsLoad(): Promise<void> {
  const store = await freshStore();
  const key = firstKey("qet");
  expect(store.librarySymbolShapes(key)).toBeNull();
  expect(store.lazyLibraryState(key)).toBe("loading");
  await store.ensureLibraryShapes(["qet"]);
  expect(store.librarySymbolShapes(key)?.shapes.length ?? 0).toBeGreaterThan(0);
  expect(store.lazyLibraryState(key)).toBe("loaded");
}

/** L2 — a load reads only the libraries asked for: loading `qet` leaves `wmpid` unloaded. */
export async function aLoadReadsOnlyTheLibrariesAskedFor(): Promise<void> {
  const store = await freshStore();
  await store.ensureLibraryShapes(["qet"]);
  // Positive control: the asked library did load.
  expect(store.lazyLibraryState(firstKey("qet"))).toBe("loaded");
  expect(store.librarySymbolShapes(firstKey("wmpid"))).toBeNull();
  expect(store.lazyLibraryState(firstKey("wmpid"))).toBe("loading");
}

/** L3 — a static library's key draws at once and is never "loading". */
export async function aStaticKeyNeedsNoLoad(): Promise<void> {
  const store = await freshStore();
  const key = firstKey("tabler");
  expect(store.librarySymbolShapes(key)?.style).toBe("stroke");
  expect(store.lazyLibraryState(key)).toBe("static");
}

/** L4 — a lazy library's notice is absent before its load and verbatim after. */
export async function aLazyNoticeArrivesWithItsLoad(): Promise<void> {
  const store = await freshStore();
  expect(store.mimicLibraryNotice("drawio")).toBeNull();
  await store.ensureLibraryShapes(["drawio"]);
  expect(store.mimicLibraryNotice("drawio")).toContain("Converted by scripts/mimic-symbols/generate.mjs");
}

/** L5 — a failed load (a stale chunk) is "failed", and the next call retries and loads. */
export async function aFailedLoadIsRetried(): Promise<void> {
  vi.doMock("./qet.generated", () => {
    throw new Error("Failed to fetch dynamically imported module");
  });
  const store = await freshStore();
  const key = firstKey("qet");
  await store.ensureLibraryShapes(["qet"]);
  expect(store.lazyLibraryState(key)).toBe("failed");
  expect(store.librarySymbolShapes(key)).toBeNull();
  vi.doUnmock("./qet.generated");
  await store.ensureLibraryShapes(["qet"]);
  expect(store.lazyLibraryState(key)).toBe("loaded");
  expect(store.librarySymbolShapes(key)).not.toBeNull();
}

/** L6 — a glyph of an unloaded library draws a skeleton, then its own shapes once the load lands. */
export async function aGlyphDrawsASkeletonThenItsShapes(): Promise<void> {
  vi.resetModules();
  const { MimicGlyph } = await import("../mimic-glyphs");
  const key = firstKey("wmpid");
  render(
    <svg>
      <MimicGlyph kind={key as MimicGlyphKind} x={0} y={0} size={24} className="stroke-info" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph).toHaveAttribute("data-glyph-loading", "true");
  expect(glyph).not.toHaveAttribute("data-glyph-fallback");
  await waitFor(() => expect(screen.getByTestId("mimic-glyph")).not.toHaveAttribute("data-glyph-loading"));
  expect(screen.getByTestId("mimic-glyph")).not.toHaveAttribute("data-glyph-fallback");
}

/** L7 — once its library loaded, a key the library lacks draws the fallback, not a skeleton. */
export async function aStaleLazyKeyDrawsTheFallbackAfterTheLoad(): Promise<void> {
  vi.resetModules();
  const store: Store = await import(".");
  const { MimicGlyph } = await import("../mimic-glyphs");
  await store.ensureLibraryShapes(["qet"]);
  render(
    <svg>
      <MimicGlyph kind={"qet:no-such-symbol" as MimicGlyphKind} x={0} y={0} size={24} className="stroke-info" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph).toHaveAttribute("data-glyph-fallback", "true");
  expect(glyph).not.toHaveAttribute("data-glyph-loading");
}
