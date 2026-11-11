import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { FIXED_ROLES, PROFILE_ROLES } from "../apps/web/src/lib/theme";
import { webColourSourceFiles } from "./support/colour-scan";
import { channelsToHex, contrastRatio, parseProfileBlocks, parseTokenBlocks, profileTokens } from "./support/colour-tokens";
import { parseDesignBlocks, type DesignBlock } from "./support/design-tokens";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 7 (ADR 0118 Amendment 1 A5; Amendment 2 P1/P7: A5 applies to every design system,
 * `nexus-soft` included) — the accent allow-list. `accent` paints only the primary button, the
 * focus ring, links, a selection (a selected tab, navigation item, segment or toggle) and the
 * wordmark. No tile, card, ground, border decoration or chart series is filled or drawn in it.
 *
 *  - **A5a** in `index.css`, a rule that names `accent` (a `var(--accent…)` or an `@apply`'d
 *    `*-accent*` utility) is on `ALLOWED_RULES`, with its reason.
 *  - **A5b** opaque `bg-accent` / `bg-accent-strong` / `from-accent` class tokens (with any
 *    variant, `hover:` included) only in the files of `ACCENT_FILL_FILES`, at exactly those counts.
 *    Every listed site is a primary button or a selection (PR 7's body classifies them); the other
 *    sites moved to `ok` (live and normal states, the KPI tone bars), `neutral-ink` (quantity and
 *    progress bars, the nominal map pin), `series-1` (a chart swatch) or `chrome` (the copilot tile,
 *    the user's chat bubble).
 *  - **A5c** no chart series is `accent`: `SERIES_PALETTE` starts at `series-1`, and no chart
 *    module reads `roles.accent`.
 *  - **A5d** no `.surface-button-primary` rule carries a shadow, in any design system.
 *  - **A5e** the secondary button edge (`--button-edge`) is a role ≥ 3:1 against the card and page
 *    grounds of its design block, in every profile × theme.
 */

const INDEX_CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
const CSS = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));

/** The `index.css` rules allowed to name `accent`, with the reason. Exact. */
const ALLOWED_RULES: Record<string, string> = {
  ".surface-button": "a secondary button reads as a link (`accent-strong` text)",
  ".surface-tab-selected": "a selected tab",
  ':where([data-surface="flat"]) .surface-tab-selected': "a selected tab (flat)",
  ".surface-nav-item-selected": "the active navigation item",
  ':where([data-surface="flat"]) .surface-nav-item-selected': "the active navigation item (flat)",
  ".surface-segment-item-selected": "a selected segment",
  ':where([data-surface="flat"]) .surface-segment-item-selected': "a selected segment (flat)",
  ':where(html[data-design="enterprise-flat"]) .surface-nav-item-selected': "enterprise-flat's active navigation item (a 12% wash)",
};

function accentRules(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith(":root") || selector.startsWith("html")) continue; // the token blocks
    if (/var\(--accent|(?:^|\s)[a-z:-]*-accent(?:-strong|-on-chrome)?(?:\/\d+)?(?=\s|;)/.test(m[2])) out.push(selector);
  }
  return out;
}

const ACCENT_FILL = /(?<![\w/-])(?:[a-z-]+:)*(?:bg-accent(?:-strong)?|from-accent(?:-strong)?)(?![\w/-])/g;

/** Today's opaque accent fills per file: every one a primary button or a selection. Exact. */
const ACCENT_FILL_FILES: Record<string, number> = {
  "apps/web/src/components/admin/location-move-dialog.tsx": 1,
  "apps/web/src/components/appearance/appearance-panel.tsx": 2,
  "apps/web/src/components/asset-history/range-picker.tsx": 1,
  "apps/web/src/components/asset-templates/alarms-tab.tsx": 1,
  "apps/web/src/components/asset-templates/calculations-tab.tsx": 1,
  "apps/web/src/components/asset-templates/dashboards-tab.tsx": 1,
  "apps/web/src/components/asset-templates/details-tab.tsx": 1,
  "apps/web/src/components/asset-templates/instantiate-wizard.tsx": 1,
  "apps/web/src/components/asset-templates/kpis-tab.tsx": 1,
  "apps/web/src/components/asset-templates/maintenance-tab.tsx": 1,
  "apps/web/src/components/asset-templates/points-tab.tsx": 1,
  "apps/web/src/components/assets/asset-point-bulk-edit-panel.tsx": 1,
  "apps/web/src/components/assets/mapping-sheet-panel.tsx": 2,
  "apps/web/src/components/assets/point-calc-override-panel.tsx": 1,
  "apps/web/src/components/control-room/scoped-action-link.tsx": 1,
  "apps/web/src/components/control-room/segment-ranking-table.tsx": 1,
  "apps/web/src/components/control-room/trend-strip-body.tsx": 1,
  "apps/web/src/components/copilot/copilot-dock-frame.tsx": 1,
  "apps/web/src/components/copilot/copilot-dock.tsx": 1,
  "apps/web/src/components/copilot/onboarding-skill-panel.tsx": 1,
  "apps/web/src/components/dashboards/duplicate-dashboard-dialog.tsx": 1,
  "apps/web/src/components/dashboards/trend-strip-wizard.tsx": 2,
  "apps/web/src/components/energy/site-ranking-table.tsx": 1,
  "apps/web/src/components/maintenance-schedules-panel.tsx": 4,
  "apps/web/src/components/mimic-editor/palette.tsx": 1,
  "apps/web/src/components/onboarding/draft-drawer.tsx": 1,
  "apps/web/src/components/reports-panel.tsx": 1,
  "apps/web/src/components/rules-panel.tsx": 2,
  "apps/web/src/components/view-actions/pin-dialog.tsx": 1,
  "apps/web/src/components/widgets/cost-by-day-chart-widget.tsx": 1,
  "apps/web/src/pages/admin/ai-assistant-page.tsx": 1,
  "apps/web/src/pages/admin/asset-points-page.tsx": 2,
  "apps/web/src/pages/admin/asset-template-detail-page.tsx": 1,
  "apps/web/src/pages/admin/asset-template-stock-view-page.tsx": 1,
  "apps/web/src/pages/admin/asset-template-versions-page.tsx": 2,
  "apps/web/src/pages/admin/asset-templates-page.tsx": 1,
  "apps/web/src/pages/admin/assets-page.tsx": 1,
  "apps/web/src/pages/admin/calc-parameters-page.tsx": 1,
  "apps/web/src/pages/admin/dashboard-template-detail-page.tsx": 3,
  "apps/web/src/pages/admin/dashboard-template-stock-view-page.tsx": 1,
  "apps/web/src/pages/admin/dashboard-templates-page.tsx": 1,
  "apps/web/src/pages/admin/edge-gateways-page.tsx": 1,
  "apps/web/src/pages/admin/escalation-profiles-page.tsx": 2,
  "apps/web/src/pages/admin/location-types-page.tsx": 1,
  "apps/web/src/pages/admin/locations-page.tsx": 1,
  "apps/web/src/pages/admin/mimic-layout-editor-page.tsx": 2,
  "apps/web/src/pages/admin/mimic-layouts-page.tsx": 1,
  "apps/web/src/pages/admin/mimic-symbol-libraries-page.tsx": 1,
  "apps/web/src/pages/admin/notification-channels-page.tsx": 1,
  "apps/web/src/pages/admin/organizations-page.tsx": 3,
  "apps/web/src/pages/admin/payload-formats-page.tsx": 1,
  "apps/web/src/pages/admin/point-key-states-page.tsx": 1,
  "apps/web/src/pages/admin/point-keys-page.tsx": 1,
  "apps/web/src/pages/admin/rtus-page.tsx": 1,
  "apps/web/src/pages/admin/telemetry-import-page.tsx": 1,
  "apps/web/src/pages/admin/trend-points-page.tsx": 1,
  "apps/web/src/pages/admin/unit-roles-page.tsx": 1,
  "apps/web/src/pages/admin/users-page.tsx": 2,
  "apps/web/src/pages/alarms-page.tsx": 2,
  "apps/web/src/pages/energy-page.tsx": 1,
  "apps/web/src/pages/login-page.tsx": 4,
  "apps/web/src/pages/work-orders-page.tsx": 4,
};

function accentFills(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const full of webColourSourceFiles().filter((f) => /\.tsx?$/.test(f))) {
    const n = [...blankComments(readFileSync(full, "utf8")).matchAll(ACCENT_FILL)].length;
    if (n > 0) out[relative(repoRoot, full).split("\\").join("/")] = n;
  }
  return out;
}

const sorted = (r: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

describe("F4.341 A5 the accent allow-list (every design system)", () => {
  it("A5a every index.css rule that names accent is on the allow-list", () => {
    expect(accentRules(CSS).filter((s) => !(s in ALLOWED_RULES))).toEqual([]);
  });

  it("A5a every allow-list rule still names accent (the list cannot go stale)", () => {
    expect(Object.keys(ALLOWED_RULES).filter((s) => !accentRules(CSS).includes(s))).toEqual([]);
  });

  it("A5a the scan is live: a card ground in accent is caught", () => {
    expect(accentRules(".surface-raised { background-color: rgb(var(--accent)); } .x { @apply bg-accent/10; }")).toEqual([".surface-raised", ".x"]);
  });

  it("A5b opaque accent fills appear only in the allow-listed files, at exactly those counts", () => {
    expect(sorted(accentFills())).toEqual(sorted(ACCENT_FILL_FILES));
  });

  it("A5b the scan is live: it counts variants and the strong step, not a translucent fill or a text role", () => {
    const sample = "bg-accent hover:bg-accent-strong from-accent bg-accent/10 text-accent text-on-accent bg-accent-on-chrome";
    expect([...sample.matchAll(ACCENT_FILL)].map((m) => m[0])).toEqual(["bg-accent", "hover:bg-accent-strong", "from-accent"]);
  });

  it("A5c the series palette starts at series-1 and names no accent; no chart module reads roles.accent", () => {
    const theme = readFileSync(join(repoRoot, "apps/web/src/lib/chart-theme.ts"), "utf8");
    const palette = /const SERIES_PALETTE: readonly RoleName\[\] = \[([^\]]*)\]/.exec(theme)?.[1] ?? "";
    expect(palette.split(",")[0]?.trim()).toBe('"series-1"');
    expect(palette).not.toMatch(/"accent/);
    const readers = webColourSourceFiles()
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /roles\.accent\b|roles\[\s*"accent"\s*\]/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(repoRoot, f));
    expect(readers).toEqual([]);
  });

  it("A5c no chart, sparkline or trend module names the accent role as a series or stroke", () => {
    const chartish = /(?:chart|echarts|sparkline|trend-strip|heatmap)[^/]*\.tsx?$/;
    const offenders = webColourSourceFiles()
      .filter((f) => chartish.test(f))
      .filter((f) => /["']accent(?:-strong)?["']/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(repoRoot, f));
    expect(offenders).toEqual([]);
  });

  it("A5d no surface-button-primary rule carries a shadow, in any design system", () => {
    const shadowed = [...CSS.matchAll(/([^{}]*\.surface-button-primary[^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => /box-shadow|@apply[^;]*\bshadow/.test(m[2]))
      .map((m) => m[1].trim());
    expect(shadowed).toEqual([]);
    expect([...CSS.matchAll(/\.surface-button-primary\s*\{/g)].length).toBeGreaterThan(0);
  });
});

const BASE = parseTokenBlocks(INDEX_CSS);
const PROFILES = parseProfileBlocks(INDEX_CSS, { names: COLOUR_PROFILES, defaultName: "nexus", profileRoles: PROFILE_ROLES, fixedRoles: FIXED_ROLES });
const DESIGN = parseDesignBlocks(INDEX_CSS, new Set(BASE.light.keys()));

function designBlocks(): Array<[string, DesignBlock]> {
  const out: Array<[string, DesignBlock]> = [
    ["nexus-soft neumorphic", DESIGN.base.neumorphic],
    ["nexus-soft flat", DESIGN.base.flat],
  ];
  for (const [name, v] of DESIGN.designs) {
    if (v.neumorphic) out.push([`${name} neumorphic`, v.neumorphic]);
    if (v.flat) out.push([`${name} flat`, v.flat]);
  }
  return out;
}

/** The role a token names as `rgb(var(--role))`, or throws. */
function roleOf(where: string, value: string | undefined): string {
  const m = /^rgb\(var\(--([a-z0-9-]+)\)\)$/.exec(value ?? "");
  if (!m) throw new Error(`${where}: "${value}" is not rgb(var(--role))`);
  return m[1];
}

describe("F4.341 A5e the secondary button edge", () => {
  it("A5e --button-edge is ≥ 3:1 on the card and page grounds of each design block, every profile and theme", () => {
    const low: string[] = [];
    const profiles = [["nexus", BASE], ...[...PROFILES].map(([n, b]) => [n, profileTokens(BASE, b)] as const)] as const;
    for (const [where, block] of designBlocks()) {
      const edge = roleOf(where, block.get("--button-edge"));
      const grounds = ["--card-ground", "--page-ground"].map((t) => block.get(t) ?? "").filter((v) => v !== "transparent").map((v) => roleOf(where, v));
      for (const [name, tokens] of profiles) {
        for (const theme of ["light", "dark"] as const) {
          const map = theme === "light" ? tokens.light : tokens.dark;
          for (const ground of grounds) {
            const r = contrastRatio(channelsToHex(map.get(edge)!), channelsToHex(map.get(ground)!));
            if (r < 3) low.push(`${where} ${name} ${theme}: ${edge} on ${ground} ${r.toFixed(2)}`);
          }
        }
      }
    }
    expect(low).toEqual([]);
  });
});
