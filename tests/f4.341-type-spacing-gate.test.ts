import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { webColourSourceFiles } from "./support/colour-scan";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 1a — the type and spacing zero gate (ADR 0118 decision 3, plan
 * `docs/plans/f4.341-selectable-design-systems.md` §5 PR 1a).
 *
 * Since `tailwind.config.js` maps every named text and spacing step to a design token (DT1, DT2),
 * a "raw" size is an **arbitrary** utility or an inline literal: those are the values a design
 * system cannot reach.
 *
 *  - **Z1** arbitrary `text-[<size>]` utilities, per file, held to an exact `Z1_FLOOR` (both
 *    directions: a new site fails, and a swept site must lower its row). PRs 1b/1c sweep them and
 *    the last deletes the table, making Z1 a hard zero.
 *  - **Z2** arbitrary padding, gap, `space-*` and `leading-*` utilities: zero.
 *  - **Z3** inline `fontSize:` / `padding:` / `gap:` literals (ECharts options, CodeMirror's
 *    theme), per file, held to an exact `Z3_FLOOR` until PR 4 makes the chart text read the type
 *    tokens. An SVG `<text fontSize={…}>` attribute is drawing geometry (decision 15) and is not
 *    counted; `Z3_EXEMPT` names the two non-type sites with their reason.
 *  - **Z4** the `surface-*` rules of `index.css` hold no `font-size`, `padding`, `gap`,
 *    `border-radius` or `min-height` literal: each reads a design token.
 *  - **Z5** `index.css` holds no `backdrop-filter` (ADR 0118 Amendment 1 A1).
 */

const rel = (full: string): string => relative(repoRoot, full).split("\\").join("/");

const ARBITRARY_TEXT_SIZE = /\btext-\[(?:\d|\.\d|length:|calc\(|var\(|clamp\()/g;
const ARBITRARY_SPACING = /(?<![\w-])-?(?:p[xytblrse]?|gap(?:-[xy])?|space-[xy]|leading)-\[/g;
const INLINE_LITERAL = /\b(?:fontSize|padding|gap)\s*:\s*[-\d"'`\[]/g;

/** Today's arbitrary text sizes per file (417 in 129 files at PR 1a; 213 after PR 1b; PR 1c deletes the table). Exact: lower a row when a file is swept. */
const Z1_FLOOR: Record<string, number> = {
  "apps/web/src/components/admin/asset-point-wizard.tsx": 2,
  "apps/web/src/components/admin/asset-templates-page-tab-strip.tsx": 1,
  "apps/web/src/components/alarm-details-panel.tsx": 1,
  "apps/web/src/components/alarm-summary-card.tsx": 1,
  "apps/web/src/components/asset-health/asset-health-card.tsx": 5,
  "apps/web/src/components/asset-health/health-summary-donut.tsx": 4,
  "apps/web/src/components/asset-history/bucket-table.tsx": 1,
  "apps/web/src/components/asset-history/point-list.tsx": 1,
  "apps/web/src/components/asset-history/range-picker.tsx": 1,
  "apps/web/src/components/asset-history/raw-records-table.tsx": 1,
  "apps/web/src/components/assets/asset-detail-panel.tsx": 1,
  "apps/web/src/components/assets/asset-image-gallery.tsx": 3,
  "apps/web/src/components/assets/asset-images-row-toggle.tsx": 1,
  "apps/web/src/components/assets/asset-kpis-card.tsx": 1,
  "apps/web/src/components/assets/asset-where.tsx": 1,
  "apps/web/src/components/assets/backfill-days-select.tsx": 1,
  "apps/web/src/components/assets/formula-suggestions.tsx": 2,
  "apps/web/src/components/assets/point-calc-override-panel.tsx": 1,
  "apps/web/src/components/copilot/attach-panel.tsx": 4,
  "apps/web/src/components/copilot/change-card.tsx": 3,
  "apps/web/src/components/copilot/confirm-card.tsx": 6,
  "apps/web/src/components/copilot/conversation-list.tsx": 1,
  "apps/web/src/components/copilot/copilot-dock-parts.tsx": 1,
  "apps/web/src/components/copilot/copilot-thread.tsx": 2,
  "apps/web/src/components/copilot/file-again-slot.tsx": 2,
  "apps/web/src/components/copilot/import-preview-card.tsx": 1,
  "apps/web/src/components/copilot/onboarding-skill-panel.tsx": 2,
  "apps/web/src/components/copilot/rule-batch-table.tsx": 4,
  "apps/web/src/components/dashboard-templates/apply-to-sites-dialog.tsx": 1,
  "apps/web/src/components/dashboard-templates/instantiate-wizard.tsx": 4,
  "apps/web/src/components/dashboard-templates/replace-site-layouts-wizard.tsx": 2,
  "apps/web/src/components/dashboard-templates/site-template-tab-editor.tsx": 1,
  "apps/web/src/components/dashboard-templates/widget-editor.tsx": 14,
  "apps/web/src/components/energy/abnormal-list.tsx": 1,
  "apps/web/src/components/energy/site-ranking-table.tsx": 1,
  "apps/web/src/components/kpi-tile.tsx": 4,
  "apps/web/src/components/location-kpi-card.tsx": 2,
  "apps/web/src/components/maintenance-schedules-panel.tsx": 8,
  "apps/web/src/components/mimic-editor/inspector.tsx": 2,
  "apps/web/src/components/mimic-editor/palette.tsx": 2,
  "apps/web/src/components/mimic-editor/point-list-field.tsx": 3,
  "apps/web/src/components/onboarding/discovery-panel.tsx": 11,
  "apps/web/src/components/onboarding/draft-drawer.tsx": 13,
  "apps/web/src/components/onboarding/onboarding-commit-wizard.tsx": 1,
  "apps/web/src/components/onboarding/same-credentials-copy.tsx": 4,
  "apps/web/src/components/page-header.tsx": 1,
  "apps/web/src/components/reports-panel.tsx": 1,
  "apps/web/src/components/rule-channels-editor.tsx": 3,
  "apps/web/src/components/rules-panel.tsx": 6,
  "apps/web/src/components/rules/rule-batch-wizard.tsx": 1,
  "apps/web/src/components/section-card.tsx": 1,
  "apps/web/src/components/static-value.tsx": 2,
  "apps/web/src/components/status-pill.tsx": 1,
  "apps/web/src/components/widgets/chart-widget.tsx": 4,
  "apps/web/src/components/widgets/cost-by-day-chart-widget.tsx": 2,
  "apps/web/src/components/widgets/mimic-widget.tsx": 1,
  "apps/web/src/components/widgets/state-legend-widget.tsx": 1,
  "apps/web/src/components/widgets/table-widget.tsx": 1,
  "apps/web/src/components/widgets/tank-level-widget.tsx": 1,
  "apps/web/src/components/widgets/widget-frame.tsx": 2,
  "apps/web/src/components/work-orders/work-order-wizard.tsx": 1,
  "apps/web/src/components/world-map.tsx": 3,
  "apps/web/src/layouts/app-shell.tsx": 3,
  "apps/web/src/pages/admin/asset-points-page.tsx": 1,
  "apps/web/src/pages/admin/asset-template-detail-page.tsx": 1,
  "apps/web/src/pages/admin/asset-templates-page.tsx": 5,
  "apps/web/src/pages/admin/calc-parameters-page.tsx": 1,
  "apps/web/src/pages/admin/dashboard-builder-edit-page.tsx": 2,
  "apps/web/src/pages/admin/dashboard-builder-page.tsx": 3,
  "apps/web/src/pages/admin/dashboard-template-detail-page.tsx": 4,
  "apps/web/src/pages/admin/dashboard-templates-page.tsx": 6,
  "apps/web/src/pages/admin/rtus-page.tsx": 1,
  "apps/web/src/pages/alarm-kb-page.tsx": 2,
  "apps/web/src/pages/alarms-page.tsx": 2,
  "apps/web/src/pages/assets-page.tsx": 1,
  "apps/web/src/pages/crac-page.tsx": 1,
  "apps/web/src/pages/dashboard-page.tsx": 1,
  "apps/web/src/pages/dashboards-page.tsx": 1,
  "apps/web/src/pages/login-page.tsx": 5,
  "apps/web/src/pages/sld-page.tsx": 1,
  "apps/web/src/pages/work-orders-page.tsx": 11,
};

/** Today's inline type and spacing literals per file (31 sites). Exact. PR 4 empties it. */
const Z3_FLOOR: Record<string, number> = {
  "apps/web/src/components/asset-templates/formula-editor.tsx": 2,
  "apps/web/src/components/control-room/segment-trend-chart.tsx": 3,
  "apps/web/src/components/energy-top-bar-chart.tsx": 3,
  "apps/web/src/components/energy/energy-heatmap.tsx": 2,
  "apps/web/src/components/load-trend-chart.tsx": 3,
  "apps/web/src/lib/cost-by-day-chart.ts": 2,
  "apps/web/src/lib/energy-stack-option.ts": 4,
  "apps/web/src/lib/widget-echarts-option.ts": 12,
};

/** Inline literals that are not type or spacing of the page, with the reason. Exact. */
const Z3_EXEMPT: Record<string, { count: number; reason: string }> = {
  "apps/web/src/components/dashboards/dashboard-canvas.tsx": {
    count: 1,
    reason: "the grid gap is GAP_PX, the constant the tile-placement arithmetic measures against",
  },
  "apps/web/src/components/world-map.tsx": {
    count: 1,
    reason: "Leaflet's fitBounds viewport padding in map pixels, not a CSS property",
  },
};

function scriptSources(): { file: string; text: string }[] {
  return webColourSourceFiles()
    .filter((f) => /\.tsx?$/.test(f))
    .map((full) => ({ file: rel(full), text: blankComments(readFileSync(full, "utf8")) }));
}

function countsBy(pattern: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { file, text } of scriptSources()) {
    const n = [...text.matchAll(pattern)].length;
    if (n > 0) out[file] = n;
  }
  return out;
}

const sorted = (r: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

describe("F4.341 the type and spacing zero gate", () => {
  it("Z1 arbitrary text sizes per file equal Z1_FLOOR exactly", () => {
    expect(sorted(countsBy(ARBITRARY_TEXT_SIZE))).toEqual(sorted(Z1_FLOOR));
  });

  it("Z1 the scan is live: it counts an arbitrary size and ignores a named step or a colour", () => {
    expect([..."text-[11px] text-[10.5px] text-xs text-ink text-[length:12px]".matchAll(ARBITRARY_TEXT_SIZE)].length).toBe(3);
  });

  it("Z2 no arbitrary padding, gap, space or leading utility", () => {
    const hits = Object.keys(countsBy(ARBITRARY_SPACING));
    expect(hits).toEqual([]);
  });

  it("Z2 the scan is live: it finds p-[…], gap-x-[…], space-y-[…], leading-[…] and not inset-[…]", () => {
    expect([..."p-[3px] px-[1rem] gap-x-[5px] space-y-[2px] leading-[1.1] -mt-[2px] inset-[2px]".matchAll(ARBITRARY_SPACING)].length).toBe(5);
  });

  it("Z3 inline fontSize / padding / gap literals per file equal Z3_FLOOR plus Z3_EXEMPT exactly", () => {
    const expected = { ...Z3_FLOOR, ...Object.fromEntries(Object.entries(Z3_EXEMPT).map(([f, e]) => [f, e.count])) };
    expect(sorted(countsBy(INLINE_LITERAL))).toEqual(sorted(expected));
  });

  it("Z3 the scan is live: it counts an option literal and not an SVG attribute or a token read", () => {
    const sample = 'axisLabel: { fontSize: 10 }, padding: "4px", <text fontSize={12}>, fontSize: type.xs';
    expect([...sample.matchAll(INLINE_LITERAL)].length).toBe(2);
  });
});

const INDEX_CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
const CSS = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
const SIZED = /(?:^|[;{\s])(font-size|padding|gap|border-radius|min-height)\s*:\s*([^;]+);/g;
/** A value that reads a token: `var(--x)`, or a `calc(…)` built on one. */
const TOKEN_VALUE = /^(?:var\(--[a-z0-9-]+\)|calc\([^;]*var\(--[a-z0-9-]+\)[^;]*\))$/;

function literalSizes(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/\.surface-/.test(m[1])) continue;
    for (const d of m[2].matchAll(SIZED)) {
      if (!TOKEN_VALUE.test(d[2].trim())) out.push(`${m[1].trim()} ${d[1]}: ${d[2].trim()}`);
    }
  }
  return out;
}

describe("F4.341 index.css reads the tokens", () => {
  it("Z4 no surface-* rule holds a font-size, padding, gap, border-radius or min-height literal", () => {
    expect(literalSizes(CSS)).toEqual([]);
  });

  it("Z4 the scan is live: a literal radius in a surface rule is found, a token read is not", () => {
    expect(literalSizes(".surface-x { border-radius: 12px; padding: var(--space-1); gap: calc(var(--space-1) / 2); }")).toEqual([
      ".surface-x border-radius: 12px",
    ]);
  });

  it("Z4 the scan reads the real surface rules", () => {
    expect([...CSS.matchAll(/\.surface-[a-z-]+\s*\{/g)].length).toBeGreaterThan(15);
  });

  it("Z5 index.css holds no backdrop-filter", () => {
    expect(CSS).not.toMatch(/backdrop-filter/);
  });
});
