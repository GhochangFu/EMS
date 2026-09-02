import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.13` — a stock asset-template catalog entry may not name a point key the
 * platform lacks (ADR 0052 Consequences, "vocabulary before content, enforced
 * twice" — this is the third and earliest time).
 *
 * `0058`'s foreign key refuses a `template_points` row whose key the platform
 * lacks, and `assertPointKeysActive` refuses the import before the insert is
 * attempted. Both fire at import time, on a running database, against a
 * catalog that already shipped. This fails it **before either, at build time**,
 * by scanning the catalog files as text against the `*_POINT_KEYS` arrays in
 * `packages/shared/src/constants.ts` — the arrays `point-keys-seed.ts` builds
 * `bms.point_keys` from, so a key outside them is one nothing can seed.
 *
 * **A new file rather than an extension of
 * `tests/f3.38-stock-catalog-vocabulary.test.ts`.** That one scans `section:`
 * lines and `assetRoleCode` values, and an asset-template catalog has neither.
 * The 6-line `*_POINT_KEYS` parser is **restated** rather than shared — `f3.38`
 * keeps its own copy, and a shared helper is a second thing to keep honest.
 *
 * **No `KEYS_AWAITING_A_VOCABULARY` analogue here.** All 33 feeder keys are in
 * the vocabulary today (`F2.11` promoted the electrical class set). ADR 0052's
 * Consequences asks for one for the **water** keys until `E5.1` promotes them —
 * that list is `E5.1`'s to write, in this file, the day `water.ts` lands, with
 * `f3.38`'s `stillOutside` clock beside it.
 */

/** The one directory every stock catalog file lives in, packs and classes alike. */
const STOCK_CATALOG_DIR = "apps/api/src/admin/asset-templates/stock-catalog";

/**
 * **EVERY file that can hold entry data — every class module, not just every
 * pack.** `stock-catalog.ts` spreads the packs and `electrical.ts` spreads the
 * six class modules `F2.12` split it into, and this scan reads TEXT, so it can
 * follow neither spread: **a class module missing from this list has its
 * `pointKey` values checked against no vocabulary at all, and every assertion
 * below stays green while checking less.**
 *
 * **A hand list that must grow with every future class is exactly the thing
 * that goes stale**, so it is no longer the only thing holding that line: the
 * directory cross-check below fails the build the moment a `.ts` file appears
 * in `STOCK_CATALOG_DIR` and is neither listed here nor named in
 * `STOCK_ASSET_SCAN_EXEMPT`. That is what `F2.13`'s docblock asked for in
 * prose and could only ask for. A new pack (`water.ts` for `E5.1`,
 * `mechanical.ts` for `E5.2`, `facility.ts` for `E5.3`) still belongs here the
 * day it lands, and the anti-vacuity lower bounds below move with it.
 */
const STOCK_ASSET_RELS = [
  `${STOCK_CATALOG_DIR}/stock-catalog.ts`,
  `${STOCK_CATALOG_DIR}/electrical.ts`,
  `${STOCK_CATALOG_DIR}/point-fields.ts`,
  `${STOCK_CATALOG_DIR}/electrical-feeder.ts`,
  `${STOCK_CATALOG_DIR}/electrical-transformer.ts`,
  `${STOCK_CATALOG_DIR}/electrical-dg-set.ts`,
  `${STOCK_CATALOG_DIR}/electrical-ups.ts`,
  `${STOCK_CATALOG_DIR}/electrical-solar-pv.ts`,
  `${STOCK_CATALOG_DIR}/electrical-apfc.ts`,
] as const;

/**
 * The only files in `STOCK_CATALOG_DIR` that may go unscanned: types, which
 * carry no string literal a point key could hide in. `*.spec.ts` and
 * `*.test.ts` are filtered before this list is consulted — they are the
 * catalog's own assertions, not catalog content.
 */
const STOCK_ASSET_SCAN_EXEMPT = ["types.ts"] as const;

const STOCK_LABEL = STOCK_ASSET_RELS.map((rel) => basename(rel)).join(" + ");
const CONSTANTS_REL = "packages/shared/src/constants.ts";

/**
 * Every code the point-key catalog can seed — the union of the `*_POINT_KEYS`
 * arrays. Restated from `f3.38`, on purpose (see the file docblock).
 */
const pointKeyVocabulary = (source: string): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const block of source.matchAll(/export const [A-Z_]*POINT_KEYS = \[([^\]]*)\]/g)) {
    for (const literal of block[1]!.matchAll(/"([a-z0-9_]+)"/g)) {
      keys.add(literal[1]!);
    }
  }
  return keys;
};

/**
 * Every `pointKey: "…"` in a catalog file — a template point's key AND an
 * alarm's `pointKey` reference, both matched by the same regex, both required
 * to exist.
 *
 * **`\bpointKey:` does NOT match `pointKeys:`** — the KPI array form
 * (`content.kpis[].pointKeys: [...]`). `F2.13` carried that as an instruction
 * rather than a check, because the catalog had no KPIs and a scan for a form
 * no file yet contained would have been a regex nobody could test. `F2.12`
 * authored the form; `scanKpiPointKeys` below is that second scan, and the
 * membership check runs over the union of the two.
 *
 * **The instruction that survives is for a THIRD form.** If a future content
 * section names a point key some other way — a dashboard widget's own
 * `pointKeys`, a health model's weights, a `sourcePointKey` — it needs a third
 * scanner and a third self-test beside these two, or its references are
 * checked by nothing here and every assertion below stays green while
 * checking less.
 */
const scanCatalog = (source: string): string[] =>
  [...source.matchAll(/\bpointKey:\s*"([^"]+)"/g)].map((match) => match[1]!);

/**
 * Every member of every `pointKeys: [ "…", "…" ]` array — the KPI array form,
 * matched in two stages so an inner literal cannot escape its array: the outer
 * match stops at the first `]`, and the inner one takes the quoted strings
 * inside that slice.
 *
 * **Deliberately the complement of `scanCatalog`, never its superset.** One
 * regex matching both forms would count each KPI reference twice — the length
 * bound below would rise while the set of checked references did not. The
 * disjointness self-test is what holds the two apart.
 */
const scanKpiPointKeys = (source: string): string[] =>
  [...source.matchAll(/\bpointKeys:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...match[1]!.matchAll(/"([^"]+)"/g)].map((literal) => literal[1]!),
  );

/**
 * The one string all three parser self-tests below run over. It was inline in
 * the first self-test until `F2.12` added a second scanner; the disjointness
 * claim is only worth anything if both scanners see the SAME text, so the
 * fixture moved out here rather than being copied. Its first three lines are
 * unchanged: a point row, an alarm row, and a KPI row carrying the array form.
 *
 * The fourth KPI **wraps its array across lines**, which is the shape a real
 * four-reference KPI takes once a formatter has been near it. `[^\]]*` matches
 * a newline, so the scan handles it — but a self-test over a single-line array
 * alone would not prove that, and a wrapped array is what pass C writes.
 */
const SCANNER_FIXTURE = [
  '{ pointKey: "voltage_vry", label: "x" },',
  '  alarms: [{ code: "a", pointKey: "current_a" }],',
  '  kpis: [{ code: "k", pointKeys: ["kw", "kva"] }, { code: "m", pointKeys: [',
  '    "dga_h2_ppm",',
  '    "dga_ch4_ppm",',
  "  ] }],",
].join("\n");

describe("F2.13 the stock asset-template catalog names point keys that exist", () => {
  const stockSources = STOCK_ASSET_RELS.map((rel) => read(rel));
  /** Both forms, one set: a declared point, an alarm's binding, a KPI's member. */
  const pointKeys = stockSources.flatMap((source) => [
    ...scanCatalog(source),
    ...scanKpiPointKeys(source),
  ]);
  const vocabulary = pointKeyVocabulary(read(CONSTANTS_REL));

  it("every file in STOCK_ASSET_RELS exists and is non-empty", () => {
    for (const rel of STOCK_ASSET_RELS) {
      expect(statSync(join(repoRoot, rel)).size, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  /**
   * The other direction, and the one that keeps the hand list honest: every
   * `.ts` file in the catalog directory is either scanned or explicitly
   * exempt. A new class module is a build failure until it is named.
   */
  it("every .ts file in the stock-catalog directory is scanned or explicitly exempt", () => {
    const onDisk = readdirSync(join(repoRoot, STOCK_CATALOG_DIR))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts"))
      .sort();
    const accounted = [...STOCK_ASSET_RELS.map((rel) => basename(rel)), ...STOCK_ASSET_SCAN_EXEMPT].sort();
    expect(
      onDisk,
      `${STOCK_CATALOG_DIR} holds a .ts file this scan does not account for. Add it to ` +
        "STOCK_ASSET_RELS, or to STOCK_ASSET_SCAN_EXEMPT if it genuinely holds no entry data — " +
        "and say which in the commit. An unlisted class module has its pointKey values checked " +
        "against no vocabulary at all, and every assertion here stays green while checking less.",
    ).toEqual(accounted);
  });

  /**
   * The parser self-test: the scanner over a known string returns exactly the
   * two keys in it — and NOT the `pointKeys:` array member beside them.
   */
  it("the scanner finds exactly the pointKey values in a fixture, and ignores pointKeys arrays", () => {
    expect(scanCatalog(SCANNER_FIXTURE)).toEqual(["voltage_vry", "current_a"]);
  });

  /**
   * The second scanner's own self-test, over the same fixture: the KPI array
   * form and only it. `F2.13` could leave nothing but an instruction here —
   * a scan for a form no catalog file carried yet would have been a regex
   * nobody could test. `F2.12` authored the form, so this is now a check.
   */
  it("the KPI scanner finds exactly the pointKeys array members in a fixture", () => {
    expect(scanKpiPointKeys(SCANNER_FIXTURE)).toEqual(["kw", "kva", "dga_h2_ppm", "dga_ch4_ppm"]);
  });

  /**
   * And the two scanners partition the file rather than overlapping. One regex
   * matching both forms would count every KPI reference twice — inflating the
   * length bound below while checking nothing new, which is the silent
   * failure this file exists to prevent.
   */
  it("the two scanners' outputs over the fixture are disjoint", () => {
    const fromKpiArrays = new Set(scanKpiPointKeys(SCANNER_FIXTURE));
    const overlap = scanCatalog(SCANNER_FIXTURE).filter((key) => fromKpiArrays.has(key));
    expect(
      overlap,
      "the two scans returned the same key — a regex that matches both pointKey: and pointKeys: " +
        "double-counts every KPI reference and the length bound below stops meaning anything",
    ).toEqual([]);
  });

  /**
   * Anti-vacuity, real rather than parser-only. Every assertion below is "no
   * member of a scanned set is bad"; a regex that silently stops matching turns
   * all of them green. These are lower bounds read off the catalog as it stands.
   */
  it("the scan actually found the catalog and the vocabulary", () => {
    // 44 = the feeder's 33 declared points + its 11 alarm pointKey references,
    // plus 0 KPI members — the feeder is still the only authored entry.
    // 247 / 168 once F2.12 pass C lands the five classes — move it in Task 8's commit.
    expect(pointKeys.length, `no pointKey found in ${STOCK_LABEL} — the scan is blind`).toBeGreaterThanOrEqual(44);
    // 33 distinct keys, so a copy-pasted repetition cannot satisfy the bound above alone.
    // 247 / 168 once F2.12 pass C lands the five classes — move it in Task 8's commit.
    expect(new Set(pointKeys).size, "fewer distinct keys than the feeder declares").toBeGreaterThanOrEqual(33);
    // 191 — the same number f3.38 and f3.39 hold, F2.11's 139
    // ELECTRICAL_CLASS_POINT_KEYS plus the six codes F2.12 pass A promoted.
    expect(vocabulary.size, `no *_POINT_KEYS array parsed out of ${CONSTANTS_REL}`).toBeGreaterThanOrEqual(191);
  });

  it("every catalog pointKey is a code a *_POINT_KEYS array holds", () => {
    const unknown = [...new Set(pointKeys.filter((key) => !vocabulary.has(key)))].sort();
    expect(
      unknown,
      `${STOCK_LABEL} names a pointKey that exists in no *_POINT_KEYS array. 0058's foreign key ` +
        "refuses a template_points row whose key the platform lacks, and assertPointKeysActive " +
        "refuses the import before the insert — this fails it before either, at build time. Promote " +
        "the key into the pack's *_POINT_KEYS array first (ADR 0051 Amendment 6's shape), or spell " +
        `it the way ${CONSTANTS_REL} spells it.`,
    ).toEqual([]);
  });
});
