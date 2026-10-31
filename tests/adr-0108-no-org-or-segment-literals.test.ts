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
  "apps/api/src/reports/energy-filter-options.ts",
  "apps/web/src/api/energy-view.ts",
  "apps/web/src/lib/energy-view-filter.ts",
  "apps/web/src/components/energy-filter-bar.tsx",
  "apps/web/src/lib/asset-history-range.ts",
  "apps/web/src/lib/asset-history-chart-option.ts",
];

/**
 * `F4.298`'s planned runtime modules (`docs/plans/f4.298-energy-filter.md`
 * U2–U6) that do not exist yet. Each must stay absent until it is moved to
 * {@link MODULES}: a planned module that exists but is not scanned is a gap
 * this list turns red rather than leaving silent. Empty since U5; U6 rewrites
 * `energy-page.tsx`, which pre-dates ADR 0108 and is not a new module.
 */
const PENDING_MODULES: readonly string[] = [];

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
