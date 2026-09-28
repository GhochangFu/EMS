import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLASS_OVERRIDES, roleFor, SHADE_ROLES } from "./support/colour-role-map";
import { webColourSourceFiles } from "./support/colour-scan";
import { paletteClasses } from "./support/colour-scan";
import { deltaE2000, parseTokenBlocks, resolveTailwindShade } from "./support/colour-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F3.65a` — the shade-to-role mapping table (plan `docs/plans/f3.65a-colour-tokens.md` §2.3, §4
 * U5). `SHADE_ROLES` (`tests/support/colour-role-map.ts`) is the 76 distinct shades
 * `apps/web/src/**\/*.tsx` used (§2.1) before this row, each carrying the role its uses folded
 * into: `kind: "exact"` when the role's light token *is* the shade's Tailwind value, `kind:
 * "merged"` when the shade was folded into the nearest role of its purpose (ΔE2000 recorded).
 *
 * `roleFor` additionally resolves a class-level split (`CLASS_OVERRIDES`) — the same shade
 * carries a different role depending on the utility (`text-white` → `on-dark`, not the shade's
 * default `surface`).
 *
 * `violet-700` (Fix A, owner ruling 2026-09-28) is a 77th `SHADE_ROLES` row rather than a
 * `CLASS_OVERRIDES` entry: `lib/value-provenance.ts` is `.ts`, so §2.1's 76-shade count (scoped to
 * `.tsx`) never counted it, but M4 walks the whole tree and needs a resolution for it. It used to
 * be a `CLASS_OVERRIDES` entry mapping to `ink-faint`; the owner ruled it keeps its own colour as
 * the 41st role, `simulated-ink`, so the override was removed in favour of an exact `SHADE_ROLES`
 * row.
 */

const css = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
const { light } = parseTokenBlocks(css);

function roleLightHex(role: string): string {
  const channels = light.get(role);
  if (!channels) throw new Error(`role "${role}" has no light token`);
  const [r, g, b] = channels;
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

describe("F3.65a colour mapping table", () => {
  it("M1 the 76 shades of §2.3 plus violet-700 (lib/value-provenance.ts, owner ruling 2026-09-28) are all present, no extras", () => {
    expect(SHADE_ROLES).toHaveLength(77);
    const shades = new Set(SHADE_ROLES.map((r) => r.shade));
    expect(shades.size).toBe(77);
  });

  it("M1b roleFor(\"text-violet-700\") resolves to simulated-ink, not the old ink-faint override", () => {
    expect(roleFor("text-violet-700")).toEqual({ role: "simulated-ink", kind: "exact" });
  });


  it("M2 every exact row's role light token equals resolveTailwindShade(shade)", () => {
    const mismatches: string[] = [];
    for (const row of SHADE_ROLES) {
      if (row.kind !== "exact") continue;
      const expected = resolveTailwindShade(row.shade).toUpperCase();
      const actual = roleLightHex(row.role);
      if (actual !== expected) {
        mismatches.push(`${row.shade}: role "${row.role}" light is ${actual}, expected ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("M3 every merged row's recorded deltaE equals deltaE2000(shade hex, role light hex) to 2dp", () => {
    const mismatches: string[] = [];
    for (const row of SHADE_ROLES) {
      if (row.kind !== "merged") continue;
      const compareTo = row.compareHex ?? roleLightHex(row.role);
      const computed = Math.round(deltaE2000(row.hex, compareTo) * 100) / 100;
      if (computed !== row.deltaE) {
        mismatches.push(`${row.shade}: recorded ${row.deltaE}, computed ${computed}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("M4 every palette class the tree uses resolves through roleFor", () => {
    const unresolved: string[] = [];
    for (const file of webColourSourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const cls of paletteClasses(src)) {
        try {
          roleFor(cls);
        } catch (err) {
          unresolved.push(`${file}: ${cls} — ${(err as Error).message}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("M5 every role a row or override names exists in the token file", () => {
    const missing: string[] = [];
    const roleNames = new Set(light.keys());
    for (const row of SHADE_ROLES) {
      if (!roleNames.has(row.role)) missing.push(`${row.shade}: role "${row.role}"`);
      for (const alt of row.altRoles ?? []) {
        if (!roleNames.has(alt)) missing.push(`${row.shade}: altRole "${alt}"`);
      }
    }
    for (const [cls, override] of Object.entries(CLASS_OVERRIDES)) {
      if (!roleNames.has(override.role)) missing.push(`${cls}: role "${override.role}"`);
      for (const alt of override.altRoles ?? []) {
        if (!roleNames.has(alt)) missing.push(`${cls}: altRole "${alt}"`);
      }
    }
    expect(missing).toEqual([]);
  });
});
