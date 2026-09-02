import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

/**
 * **EVERY pack file, from day one** — both files, even though `electrical.ts`
 * is the only one with entries today. `stock-catalog.ts` spreads the packs, and
 * this scan reads TEXT, so it cannot follow the spread: a pack left off this
 * list has its `pointKey` values checked against no vocabulary at all, and
 * every assertion below stays green while checking less.
 *
 * **A THIRD FILE BELONGS HERE THE DAY A PACK LANDS** (`water.ts` for `E5.1`,
 * `mechanical.ts` for `E5.2`, `facility.ts` for `E5.3`), and the anti-vacuity
 * lower bounds below move with it. `stock-catalog.ts`'s docblock carries the
 * same instruction from the other side.
 */
const STOCK_ASSET_RELS = [
  "apps/api/src/admin/asset-templates/stock-catalog/stock-catalog.ts",
  "apps/api/src/admin/asset-templates/stock-catalog/electrical.ts",
] as const;

const STOCK_LABEL = STOCK_ASSET_RELS.join(" + ");
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
 * (`content.kpis[].pointKeys: [...]`). This catalog has no KPIs, so the scan is
 * complete today. **`F2.12`'s first KPI needs a second scan over
 * `pointKeys: [ "…", "…" ]` arrays**, or its references are checked by nothing
 * here. That is an instruction, not a check: a scan for a form that does not
 * exist yet would be a regex nobody can test.
 */
const scanCatalog = (source: string): string[] =>
  [...source.matchAll(/\bpointKey:\s*"([^"]+)"/g)].map((match) => match[1]!);

describe("F2.13 the stock asset-template catalog names point keys that exist", () => {
  const stockSources = STOCK_ASSET_RELS.map((rel) => read(rel));
  const pointKeys = stockSources.flatMap((source) => scanCatalog(source));
  const vocabulary = pointKeyVocabulary(read(CONSTANTS_REL));

  it("every file in STOCK_ASSET_RELS exists and is non-empty", () => {
    for (const rel of STOCK_ASSET_RELS) {
      expect(statSync(join(repoRoot, rel)).size, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  /**
   * The parser self-test: the scanner over a known string returns exactly the
   * two keys in it — and NOT the `pointKeys:` array member beside them.
   */
  it("the scanner finds exactly the pointKey values in a fixture, and ignores pointKeys arrays", () => {
    const fixture = [
      '{ pointKey: "voltage_vry", label: "x" },',
      '  alarms: [{ code: "a", pointKey: "current_a" }],',
      '  kpis: [{ code: "k", pointKeys: ["kw", "kva"] }],',
    ].join("\n");
    expect(scanCatalog(fixture)).toEqual(["voltage_vry", "current_a"]);
  });

  /**
   * Anti-vacuity, real rather than parser-only. Every assertion below is "no
   * member of a scanned set is bad"; a regex that silently stops matching turns
   * all of them green. These are lower bounds read off the catalog as it stands.
   */
  it("the scan actually found the catalog and the vocabulary", () => {
    // 44 = the feeder's 33 declared points + its 11 alarm pointKey references.
    // Move to the new actual the day F2.12 adds a class.
    expect(pointKeys.length, `no pointKey found in ${STOCK_LABEL} — the scan is blind`).toBeGreaterThanOrEqual(44);
    // 33 distinct keys, so a copy-pasted repetition cannot satisfy the bound above alone.
    expect(new Set(pointKeys).size, "fewer distinct keys than the feeder declares").toBeGreaterThanOrEqual(33);
    // 185 — the same number f3.38 holds; F2.11's ELECTRICAL_CLASS_POINT_KEYS
    // included. It does not move in this row: no derived code is promoted.
    expect(vocabulary.size, `no *_POINT_KEYS array parsed out of ${CONSTANTS_REL}`).toBeGreaterThanOrEqual(185);
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
