import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { ROLE_NAMES, THEME_STORAGE_KEY } from "../apps/web/src/lib/theme";
import { parseTokenBlocks } from "./support/colour-tokens";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot, walk } from "./support/source-scan";

/**
 * `F3.65c` — the theme seam's single-source gates (plan `docs/plans/f3.65c-charts-schematics-switch.md`
 * §4 U1, ADR 0078 decisions 4 and 5).
 *
 *  - **G1** `ROLE_NAMES` in `apps/web/src/lib/theme.ts` is exactly the role list of `index.css`'s
 *    light block — a role added to the CSS but not to the resolver would never reach a chart, and a
 *    name in the resolver with no token would throw at render.
 *  - **G2** `THEME_STORAGE_KEY` is the key the boot script in `apps/web/index.html` reads — the
 *    single-source check `F3.65a` D7 deferred to the row that adds a writer.
 *  - **G3** one resolver: no file under `apps/web/src` other than `lib/theme.ts` calls
 *    `getComputedStyle(document.documentElement)`. Comments are blanked first, so prose that names
 *    the call is not a call.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");
const THEME_TS = "apps/web/src/lib/theme.ts";

/** The boot script's `localStorage.getItem("…")` key, extracted from the real `index.html`. */
function bootScriptKey(): string {
  const html = readFileSync(join(repoRoot, "apps/web/index.html"), "utf8");
  const keys = [...html.matchAll(/localStorage\.getItem\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  if (keys.length !== 1) throw new Error(`expected one localStorage.getItem key in index.html, found ${keys.length}`);
  return keys[0];
}

const ROOT_STYLE_CALL = /getComputedStyle\s*\(\s*document\.documentElement\s*\)/g;

/** `path:line` of every real `getComputedStyle(document.documentElement)` call in `src`. */
function rootStyleCalls(src: string, file: string): string[] {
  const text = blankComments(src);
  return [...text.matchAll(ROOT_STYLE_CALL)].map((m) => `${file}:${text.slice(0, m.index).split("\n").length}`);
}

describe("F3.65c theme gates", () => {
  it("G1 ROLE_NAMES equals the light block's roles of index.css", () => {
    const css = readFileSync(join(WEB_SRC, "index.css"), "utf8");
    const roles = [...parseTokenBlocks(css).light.keys()].sort();
    expect([...ROLE_NAMES].sort()).toEqual(roles);
  });

  it("G2 THEME_STORAGE_KEY is the key the boot script reads", () => {
    expect(THEME_STORAGE_KEY).toBe(bootScriptKey());
  });

  it("G3 only lib/theme.ts reads getComputedStyle(document.documentElement)", () => {
    const calls = walk(WEB_SRC)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => ({ full: f, file: relative(repoRoot, f).split("\\").join("/") }))
      .filter(({ file }) => file !== THEME_TS)
      .flatMap(({ full, file }) => rootStyleCalls(readFileSync(full, "utf8"), file));
    expect(calls).toEqual([]);
  });

  it("G3 the scan finds the call in lib/theme.ts (the scan is live)", () => {
    const src = readFileSync(join(repoRoot, THEME_TS), "utf8");
    expect(rootStyleCalls(src, THEME_TS)).toHaveLength(1);
  });

  it("G3 the scan does not count a call inside a comment", () => {
    const src = "/* getComputedStyle(document.documentElement) */\n// getComputedStyle(document.documentElement)\n";
    expect(rootStyleCalls(src, "x.ts")).toEqual([]);
  });
});
