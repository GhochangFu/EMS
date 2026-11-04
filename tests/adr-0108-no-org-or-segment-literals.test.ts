import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR 0108 decision 5.4 — no organization code and no segment literal in the
 * new modules of the trend and energy rows.
 *
 * Decision 5.1: no code names an organization, an organization code, a
 * location or a segment to decide what a view shows; every view reads the
 * organization, its tree, `asset_domains` and the point catalog. This guard
 * scans the runtime modules those rows add (spec and test files are not
 * scanned: fixtures name segments by design) for:
 *
 *  1. an organization code from `SEED_ORGANIZATION_CODES`, as a quoted literal;
 *  2. an `asset_domains` code (the `0029` seed rows plus `PACK_ASSET_DOMAINS`),
 *     as a quoted literal;
 *  3. a SQL `LIKE` / `ILIKE` pattern literal — a point-code prefix rule, which
 *     decides what a view shows by naming codes. The one existing such rule,
 *     the `PV%` solar split, is exempt by name (below).
 *
 * The two vocabularies are parsed from their sources, never a hand list, so a
 * new organization or domain is guarded with no edit here. Comments are
 * stripped before every scan, so a docblock that names `hvac` neither fails
 * nor passes the gate.
 *
 * **Who extends it.** The first PR to merge among `F4.297`, `F4.298` and
 * `F4.300` lands this file (here `F4.298`); each other row appends its modules
 * to {@link MODULES} in its own PR, and each later row of decision 6 does the
 * same by its amendment.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * The scanned runtime modules. Every path must exist.
 *
 * `F4.298`: the modules that exist so far. Each later unit of the row moves its
 * module from {@link PENDING_MODULES} to here in the commit that creates it.
 */
const MODULES: readonly string[] = [
  "packages/shared/src/contracts/aggregate-level.ts",
  "packages/shared/src/contracts/energy-view.ts",
  "packages/shared/src/contracts/time-zone-chain.ts",
  "packages/shared/src/contracts/telemetry-queries.ts",
  "packages/shared/src/types/telemetry-history.ts",
  "packages/shared/src/types/energy-view.ts",
  "apps/api/src/reports/energy-view-range.ts",
  "apps/api/src/reports/energy-view-partial.ts",
  "apps/api/src/reports/energy-view-read.ts",
  "apps/api/src/telemetry/energy-sources.ts",
  "apps/api/src/reports/energy-view.service.ts",
  "apps/api/src/reports/view-export.serialise.ts",
  "apps/api/src/reports/energy-view-export.service.ts",
  "apps/api/src/telemetry/asset-history-export.service.ts",
  "apps/api/src/reports/energy-filter-options.ts",
  "apps/web/src/api/energy-view.ts",
  "apps/web/src/lib/energy-view-filter.ts",
  "apps/web/src/components/energy-filter-bar.tsx",
  "apps/web/src/lib/asset-history-range.ts",
  "apps/web/src/lib/asset-history-chart-option.ts",
  "apps/web/src/hooks/use-asset-history.ts",
  "apps/web/src/components/asset-history/history-format.ts",
  "apps/web/src/components/asset-history/point-list.tsx",
  "apps/web/src/components/asset-history/range-picker.tsx",
  "apps/web/src/components/asset-history/trend-chart.tsx",
  "apps/web/src/components/asset-history/bucket-table.tsx",
  "apps/web/src/components/asset-history/raw-records-table.tsx",
  "apps/web/src/pages/asset-history-page.tsx",
  "packages/shared/src/contracts/energy-organization-views.ts",
  "apps/web/src/components/assets/asset-history-link.tsx",
  "apps/api/src/trend-points/trend-points.pure.ts",
  "apps/api/src/trend-points/trend-points.service.ts",
  "apps/api/src/trend-points/trend-points.controller.ts",
  "apps/api/src/trend-points/trend-points.module.ts",
  "packages/shared/src/contracts/trend-points.ts",
  "packages/db/src/schema/trend-points-schema.ts",
  "apps/web/src/api/admin/trend-points.ts",
  "apps/web/src/pages/admin/trend-points-page.tsx",
  "apps/api/src/reports/energy-abnormal.ts",
  "apps/api/src/reports/energy-organization-reads.ts",
  "apps/api/src/reports/energy-organization-views.service.ts",
  "apps/web/src/lib/energy-stack-option.ts",
  "apps/web/src/lib/energy-organization-views.ts",
  "apps/web/src/components/energy/energy-stack-chart.tsx",
  "apps/web/src/components/energy/site-ranking-table.tsx",
  "apps/web/src/components/energy/energy-heatmap.tsx",
  "apps/web/src/components/energy/abnormal-list.tsx",
  "apps/web/src/components/energy/energy-kpi-tiles.tsx",
  "apps/web/src/components/energy/range-compare-controls.tsx",
  // F4.299 U6 rewrites these two existing files (Amendment 1, 7.10), so they are scanned too.
  "apps/web/src/components/energy-source-stack-chart.tsx",
  "apps/web/src/pages/energy-page.tsx",
  // F4.301 (ADR 0108 Amendment 2, item 11) — U1.
  "packages/shared/src/contracts/trend-strip.ts",
  "packages/shared/src/types/trend-strip.ts",
  // F4.301 U2.
  "apps/api/src/trend-points/trend-strip.pure.ts",
  "apps/api/src/trend-points/trend-strip-read.ts",
  // F4.301 U3.
  "apps/api/src/trend-points/trend-strip.service.ts",
  "apps/api/src/trend-points/trend-strip.controller.ts",
  // F4.301 U4.
  "apps/web/src/api/trend-strip.ts",
  "apps/web/src/lib/trend-strip.ts",
  "apps/web/src/components/control-room/sparkline.tsx",
  "apps/web/src/components/control-room/trend-strip.tsx",
  // F4.305 (ADR 0108 Amendment 3) — U1.
  "packages/shared/src/contracts/trend-strip-widget.ts",
  // F4.305 U3.
  "packages/db/src/site-layout-seed-upgrade-v5.ts",
  // F4.305 U4.
  "apps/web/src/components/widgets/trend-strip-widget.tsx",
  "apps/web/src/components/dashboards/trend-strip-widget-live.tsx",
  // F4.305 review (AGENTS.md §4.2) — split out of trend-strip.tsx and trend-strip-widget.tsx.
  "apps/web/src/components/control-room/trend-strip-body.tsx",
  "apps/web/src/components/widgets/trend-strip-widget-preview.tsx",
  // F4.302 (ADR 0108 Amendment 4, item 10) — U1. The rest are in PENDING_MODULES until U3–U4.
  "packages/shared/src/contracts/site-segment-views.ts",
  "packages/shared/src/types/site-segment-views.ts",
  // F4.302 U2: the api modules, plus the shared scope-join file.
  "apps/api/src/trend-points/site-asset-rows.ts",
  "apps/api/src/trend-points/segment-abnormal.ts",
  "apps/api/src/trend-points/segment-views.pure.ts",
  "apps/api/src/trend-points/segment-views-read.ts",
  "apps/api/src/trend-points/segment-views.service.ts",
  "apps/api/src/trend-points/segment-views.controller.ts",
  // F4.302 U4: the web client, the pure lib and the six control-room components.
  "apps/web/src/api/segment-views.ts",
  "apps/web/src/lib/site-trends.ts",
  "apps/web/src/components/control-room/site-trends-view.tsx",
  "apps/web/src/components/control-room/site-energy-view.tsx",
  "apps/web/src/components/control-room/segment-view.tsx",
  "apps/web/src/components/control-room/segment-trend-chart.tsx",
  "apps/web/src/components/control-room/segment-ranking-table.tsx",
  "apps/web/src/components/control-room/segment-abnormal-list.tsx",
  // F4.303 (ADR 0108 Amendment 6 item 10) — U6: the link state and "Copy link".
  "apps/web/src/lib/view-links.ts",
  "apps/web/src/components/view-actions/copy-link-button.tsx",
  // F4.303 U7: the export client and "Export".
  "apps/web/src/api/view-exports.ts",
  "apps/web/src/components/view-actions/export-menu.tsx",
  // F4.303 PR 2 U10: the report-params and widget-append contracts and their types.
  "packages/shared/src/contracts/dashboard-widget-append.ts",
  "packages/shared/src/contracts/trend-points-report.ts",
  "packages/shared/src/types/dashboard-widget-append.ts",
  "packages/shared/src/types/trend-points-report.ts",
  // F4.303 PR 2 U11: the trend_points schedule's point check.
  "apps/api/src/reports/trend-points-schedule-check.ts",
  // F4.303 PR 2 U13: the trend_points report service and its pure rows and PDF.
  "apps/api/src/reports/trend-points-report.service.ts",
  "apps/api/src/reports/trend-points-pdf.ts",
  // F4.303 PR 2 U14: the widget-append service.
  "apps/api/src/dashboard-builder/dashboard-widget-append.service.ts",
  // F4.303 PR 2 U15: the Pin dialog.
  "apps/web/src/components/view-actions/pin-dialog.tsx",
  // F4.303 PR 2 U16: the Schedule button and the prefill it hands the wizard.
  "apps/web/src/components/view-actions/schedule-button.tsx",
  "apps/web/src/lib/schedule-from-view.ts",
  // F4.306 (ADR 0108 Amendment 7) PR 1 U5: the trend strip selection's write-path check.
  "apps/api/src/dashboard-builder/trend-strip-selection.check.ts",
  // F4.306 PR 1 U7: the placement rule and the append route's trend arm.
  "packages/shared/src/trend-strip-placement.ts",
  "apps/api/src/dashboard-builder/dashboard-widget-append-strips.ts",
  // F4.306 PR 2 U10: the site trend-points client.
  "apps/web/src/api/site-trend-points.ts",
];

/**
 * The trend and energy rows' planned runtime modules that do not exist yet.
 * Each must stay absent until it is moved to {@link MODULES}: a planned module
 * that exists but is not scanned is a gap this list turns red rather than
 * leaving silent. Empty since `F4.299` U6; a later row of decision 6 lists its
 * modules here in its first commit.
 *
 * `F4.301` (ADR 0108 Amendment 2, item 11; `docs/plans/f4.301-trend-strip.md`
 * U2–U4): the runtime modules not yet created. U1 put the two shared files
 * in {@link MODULES}, U2 its two api files, U3 the service and the
 * controller, and U4 the four web files, so the list is empty again. The
 * three mount-point views (`generated-site-view.tsx`, `site-dashboard-view.tsx`,
 * `smoc-site-view.tsx`) pre-date ADR 0108 and gain one import and one JSX line
 * each, so they are not listed (the `energy-page.tsx` precedent).
 *
 * `F4.302` (Amendment 4 item 10): U4 moved the last eight web modules to {@link MODULES}, so the
 * list is empty again. `site-page.tsx` pre-dates this record and gains one entry and one branch,
 * so it is not listed.
 *
 * `F4.303` (Amendment 6 item 10; `docs/plans/f4.303-view-actions.md` C24): PR 1's seven new
 * runtime modules, listed in U1 and moved to {@link MODULES} by the unit that creates each. U6
 * moved `view-links.ts` and `copy-link-button.tsx`; U7 moved the last two
 * (`view-exports.ts`, `export-menu.tsx`), so the list is empty again.
 *
 * `F4.303` PR 2 (same plan, C24): the eleven new runtime modules, listed in U9 and moved to
 * {@link MODULES} by the unit that creates each (U10 the four shared files, U11 the schedule's
 * point check, U13 the two report files, U14 the append service, U15 `pin-dialog.tsx`, U16 the
 * last two web files), so the list is empty again.
 *
 * `F4.306` PR 2 (Amendment 7 item 10; `docs/plans/f4.306-trend-strip-wizard.md` PR 2 U8): the four
 * new web modules, listed in U8 and moved to {@link MODULES} by the unit that creates each (U10
 * the site trend-points client and the selection summary, U11 the pure wizard module, U12 the
 * wizard dialog), so the list is empty again by U12.
 */
const PENDING_MODULES: readonly string[] = [
  "apps/web/src/components/dashboards/trend-strip-selection-summary.tsx",
  "apps/web/src/lib/trend-strip-wizard.ts",
  "apps/web/src/components/dashboards/trend-strip-wizard.tsx",
];

/**
 * Files that are never scanned, each with its reason, so a later row does not
 * add them to {@link MODULES}.
 */
const EXEMPT_FILES: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: "packages/db/src/point-key-trend-defaults-seed.ts",
    reason:
      "`TREND_DEFAULT_SEED` (F4.300) is seed data that names point codes per segment on purpose — " +
      "data, not a decision in code (ADR 0108 decision 5.4).",
  },
];

/**
 * One named predicate in one named file, never the whole file. The `PV%`
 * solar-split rule pre-dates ADR 0108 (`dashboard/energy-centre.ts`,
 * `reports/reports.service.ts`, neither of them a new module, so neither is
 * scanned). `F4.298` U3's `energyPeriodRead` reuses it (ADR 0108 decision 5.4),
 * so that one predicate is removed from that one file before the scan; any
 * other pattern in the same file is still flagged. The exemption is checked
 * only once its file is in {@link MODULES}, and then the predicate must be
 * present, so a stale exemption turns red.
 */
const EXEMPT_PREDICATES: readonly { readonly path: string; readonly predicate: string; readonly reason: string }[] = [
  {
    path: "apps/api/src/reports/energy-view-read.ts",
    predicate: "code ILIKE 'PV%'",
    reason: "the existing PV% solar-split rule (ADR 0108 decision 5.4 and Consequences), reused by energyPeriodRead",
  },
];

const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;

function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

/** Every quoted literal body: "…", '…' and `…` (a template may span lines). */
function quotedLiterals(code: string): string[] {
  const out: string[] = [];
  for (const re of [/"([^"\r\n]*)"/g, /'([^'\r\n]*)'/g, /`([^`]*)`/g]) {
    for (const match of code.matchAll(re)) {
      out.push(match[1] ?? "");
    }
  }
  return out;
}

/** The literals of `code` that equal (case-insensitively) a member of `vocabulary`. */
function literalHits(code: string, vocabulary: readonly string[]): string[] {
  const lower = new Set(vocabulary.map((v) => v.toLowerCase()));
  return quotedLiterals(stripComments(code)).filter((lit) => lower.has(lit.trim().toLowerCase()));
}

/** Every SQL `LIKE` / `ILIKE` pattern literal left after comments and the named exemptions. */
function patternHits(code: string, exemptPredicates: readonly string[]): string[] {
  let stripped = stripComments(code);
  for (const predicate of exemptPredicates) {
    stripped = stripped.split(predicate).join("");
  }
  return [...stripped.matchAll(/\bI?LIKE\s+'[^']*'/gi)].map((m) => m[0]);
}

function predicatesFor(path: string): string[] {
  return EXEMPT_PREDICATES.filter((e) => e.path === path).map((e) => e.predicate);
}

function organizationCodes(): string[] {
  const source = read("packages/db/src/hierarchy-seed.ts");
  const list = /SEED_ORGANIZATION_CODES[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/["']([^"']+)["']/g)].map((m) => m[1] ?? "");
}

function segmentCodes(): string[] {
  const migration = read("packages/db/drizzle/0029_rule_category_concern_asset_domain.sql");
  const insert = /INSERT INTO bms\.asset_domains \(code, label, sort_order\) VALUES([\s\S]*?);/.exec(migration)?.[1] ?? "";
  const seeded = [...insert.matchAll(/\(\s*'([^']+)'/g)].map((m) => m[1] ?? "");
  const pack = read("packages/db/src/asset-domains-seed.ts");
  const block = /PACK_ASSET_DOMAINS[^=]*=\s*\[([\s\S]*?)\];/.exec(pack)?.[1] ?? "";
  const packed = [...block.matchAll(/code:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
  return [...seeded, ...packed];
}

describe("ADR 0108 decision 5.4 — no organization code or segment literal in the new modules", () => {
  it("every scanned module exists", () => {
    expect(MODULES.length).toBeGreaterThan(0);
    expect(MODULES.filter((path) => !existsSync(join(repoRoot, path)))).toEqual([]);
  });

  it("no planned module exists unscanned (move it to MODULES in the commit that creates it)", () => {
    expect(PENDING_MODULES.filter((path) => existsSync(join(repoRoot, path)))).toEqual([]);
    expect(PENDING_MODULES.filter((path) => MODULES.includes(path))).toEqual([]);
  });

  it("scans no spec, test or exempt file", () => {
    expect(MODULES.filter((path) => /\.(spec|test)\.tsx?$/.test(path))).toEqual([]);
    expect(MODULES.filter((path) => EXEMPT_FILES.some((e) => e.path === path))).toEqual([]);
    expect(EXEMPT_FILES.every((e) => e.reason.length > 0)).toBe(true);
  });

  it("parses at least two organization codes from SEED_ORGANIZATION_CODES", () => {
    const codes = organizationCodes();
    expect(codes.length, `parsed ${JSON.stringify(codes)}`).toBeGreaterThanOrEqual(2);
    expect(codes).toContain("ESKOM");
  });

  it("parses at least seven segment codes from the 0029 seed and PACK_ASSET_DOMAINS", () => {
    const codes = segmentCodes();
    expect(codes.length, `parsed ${JSON.stringify(codes)}`).toBeGreaterThanOrEqual(7);
    expect(codes).toEqual(expect.arrayContaining(["electrical", "hvac", "water", "mechanical"]));
  });

  it("positive control: the scanners hit a literal and skip a comment", () => {
    const segments = segmentCodes();
    const orgs = organizationCodes();
    expect(literalHits('const x = "hvac";', segments)).toEqual(["hvac"]);
    expect(literalHits("const y = 'water';", segments)).toEqual(["water"]);
    expect(literalHits("const z = `ESKOM`;", orgs)).toEqual(["ESKOM"]);
    expect(literalHits("// hvac\n/* 'water' */\nconst ok = 1;", segments)).toEqual([]);
    expect(literalHits("// const x = \"hvac\";", segments)).toEqual([]);
    expect(patternHits("sql`WHERE p.code ILIKE 'DG%'`", [])).toEqual(["ILIKE 'DG%'"]);
  });

  it("positive control: a named predicate is exempt, and only that predicate", () => {
    const predicate = "code ILIKE 'PV%'";
    expect(patternHits(`WHERE a.${predicate}`, [])).toEqual(["ILIKE 'PV%'"]);
    expect(patternHits(`WHERE a.${predicate}`, [predicate])).toEqual([]);
    expect(patternHits(`WHERE a.${predicate} OR a.code ILIKE 'DG%'`, [predicate])).toEqual(["ILIKE 'DG%'"]);
    expect(patternHits("WHERE a.name ILIKE 'PV%'", [predicate])).toEqual(["ILIKE 'PV%'"]);
  });

  it("every exempt predicate whose file is scanned is still present there", () => {
    const stale = EXEMPT_PREDICATES.filter(
      (e) => MODULES.includes(e.path) && !stripComments(read(e.path)).includes(e.predicate),
    );
    expect(stale).toEqual([]);
    expect(EXEMPT_PREDICATES.every((e) => e.reason.length > 0)).toBe(true);
  });

  it("no scanned module names an organization code", () => {
    const codes = organizationCodes();
    const offenders = MODULES.flatMap((path) => literalHits(read(path), codes).map((hit) => `${path}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it("no scanned module names a segment code", () => {
    const codes = segmentCodes();
    const offenders = MODULES.flatMap((path) => literalHits(read(path), codes).map((hit) => `${path}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it("no scanned module carries a point-code LIKE pattern outside the named exemption", () => {
    const offenders = MODULES.flatMap((path) =>
      patternHits(read(path), predicatesFor(path)).map((hit) => `${path}: ${hit}`),
    );
    expect(offenders).toEqual([]);
  });
});
