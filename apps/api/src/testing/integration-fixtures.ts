import { randomUUID } from "node:crypto";

import { asc, sql } from "drizzle-orm";

import { assets, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";

/**
 * Transaction-local fixture assets for the rollback-style integration suites.
 *
 * **Why this exists.** Three suites resolved their fixture asset by reading one
 * off the seed — `SELECT id FROM bms.assets LIMIT 1`, with no `ORDER BY`:
 * `alarm-enrichment.integration.spec.ts`, `alarm-raise.integration.spec.ts` and
 * `evaluate-enabled-rules.integration.spec.ts`. That read is not stable, and the
 * instability is not the usual "ties may be returned in any order":
 *
 * 1. The plan is a `Seq Scan`, so `LIMIT 1` returns whichever tuple sits
 *    physically first in the heap.
 * 2. `bms.assets` churns. Seven other suites commit prefixed fixture assets in
 *    `beforeAll` and delete them in `afterAll` (`calc-write`, `calc-definitions`,
 *    `calc-definitions.merge`, `asset-templates.instantiate`,
 *    `asset-templates.migrate`, `telemetry-write`, `asset-point-calc-override`).
 *    That leaves free line pointers at the head of page 0 — measured on a
 *    developer database, the first *seeded* row was at `ctid (0,42)` — so an
 *    inserted row can land at `(0,1)` and **win `LIMIT 1`** ahead of all 148
 *    seeded rows. Measured directly: a probe insert landed at `(0,1)` and the
 *    bare `SELECT ... LIMIT 1` returned it.
 * 3. So under a parallel run these suites may not read a seeded asset at all.
 *    They read whichever other suite currently has a committed fixture. Whether
 *    a given insert takes a reclaimed slot depends on the free-space map, which
 *    is why this is intermittent rather than constant — and why the failing run
 *    lost two tests out of seventeen, not all of them.
 * 4. Reading takes no lock. When that suite's `afterAll` ran
 *    `DELETE FROM bms.assets WHERE code LIKE 'prefix%'`, it succeeded, and the
 *    next write referencing the id failed with
 *    `23503 automation_rules_asset_id_fkey`.
 *
 * Reproduced on two connections with no sleeps and no test runner: commit a
 * prefixed asset, read `LIMIT 1` from a second connection's open transaction,
 * delete on the first, insert on the second → `23503`. The interleaving is
 * forced; only step 2 is chance. Observed in the wild on
 * 2026-08-23 as two failures in one full run of
 * `alarm-enrichment.integration.test.ts`, green in isolation; and recorded
 * twice before that in `vitest.config.ts`, at `F2.4` and at `F2.5`.
 *
 * **`ORDER BY` does not fix this.** It narrows the window; it does not close
 * it. A foreign fixture can still sort first — by id it is a random uuid, by
 * code it depends on every other suite's prefix convention holding forever —
 * and it is still deleted mid-test when it does. The only property that closes
 * the race is *not sharing the row*: an asset inserted inside the caller's own
 * transaction is invisible to every other connection until commit, and these
 * suites never commit. Nothing else can read it, and nothing else can delete
 * it.
 *
 * The extraction threshold in this repo is the third copy — see
 * `integration-db-gate.ts`, which records six copies grown before anyone
 * extracted it. This is the third, so it lands here rather than in one suite.
 */

/** A seeded location and its organization. Neither table is written by any test. */
export interface FixtureLocation {
  readonly locationId: string;
  readonly organizationId: string;
}

/**
 * The location every fixture asset hangs off, and its organization.
 *
 * This *is* a read of committed seed data, and that is safe here in a way the
 * `bms.assets` read was not: nothing under `apps/**`, `packages/**` or `tests/**`
 * writes `bms.locations` or `bms.organizations` from a test. The only writers are
 * `packages/db`'s seeds and the runtime services `LocationsService`,
 * `OrganizationsService` and `OnboardingCommitService` — and no spec constructs
 * any of the three. Checked, not assumed. So no concurrent suite can delete the
 * row between this read and the write that references it, and `ORDER BY id`
 * makes the choice deterministic across runs on the same seed.
 *
 * Callers that assert on the organization (`GET .../details` returns the
 * alarm's own asset's `organizationId`) get it from here rather than joining
 * back through the asset, so the assertion has an independent expectation.
 */
export async function fixtureLocation(db: BmsDb): Promise<FixtureLocation> {
  const [row] = await db
    .select({ id: locations.id, organizationId: locations.organizationId })
    .from(locations)
    .orderBy(asc(locations.id))
    .limit(1);
  if (!row) {
    throw new Error("no seeded location available — run pnpm db:seed first");
  }
  return { locationId: row.id, organizationId: row.organizationId };
}

/**
 * A valid `bms.assets.domain`, read from the vocabulary rather than hardcoded.
 *
 * `assets.domain` is a foreign key to `bms.asset_domains(code)`, which is a
 * lookup table that grows with the roadmap — a literal `"electrical"` here
 * would be a second place to edit when the vocabulary moves. `bms.asset_domains`
 * has no Drizzle export, hence the raw statement.
 *
 * Safe to read for the same reason as {@link fixtureLocation}: nothing under
 * `apps/**`, `packages/**` or `tests/**` writes `bms.asset_domains` outside the
 * migrations, so no suite can delete the code between this read and the insert
 * that references it. Were that to change, the failure would be the same shape
 * as the one this file exists to close, under `assets_domain_fk`.
 */
async function anyAssetDomain(db: BmsDb): Promise<string> {
  const result = await db.execute<{ code: string }>(
    sql`SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`,
  );
  const code = result.rows[0]?.code;
  if (!code) {
    throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  }
  return code;
}

/**
 * Inserts `count` distinct assets inside the caller's transaction and returns
 * their ids, in insertion order.
 *
 * Call it once at the top of a `withRollback` body and use the ids positionally
 * — the returned assets are distinct by construction, so a caller needing "a
 * second asset, not the first" does not need an exclusion predicate.
 *
 * `label` only aids forensics; it is not a cleanup key, because there is
 * nothing to clean up. Codes carry a `randomUUID()` so two suites running in
 * parallel workers never contend on `assets_code_unique` — an uncommitted
 * duplicate key blocks the second inserter until the first transaction ends,
 * and two suites that also contend on another unique key can deadlock rather
 * than merely wait.
 *
 * @param label short suite marker, e.g. `"E21"` — appears in the fixture code
 * @param location pass the result of {@link fixtureLocation} when the caller
 *   also asserts on it, so the assertion and the fixture cannot disagree about
 *   which location was chosen. Omitted, this resolves it itself.
 */
export async function createFixtureAssets(
  db: BmsDb,
  count: number,
  label: string,
  location?: FixtureLocation,
): Promise<string[]> {
  if (count < 1) {
    throw new Error(`createFixtureAssets needs count >= 1, got ${count}`);
  }
  const { locationId } = location ?? (await fixtureLocation(db));
  const domain = await anyAssetDomain(db);

  const rows = await db
    .insert(assets)
    .values(
      Array.from({ length: count }, (_, i) => ({
        // 64-char column: 8 + label + 1 + 36 + 3 fits for any short label.
        code: `FIXTURE-${label}-${randomUUID()}-${String(i).padStart(2, "0")}`,
        name: `${label} integration fixture asset ${i}`,
        siteName: `${label} integration fixture site`,
        locationId,
        domain,
      })),
    )
    .returning({ id: assets.id });

  if (rows.length !== count) {
    throw new Error(`expected ${count} fixture assets, inserted ${rows.length}`);
  }
  return rows.map((r) => r.id);
}
