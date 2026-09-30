import { isOrgLibraryKey, libraryOfSymbol, mimicSymbolLibrary, type MimicSymbolLibraryCode } from "@bms/shared";

import type { MimicSymbolCredit } from "./credits";
import { LUCIDE_LICENCE_NOTICE, LUCIDE_SHAPES } from "./lucide.generated";
import { MDI_LICENCE_NOTICE, MDI_SHAPES } from "./mdi.generated";
import type { MimicShape } from "./shapes";
import { TABLER_LICENCE_NOTICE, TABLER_SHAPES } from "./tabler.generated";

/**
 * `F3.32e` / ADR 0084 decision 5 — the vendored path data of the preloaded libraries, by key.
 * The `*.generated.ts` modules are written by `scripts/mimic-symbols/generate.mjs`; each is typed
 * over its library's key tuple in `@bms/shared`, so a key the contract has and this package lacks
 * (or the reverse) is a compile error.
 *
 * `F3.32h` (ADR 0086 slice-2 ruling R12) — the three third-party libraries (`qet`, `wmpid`,
 * `drawio`) and their per-file credits are loaded on first use, not in the main chunk: they added
 * 77 KB gzip to it. Tabler, Lucide and MDI stay static. `ensureLibraryShapes` loads a library's
 * module once into `SHAPES`; `subscribeLibraryShapes` / `libraryShapesVersion` let a component
 * redraw when a load lands. `librarySymbolShapes` stays synchronous and answers `null` for a key
 * whose library is still loading — `lazyLibraryState` tells that apart from a stale key.
 */

export * from "./shapes";
export type { MimicSymbolCredit };

/** A library record's entries, typed: a record over an empty key tuple (a library not yet
 * curated) is `{}`, whose `Object.entries` would read as `unknown`. */
const shapeEntries = (record: Readonly<Record<string, readonly MimicShape[]>>): Array<[string, readonly MimicShape[]]> =>
  Object.entries(record);

const SHAPES = new Map<string, readonly MimicShape[]>([
  ...shapeEntries(TABLER_SHAPES),
  ...shapeEntries(LUCIDE_SHAPES),
  ...shapeEntries(MDI_SHAPES),
]);

type LazyLibraryModule = { readonly shapes: Readonly<Record<string, readonly MimicShape[]>>; readonly notice: string };

/** The libraries loaded on first use, each by its own dynamic `import()` — one chunk per library. */
const LAZY_LOADERS = {
  qet: () => import("./qet.generated").then((m): LazyLibraryModule => ({ shapes: m.QET_SHAPES, notice: m.QET_LICENCE_NOTICE })),
  wmpid: () =>
    import("./wmpid.generated").then((m): LazyLibraryModule => ({ shapes: m.WMPID_SHAPES, notice: m.WMPID_LICENCE_NOTICE })),
  drawio: () =>
    import("./drawio.generated").then((m): LazyLibraryModule => ({ shapes: m.DRAWIO_SHAPES, notice: m.DRAWIO_LICENCE_NOTICE })),
} as const satisfies Partial<Record<MimicSymbolLibraryCode, () => Promise<LazyLibraryModule>>>;

/** A library code whose shapes and notice load on first use. */
export type LazyMimicLibraryCode = keyof typeof LAZY_LOADERS;

/** Every lazy library code, in `LAZY_LOADERS` order — what a caller passes to load them all. */
export const LAZY_MIMIC_LIBRARY_CODES = Object.keys(LAZY_LOADERS) as readonly LazyMimicLibraryCode[];

/** Whether `code` names a lazy library; own keys only, so `constructor` or `__proto__` is not one. */
export function isLazyMimicLibrary(code: string): code is LazyMimicLibraryCode {
  return Object.prototype.hasOwnProperty.call(LAZY_LOADERS, code);
}

/** The static libraries' notices. Typed over every non-core code no lazy loader carries, so a new
 * library code with neither a loader nor a notice here is a compile error. */
const STATIC_NOTICES = {
  tabler: TABLER_LICENCE_NOTICE,
  lucide: LUCIDE_LICENCE_NOTICE,
  mdi: MDI_LICENCE_NOTICE,
} as const satisfies Record<Exclude<MimicSymbolLibraryCode, "core" | LazyMimicLibraryCode>, string>;

const NOTICES = new Map<MimicSymbolLibraryCode, string>(
  Object.entries(STATIC_NOTICES) as Array<[MimicSymbolLibraryCode, string]>,
);

const loaded = new Set<LazyMimicLibraryCode>();
const failed = new Set<LazyMimicLibraryCode>();
const inFlight = new Map<LazyMimicLibraryCode, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Loads each lazy library of `codes` once; a code that is static, loaded or unknown is a no-op.
 * A failed load is recorded as `"failed"`, and the next call tries again: that recovers from a
 * transient network error, but not from a chunk a redeploy removed — that needs a page reload. */
export function ensureLibraryShapes(codes: Iterable<string>): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const code of codes) {
    if (!isLazyMimicLibrary(code) || loaded.has(code)) continue;
    let promise = inFlight.get(code);
    if (promise === undefined) {
      failed.delete(code);
      promise = LAZY_LOADERS[code]()
        .then(({ shapes, notice }) => {
          for (const [key, value] of shapeEntries(shapes)) SHAPES.set(key, value);
          NOTICES.set(code, notice);
          loaded.add(code);
        })
        .catch(() => {
          failed.add(code);
        })
        .finally(() => {
          inFlight.delete(code);
          publish();
        });
      inFlight.set(code, promise);
    }
    pending.push(promise);
  }
  return Promise.all(pending).then(() => undefined);
}

/** `useSyncExternalStore`'s subscribe: called after every lazy load settles. */
export function subscribeLibraryShapes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `useSyncExternalStore`'s snapshot: grows by one each time a lazy load settles. */
export function libraryShapesVersion(): number {
  return version;
}

/** A key's lazy library state: `"static"` for a key no lazy library owns (core, Tabler, Lucide,
 * MDI, an organization key or a malformed value), else `"loading"`, `"loaded"` or `"failed"`. */
export function lazyLibraryState(key: string): "static" | "loading" | "loaded" | "failed" {
  const library = libraryOfSymbol(key);
  if (!isLazyMimicLibrary(library)) return "static";
  if (loaded.has(library)) return "loaded";
  return failed.has(library) ? "failed" : "loading";
}

/** A library key's draw style and shapes; `null` for a core key, a key no library has, or a key
 * whose lazy library is not loaded yet (`ensureLibraryShapes`). */
export function librarySymbolShapes(
  key: string,
): { readonly style: "stroke" | "fill"; readonly shapes: readonly MimicShape[] } | null {
  const shapes = SHAPES.get(key);
  if (!shapes) return null;
  // Only vendored keys are in `SHAPES`, so `library` is a static code; an organization key
  // (`F3.32f` slice 3) never reaches `mimicSymbolLibrary`.
  const library = libraryOfSymbol(key);
  if (isOrgLibraryKey(library)) return null;
  return { style: mimicSymbolLibrary(library).style, shapes };
}

/** A non-core library's licence notice, verbatim (decision 9); `null` while a lazy library loads. */
export function mimicLibraryNotice(code: Exclude<MimicSymbolLibraryCode, "core">): string | null {
  return NOTICES.get(code) ?? null;
}

/** Every loaded non-core library's notice, by code — a lazy library not loaded yet is absent. */
export function mimicLibraryNotices(): Readonly<Partial<Record<MimicSymbolLibraryCode, string>>> {
  return Object.fromEntries(NOTICES);
}

/** The per-file credits of the third-party libraries, loaded on first use (the attributions page). */
export function loadLibraryCredits(): Promise<(code: MimicSymbolLibraryCode) => ReadonlyArray<{ readonly key: string } & MimicSymbolCredit>> {
  return import("./credits").then((m) => m.libraryCredits);
}
