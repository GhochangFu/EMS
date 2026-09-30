import { expect } from "vitest";

/**
 * `F3.32h` (ADR 0086 slice-2 ruling R12) — the `qet`, `wmpid` and `drawio` shape modules and the
 * per-file credits stay out of the main chunk. One static value import of any of them, anywhere in
 * `apps/web/src`, pulls it back (+77 KB gzip) with every test still green; this scan is the gate.
 * Only `credits.ts` may import the `*.credits.generated` modules, because `credits.ts` itself is
 * reached by a dynamic `import()`. `chunk-split.test.ts` is the Vitest entry.
 */

/** Every production source of `apps/web/src` as text, keyed by its path from the web root (`/src/...`). The web
 * tsconfig carries no Node types, so Vite's `import.meta.glob` reads the files, not `node:fs`. */
const SOURCES: Readonly<Record<string, string>> = import.meta.glob(
  ["/src/**/*.{ts,tsx}", "!/src/**/*.spec.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);
const SRC_PREFIX = "/src/";
const CREDITS_MODULE = "components/widgets/mimic-symbol-libraries/credits.ts";
const STORE_MODULE = "components/widgets/mimic-symbol-libraries/index.ts";

/** Static value imports and re-exports, anchored at a line start so docblock prose never matches.
 * `import type` / `export type` are erased at compile time and are skipped. */
export function staticSpecifiers(text: string): string[] {
  return [...text.matchAll(/^(import|export)(?!\s+type\b)\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[2] ?? "");
}

/** Whether `specifier` names a lazy module: a lazy library's shapes or credits, or `credits`. */
export function namesALazyModule(specifier: string): boolean {
  return (
    /(^|\/)(qet|wmpid|drawio)(\.credits)?\.generated$/.test(specifier) ||
    /(^|\/)mimic-symbol-libraries\/credits$/.test(specifier) ||
    specifier === "./credits"
  );
}

/** The sources keyed by their path under `apps/web/src`. */
function sources(): Array<[string, string]> {
  return Object.entries(SOURCES).map(([path, text]) => [
    path.startsWith(SRC_PREFIX) ? path.slice(SRC_PREFIX.length) : path,
    text,
  ]);
}

/** C1 — the scan recognises a value import and a re-export, and skips a type-only import. */
export function theScanRecognisesEveryForm(): void {
  const lazy = (text: string): boolean => staticSpecifiers(text).some(namesALazyModule);
  expect(lazy('import { QET_SHAPES } from "./qet.generated";')).toBe(true);
  expect(lazy('export * from "./credits";')).toBe(true);
  expect(lazy('import { libraryCredits } from "../components/widgets/mimic-symbol-libraries/credits";')).toBe(true);
  expect(lazy('import {\n  DRAWIO_SHAPES,\n} from "./drawio.generated";')).toBe(true);
  expect(lazy('import type { MimicSymbolCredit } from "./credits";')).toBe(false);
  expect(lazy('import { TABLER_SHAPES } from "./tabler.generated";')).toBe(false);
}

/** C2 — no production module statically imports a lazy module, except `credits.ts` its own credits. */
export function noModuleStaticallyImportsALazyModule(): void {
  const files = sources();
  // Positive control: the glob reached the web sources, the store and the credits module included.
  expect(files.length).toBeGreaterThan(100);
  expect(files.map(([rel]) => rel)).toEqual(expect.arrayContaining([STORE_MODULE, CREDITS_MODULE, "app.tsx"]));
  const offenders = files.flatMap(([rel, text]) =>
    staticSpecifiers(text)
      .filter(namesALazyModule)
      .filter((spec) => !(rel === CREDITS_MODULE && /\.credits\.generated$/.test(spec)))
      .map((spec) => `${rel} -> ${spec}`),
  );
  expect(offenders, "Load these modules through ensureLibraryShapes or loadLibraryCredits (dynamic import).").toEqual([]);
}

/** C3 — the store reaches each lazy module through a dynamic `import()`. */
export function theStoreImportsEachLazyModuleDynamically(): void {
  const store = sources().find(([rel]) => rel === STORE_MODULE)?.[1] ?? "";
  for (const specifier of ["./qet.generated", "./wmpid.generated", "./drawio.generated", "./credits"]) {
    expect(store, specifier).toContain(`import("${specifier}")`);
  }
}
