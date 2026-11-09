import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { webColourSourceFiles } from "./support/colour-scan";
import { parseTokenBlocks } from "./support/colour-tokens";
import { parseDesignBlocks, type DesignBlock } from "./support/design-tokens";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 7 (ADR 0118 Amendment 1 A6; Amendment 2 P1, P4, P7) — the type and readability
 * rules, read from the design-token blocks, not from class strings (class strings are shared by
 * every design system; plan D8).
 *
 * A6 is a hard gate for the four non-default design systems; `nexus-soft` is grandfathered (P1:
 * it keeps today's sizes under 12px, weight 700 and tracked capitals). Each rule below runs over
 * every block of those four that exists: their blocks land in PRs 8–11, and PR 11 makes "every
 * design system has both blocks" a gate (DS1).
 *
 *  - **R1** `--weight-bold` and `--weight-semibold` ≤ 600.
 *  - **R2** `--caps-transform: none`, and both tracking tokens `0`.
 *  - **R3** `--text-3xs` and `--text-2xs` ≥ 12px.
 *  - **R4** every `--space-N` on the 4px scale.
 *  - **R5** in **every** block, `nexus-soft` included (P4), `--text-wall-min` ≥ 16px and
 *    `--text-base` ≥ it; `index.css` raises every step under 16px to it on `[data-wall-root]`.
 *  - **R6** one breadcrumb component renders a `<nav aria-label="Breadcrumb">` with an `<ol>`, and
 *    no other source renders a breadcrumb nav.
 */

const INDEX_CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
const BLOCKS = parseDesignBlocks(INDEX_CSS, new Set(parseTokenBlocks(INDEX_CSS).light.keys()));
const NON_DEFAULT = DESIGN_SYSTEMS.filter((d) => d !== "nexus-soft");

function blocksOf(names: readonly string[]): Array<[string, DesignBlock]> {
  const out: Array<[string, DesignBlock]> = [];
  for (const name of names) {
    if (name === "nexus-soft") {
      out.push(["nexus-soft neumorphic", BLOCKS.base.neumorphic], ["nexus-soft flat", BLOCKS.base.flat]);
      continue;
    }
    const v = BLOCKS.designs.get(name);
    if (v?.neumorphic) out.push([`${name} neumorphic`, v.neumorphic]);
    if (v?.flat) out.push([`${name} flat`, v.flat]);
  }
  return out;
}

/** A length token in px (`px` as is, `rem` × 16). Anything else is NaN, which fails every rule. */
function px(value: string | undefined): number {
  const m = /^(\d*\.?\d+)(px|rem)$/.exec((value ?? "").trim());
  if (!m) return Number.NaN;
  return m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
}

/** The A6 offences of one block (R1–R4). */
export function a6Offences(where: string, block: DesignBlock): string[] {
  const out: string[] = [];
  for (const t of ["--weight-bold", "--weight-semibold"]) {
    if (!(Number(block.get(t)) <= 600)) out.push(`${where} R1 ${t} = ${block.get(t)}`);
  }
  if (block.get("--caps-transform") !== "none") out.push(`${where} R2 --caps-transform = ${block.get("--caps-transform")}`);
  for (const t of ["--caps-tracking-wide", "--caps-tracking-wider"]) {
    if (!/^0(?:em|px|rem)?$/.test(block.get(t) ?? "")) out.push(`${where} R2 ${t} = ${block.get(t)}`);
  }
  for (const t of ["--text-3xs", "--text-2xs"]) {
    if (!(px(block.get(t)) >= 12)) out.push(`${where} R3 ${t} = ${block.get(t)}`);
  }
  for (let n = 1; n <= 8; n++) {
    const v = px(block.get(`--space-${n}`));
    if (!(Number.isFinite(v) && v % 4 === 0)) out.push(`${where} R4 --space-${n} = ${block.get(`--space-${n}`)}`);
  }
  return out;
}

describe("F4.341 A6 the type rules (the four non-default design systems)", () => {
  it("R1–R4 every block of a non-default design system keeps A6", () => {
    expect(blocksOf(NON_DEFAULT).flatMap(([where, block]) => a6Offences(where, block))).toEqual([]);
  });

  it("R1–R4 the rules are live: nexus-soft (grandfathered, P1) breaks each of them", () => {
    const offences = a6Offences("nexus-soft", BLOCKS.base.neumorphic).map((o) => o.split(" ")[1]);
    expect(new Set(offences)).toEqual(new Set(["R1", "R2", "R3"]));
  });

  it("R5 every block, nexus-soft included, sets a wall minimum ≥ 16px and a base step ≥ it", () => {
    const low = blocksOf(DESIGN_SYSTEMS)
      .filter(([, b]) => !(px(b.get("--text-wall-min")) >= 16 && px(b.get("--text-base")) >= px(b.get("--text-wall-min"))))
      .map(([where, b]) => `${where}: wall ${b.get("--text-wall-min")}, base ${b.get("--text-base")}`);
    expect(low).toEqual([]);
  });

  it("R5 the wall raises every step under 16px to the wall minimum", () => {
    const css = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const body = /\[data-wall-root\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const step of ["3xs", "2xs", "xs", "sm"]) expect(body, step).toContain(`--text-${step}: var(--text-wall-min);`);
  });

  it("R5 the wall frame carries data-wall-root", () => {
    expect(readFileSync(join(repoRoot, "apps/web/src/components/control-room/wall-frame.tsx"), "utf8")).toMatch(/<div data-wall-root\b/);
  });
});

describe("F4.341 A6 the breadcrumb", () => {
  const BREADCRUMB = "apps/web/src/components/breadcrumb.tsx";

  it("R6 the breadcrumb component is a nav named Breadcrumb holding an ordered list", () => {
    const text = blankComments(readFileSync(join(repoRoot, BREADCRUMB), "utf8"));
    expect(text).toMatch(/<nav aria-label="Breadcrumb">\s*<ol\b/);
    expect(text).toMatch(/aria-current=\{last \? "page" : undefined\}/);
    expect(text).not.toMatch(/\buppercase\b|tracking-\[/);
  });

  it("R6 no other source renders a breadcrumb nav; both trails use the component", () => {
    const others = webColourSourceFiles()
      .filter((f) => /\.tsx$/.test(f))
      .map((f) => relative(repoRoot, f).split("\\").join("/"))
      .filter((f) => f !== BREADCRUMB && /aria-label="Breadcrumb"/.test(blankComments(readFileSync(join(repoRoot, f), "utf8"))));
    expect(others).toEqual([]);
    for (const f of ["apps/web/src/components/admin/admin-breadcrumb.tsx", "apps/web/src/components/control-room/control-room-breadcrumb.tsx"]) {
      expect(readFileSync(join(repoRoot, f), "utf8"), f).toContain("<Breadcrumb steps=");
    }
  });
});
