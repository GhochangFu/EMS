import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect } from "vitest";

import { ASSET_DOMAIN_SQL, PACK_ASSET_DOMAINS } from "./asset-domains-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `E5.2`/`E5.3` — the claims on the `bms.asset_domains` rows a pack adds
 * through the seed rather than a migration (ADR 0031 Amendment 1 A1.1, ADR
 * 0053 decision 2, ADR 0054 decision 2). No database: the SQL and the seed
 * order are asserted as text, the `ruled-point-catalog-seed.spec.ts` shape.
 * The rows' *existence* on a seeded database is `verifyHierarchySeed`'s
 * Pass 1 (seven domains), and the fact that an import depends on them is the
 * F2.13 integration suite's unknown-domain refusal, whose *Expected one of*
 * list must end in `facility`.
 */

/**
 * Where `seed.ts` might be, tried in order — `phe-pilot-seed.ts`'s
 * `CATALOG_CANDIDATES` idiom. `import.meta.url` is a `TS1470` error under the
 * CommonJS build and `__dirname` does not exist when Vitest loads this file as
 * ESM, so the candidates are named: the package root (`pnpm --filter @bms/db`)
 * and the repository root (root `pnpm test`, which is what CI runs).
 */
const SEED_CANDIDATES = ["src/seed.ts", "packages/db/src/seed.ts"];

function readSeedSource(): string {
  const path = SEED_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  if (path === undefined) {
    throw new Error(`seed.ts not found from ${process.cwd()}; tried ${SEED_CANDIDATES.join(", ")}`);
  }
  return readFileSync(path, "utf8");
}

/**
 * Comments and string literals blanked to spaces of the same length, so a
 * brace or a `withOrganization(` inside prose cannot open a bracket and every
 * index below still points into the original text.
 */
function codeOnly(source: string): string {
  const blank = (match: string): string => " ".repeat(match.length);
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/`(?:\\.|[^`\\])*`/g, blank)
    .replace(/"(?:\\.|[^"\\])*"/g, blank);
}

/**
 * Every `withOrganization(pool, org, async () => { ... })` bracket in the seed,
 * as `[from, to]` index ranges over `codeOnly(source)`. The range closes where
 * the brace depth opened by the callback's first `{` returns to zero.
 */
function tenantBrackets(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let from = code.indexOf("withOrganization(");
  while (from !== -1) {
    const open = code.indexOf("{", from);
    let depth = 0;
    let at = open;
    for (; at < code.length; at += 1) {
      if (code[at] === "{") depth += 1;
      if (code[at] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push([from, at]);
    from = code.indexOf("withOrganization(", at);
  }
  return ranges;
}

function insideAnyBracket(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([from, to]) => index > from && index < to);
}

/**
 * A re-seed must not fail and must not overwrite a row a global administrator
 * edited: `DO NOTHING`, never `DO UPDATE`. A retirement (`active = false`) or
 * a relabel has to survive `compose up`, which re-runs the seed on every boot
 * — the same rule `ruled-point-catalog-seed` holds. The column list is pinned
 * too: writing `active` would give the seed a way back to `true`.
 */
export function assertReSeedingIsIdempotentAndNeverOverwrites(): void {
  expect(ASSET_DOMAIN_SQL).toContain("INSERT INTO bms.asset_domains (code, label, sort_order)");
  expect(ASSET_DOMAIN_SQL).toContain("VALUES ($1, $2, $3)");
  expect(ASSET_DOMAIN_SQL).toContain("ON CONFLICT (code) DO NOTHING");
  expect(ASSET_DOMAIN_SQL).not.toContain("DO UPDATE");
  expect(ASSET_DOMAIN_SQL).not.toContain("active");
}

/**
 * Exactly the two rows ADR 0053 decision 2 and ADR 0054 decision 2 rule —
 * `mechanical` / `Mechanical` / `sort_order 60`, last after `water` (50), then
 * `facility` / `Facility` / `sort_order 70`. A third entry is a third ADR.
 */
export function assertThePackDeclaresExactlyTheRuledRow(): void {
  expect(PACK_ASSET_DOMAINS).toEqual([
    { code: "mechanical", label: "Mechanical", sortOrder: 60 },
    { code: "facility", label: "Facility", sortOrder: 70 },
  ]);
}

/**
 * Domains before the keys filed under them. `bms.point_keys.domain` is a plain
 * `varchar(64)` with no foreign key (`bms-schema.ts`), so nothing in the
 * database enforces this order — it is a convention, and this is where it is
 * pinned: `seed.ts` calls `seedAssetDomains(pool)` exactly once, before its
 * one `seedPointKeyCatalog(pool)`.
 */
export function assertDomainsAreSeededBeforeTheKeysFiledUnderThem(): void {
  const code = codeOnly(readSeedSource());
  const domains = "await seedAssetDomains(pool);";
  const keys = "await seedPointKeyCatalog(pool);";
  const domainsAt = code.indexOf(domains);
  const keysAt = code.indexOf(keys);
  expect(domainsAt, `seed.ts does not call ${domains}`).toBeGreaterThan(-1);
  expect(keysAt, `seed.ts does not call ${keys}`).toBeGreaterThan(-1);
  expect(code.indexOf(domains, domainsAt + 1), "seed.ts seeds the domains twice").toBe(-1);
  expect(domainsAt, "the domain row must be seeded BEFORE the point-key catalog").toBeLessThan(
    keysAt,
  );
}

/**
 * The call sits outside every `withOrganization(` bracket. `bms.asset_domains`
 * is a global vocabulary: `bms_owner` owns it (`0041`), no policy and no
 * `FORCE` bind it (`0047` left the vocabulary class unpoliced), and a tenant
 * context would be a claim about which organization the row belongs to, which
 * is none. The detector is proved able to fire on a call that IS bracketed —
 * `seedAccessControlFixtures(pool)` runs inside ESKOM's context — so a green
 * run is not a detector that found no brackets.
 */
export function assertTheCallSitsOutsideAnyTenantBracket(): void {
  const code = codeOnly(readSeedSource());
  const brackets = tenantBrackets(code);
  expect(brackets.length, "seed.ts has no withOrganization( bracket to be outside of").toBeGreaterThan(
    0,
  );

  const control = code.indexOf("await seedAccessControlFixtures(pool);");
  expect(control).toBeGreaterThan(-1);
  expect(insideAnyBracket(brackets, control), "positive control: the access fixtures ARE bracketed").toBe(
    true,
  );

  const domainsAt = code.indexOf("await seedAssetDomains(pool);");
  expect(domainsAt).toBeGreaterThan(-1);
  expect(
    insideAnyBracket(brackets, domainsAt),
    "seedAssetDomains(pool) must run outside every withOrganization( bracket",
  ).toBe(false);
}
