import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { parseTokenBlocks } from "./support/colour-tokens";
import { parseDesignBlocks } from "./support/design-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.349` — a dialog or drawer (`.surface-dialog`) lies over the page, so its ground must be
 * opaque in every design system. `swiss-grid` draws its cards transparent under an ink rule
 * (`--card-ground: transparent`), and the dialog, which paints `var(--card-ground)`, showed the page
 * through its text (owner report 2026-11-10, the Appearance dialog on AWS). The gate resolves the
 * dialog's ground per design system: the design system's own `.surface-dialog` rule if it sets one,
 * else its `--card-ground`; neither may be transparent.
 */
const CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const blocks = parseDesignBlocks(CSS, new Set(parseTokenBlocks(CSS).light.keys()));

function ownDialogGround(design: string): string | undefined {
  for (const m of CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (!selectors.includes(`:where(html[data-design="${design}"]) .surface-dialog`)) continue;
    const bg = /background-color:\s*([^;]+);/.exec(m[2]!)?.[1]?.trim();
    if (bg) return bg;
  }
  return undefined;
}

function dialogGround(design: string, variant: "neumorphic" | "flat"): string {
  const block = design === "nexus-soft" ? blocks.base[variant] : blocks.designs.get(design)?.[variant];
  return ownDialogGround(design) ?? block?.get("--card-ground")?.trim() ?? "";
}

describe("F4.349 every dialog is opaque", () => {
  it.each([...DESIGN_SYSTEMS])("%s paints its dialogs on an opaque ground, in both variants", (design) => {
    for (const variant of ["neumorphic", "flat"] as const) {
      const ground = dialogGround(design, variant);
      expect(ground, `${design} ${variant}`).not.toBe("");
      expect(ground, `${design} ${variant}`).not.toMatch(/transparent|\/\s*0(\.\d+)?\)|rgba?\([^)]*,\s*0(\.\d+)?\)/);
    }
  });

  it("swiss-grid's cards stay transparent (the gate is not vacuous)", () => {
    expect(blocks.designs.get("swiss-grid")?.neumorphic?.get("--card-ground")?.trim()).toBe("transparent");
  });
});
