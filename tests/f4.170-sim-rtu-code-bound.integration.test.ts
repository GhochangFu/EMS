import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as DbClient from "../packages/db/dist/client.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// The seed is loaded from `packages/db/dist`, not `src`, and through
// `createRequire` — the `tests/f4.129-ladder-rule-code-bound.integration.test.ts`
// form, for the same reason: `typecheck:tests` compiles every source file a
// `tests/` file imports under its non-strict flags (`F4.99`). Declarations are
// all this file needs. The cost is the `dist` staleness trap: after a source
// edit, run `pnpm --filter @bms/db build` before this suite, or it runs the
// last build. CI builds `dist` on install.
const require_ = createRequire(import.meta.url);
const { DOMAIN_RTU_SUFFIX, ensureEskomDomainRtus, simRtuCode, simRtuDisplayName } = require_(
  "../packages/db/dist/hierarchy-seed.js",
) as typeof HierarchySeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.170` — what `simRtuCode`, `simRtuDisplayName` and their wiring into
 * `ensureEskomDomainRtus` guarantee against a real Postgres, which the unit
 * spec (`packages/db/src/hierarchy-seed.spec.ts`) cannot: an ESKOM location
 * with a 64-character code and a 255-character name — the admin API's
 * maximums — no longer aborts `pnpm db:seed` with `22001 value too long`, the
 * five simulator RTUs written carry exactly the codes and display names the
 * helpers produce, and a second pass — the next `compose up`, which re-seeds —
 * updates the same five rows in place.
 *
 * Connection `"owner"`: `pnpm db:seed` runs `ensureEskomDomainRtus` as
 * `bms_owner` (`seed-tenant.ts`), and `bms.locations`/`bms.rtus` are
 * `FORCE ROW LEVEL SECURITY`, so a fleet-role run would not exercise the
 * `WITH CHECK` path a real seed takes.
 *
 * **Nothing this suite writes survives it.** One transaction on one client
 * (the seed pool's `max: 1` connection, which the drizzle handle shares, so
 * its location read sees the uncommitted fixture): `BEGIN`, set
 * `app.current_organization` to ESKOM, lock the ESKOM locations, insert the
 * fixture location, run the seed twice, read the RTUs back after each run,
 * `ROLLBACK` in a `finally`. The seed walks every ESKOM location, so it also
 * upserts the live simulator RTUs (and any other suite's fixture location's)
 * inside this transaction, row-locking them until the rollback, which undoes
 * those writes too. Keep the transaction short.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.170",
  label: "ensureEskomDomainRtus against a long ESKOM location code and name",
  because:
    "the 22001 abort on an unbounded code or display name, the bounded values the " +
    "helpers produce, and the in-place update across two seed passes are all things " +
    "only a real Postgres under FORCE ROW LEVEL SECURITY holds, so a green run " +
    "without one asserts nothing about any of them.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

const runId = randomUUID().slice(0, 8);

/**
 * Exactly 64 characters, the admin API's maximum. The raw template is
 * `8 + n + 1 + s`; at `n = 64` every one of the five suffixes (2–5
 * characters) overflows the 64-character bound, so this exercises the
 * hash-suffix cut on all five. `runId` sits inside the cut, so two runs never
 * share a code.
 */
const FIXTURE_CODE = `F4170-${runId}-` + "Z".repeat(49);

/** Unique per run; `bms.locations.slug` is `varchar(64)` and unique. */
const FIXTURE_SLUG = `f4170-${runId}`;

/**
 * Exactly 255 characters: the admin API's maximum, and past the 233 that
 * leaves room for `" ENVIRONMENT Simulator"`, so every one of the five
 * display names is cut.
 */
const FIXTURE_NAME = "F4.170 fixture location " + "N".repeat(231);

describe.skipIf(!ownerUrl)(
  "F4.170 — a long-code, long-name ESKOM location seeds five bounded simulator RTUs, twice",
  () => {
    let probePool: IntegrationPool | undefined;
    let seedPool: ReturnType<typeof createSeedPool> | undefined;
    let seedDb: ReturnType<typeof createDb> | undefined;
    let eskomOrgId = "";

    beforeAll(async () => {
      const url = ownerUrl as string;
      // A plain fleet pool to resolve the ESKOM id outside the seed's own
      // transaction, the same split as the F4.129 suite.
      probePool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "fleet", process.env),
        "F4.170",
      );
      seedPool = createSeedPool(url);
      seedDb = createDb(seedPool);

      assert(codePoints(FIXTURE_CODE) === 64, `fixture code must be 64 characters, got ${codePoints(FIXTURE_CODE)}`);
      assert(codePoints(FIXTURE_NAME) === 255, `fixture name must be 255 characters, got ${codePoints(FIXTURE_NAME)}`);

      const org = await probePool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
      );
      eskomOrgId = org.rows[0]?.id ?? "";
      assert(eskomOrgId !== "", "F4.170: the ESKOM organization is not seeded — run pnpm db:seed.");
    }, 60_000);

    afterAll(async () => {
      await seedPool?.end();
      await probePool?.end();
    }, 60_000);

    it("run 1 writes five RTUs with the helpers' code and display name; run 2 updates the same rows", async () => {
      if (!seedPool || !seedDb) throw new Error("F4.170: pool not initialised");
      const pool = seedPool;
      const db = seedDb;

      const expected = Object.entries(DOMAIN_RTU_SUFFIX)
        .map(([domain, suffix]) => ({
          code: simRtuCode(FIXTURE_CODE, suffix),
          display_name: simRtuDisplayName(FIXTURE_NAME, domain),
        }))
        .sort((a, b) => (a.code < b.code ? -1 : 1));
      for (const { code, display_name } of expected) {
        assert(codePoints(code) <= 64, `${code} must be <= 64 characters, got ${codePoints(code)}`);
        assert(
          codePoints(display_name) <= 255,
          `the display name must be <= 255 characters, got ${codePoints(display_name)}`,
        );
      }
      expect(new Set(expected.map((row) => row.code)).size, "the five expected codes must be distinct").toBe(5);

      await pool.query("BEGIN");
      try {
        // `is_local = true` — scoped to this transaction only, the form
        // `withOrganization` uses (`seed-tenant.ts`).
        await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);

        // The seed upserts RTUs for every ESKOM location it reads, including
        // other suites' live fixtures. Lock the ones that exist now: a suite
        // that deletes one between the seed's read and its insert would
        // otherwise fail this test with 23503, and its delete now waits for
        // the ROLLBACK below instead.
        const locked = await pool.query(
          `SELECT l.id FROM bms.locations l
             JOIN bms.organizations o ON o.id = l.organization_id
            WHERE o.code = 'ESKOM'
            FOR KEY SHARE OF l`,
        );
        assert((locked.rowCount ?? 0) > 0, "the lock must take the seeded ESKOM locations");

        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
           VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0)
           RETURNING id`,
          [eskomOrgId, FIXTURE_CODE, FIXTURE_SLUG, FIXTURE_NAME],
        );
        const locationId = inserted.rows[0]?.id;
        assert(!!locationId, "the fixture location insert must return an id");

        const readRtus = async (): Promise<{ id: string; code: string; display_name: string }[]> => {
          const { rows } = await pool.query<{ id: string; code: string; display_name: string }>(
            `SELECT id, code, display_name FROM bms.rtus WHERE location_id = $1 ORDER BY code`,
            [locationId],
          );
          return rows;
        };
        const withoutId = (rows: { id: string; code: string; display_name: string }[]) =>
          rows.map(({ code, display_name }) => ({ code, display_name }));

        // Run 1. Mutations that redden here: either call site back to its raw
        // template (Postgres refuses the INSERT with 22001 on varchar(64) or
        // varchar(255)), and a changed ON CONFLICT target (23505 on
        // rtus_location_code_unique against a live ESKOM RTU). A helper that
        // returns 65 characters is caught before BEGIN, by the bound
        // pre-assert on `expected` above.
        await ensureEskomDomainRtus(db, pool);
        const firstPass = await readRtus();
        expect(
          withoutId(firstPass),
          "run 1 must write exactly the five simulator RTUs, at the expected codes and display names",
        ).toEqual(expected);

        // Run 2 — the next boot's re-seed. `ON CONFLICT (location_id, code)`
        // updates the five rows in place: same codes, same ids, no sixth row.
        await ensureEskomDomainRtus(db, pool);
        const secondPass = await readRtus();
        expect(withoutId(secondPass), "run 2 must leave the same five RTUs run 1 wrote").toEqual(expected);
        expect(
          secondPass.map((row) => row.id),
          "run 2 must update the five rows in place, keeping their ids",
        ).toEqual(firstPass.map((row) => row.id));
      } finally {
        await pool.query("ROLLBACK");
      }
    }, 60_000);
  },
);
