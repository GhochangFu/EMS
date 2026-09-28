import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AutomationRulesSeed from "../packages/db/dist/automation-rules-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// The seed is loaded from `packages/db/dist`, not `src`, and through
// `createRequire` (the `tests/ingest-contracts.test.ts` form for a CJS build).
// `typecheck:tests` compiles every source file a `tests/` file imports under
// its non-strict flags (`F4.99`), and without `strictNullChecks` drizzle's
// insert types drop every optional column, so `automation-rules-seed.ts` and
// the two seeds it imports fail there although they pass `pnpm typecheck`.
// Declarations are all this file needs. The cost is the `dist` staleness
// trap: after a source edit, run `pnpm --filter @bms/db build` before this
// suite, or it runs the last build. CI builds `dist` on install.
const require_ = createRequire(import.meta.url);
const { ESKOM_LADDER_RULES, ladderRuleCode, ladderRuleName, seedEskomLadderRules } = require_(
  "../packages/db/dist/automation-rules-seed.js",
) as typeof AutomationRulesSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.129` — what `ladderRuleCode`, `ladderRuleName` and their wiring into
 * `seedEskomLadderRules` guarantee against a real Postgres, which the unit
 * spec (`packages/db/src/automation-rules-seed.spec.ts`) cannot: an ESKOM
 * electrical asset with a 60-character code and a 250-character name no
 * longer aborts `pnpm db:seed` with `22001 value too long`, the five rules
 * written carry exactly the codes and names the helpers produce, and a
 * second pass — the next `compose up`, which re-seeds — neither throws nor
 * adds rows.
 *
 * Connection `"owner"`: `pnpm db:seed` itself runs `seedEskomLadderRules` as
 * `bms_owner` (`seed-tenant.ts`), and `bms.assets`/`bms.automation_rules` are
 * `FORCE ROW LEVEL SECURITY`, so a fleet-role run would not exercise the
 * `WITH CHECK` path a real seed takes.
 *
 * **Nothing this suite writes survives it.** One transaction on one client
 * (the seed pool's `max: 1` connection): `BEGIN`, set
 * `app.current_organization` to ESKOM, lock the ESKOM electrical assets,
 * insert the fixture asset, run the seed twice, read the rules back after
 * each run, `ROLLBACK` in a `finally`. The seed walks every ESKOM electrical
 * asset, so it also writes rules for other suites' live fixtures inside this
 * transaction; the rollback removes those too.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.129",
  label: "seedEskomLadderRules against a long ESKOM electrical asset code and name",
  because:
    "the 22001 abort on an unbounded code or name, the bounded values the helpers " +
    "produce, and idempotence across two seed passes are all things only a real " +
    "Postgres under FORCE ROW LEVEL SECURITY holds, so a green run without one " +
    "asserts nothing about any of them.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

const runId = randomUUID().slice(0, 8);
/**
 * Exactly 60 characters. The raw template is `7 + n + s` long; at `n = 60`
 * every one of the five suffixes (6–16 characters) overflows the 64-character
 * bound, so this exercises the hash-suffix cut on all five, not just one.
 *
 * The tail is lowercase on purpose. Before `F4.169` the ladder seed fell back
 * to `upsertRuleByCode`, which upper-cases only its stored side, so a code
 * with a lowercase letter never matched by code and run 2 stayed a no-op only
 * through the condition-tuple guard — M3 (the guard removed) was red on
 * every run. Since `F4.169` the asset-and-suffix match also makes run 2 a
 * no-op, so M3 alone no longer reddens this file; I7 in
 * `tests/f4.169-ladder-rule-match-by-asset-and-suffix.integration.test.ts`
 * is its gate now.
 */
const FIXTURE_CODE = `F4129-${runId}-` + "x".repeat(45);

/**
 * Exactly 250 characters: inside the admin API's 255, and past the 235 that
 * leaves room for `" L1 voltage critical"`, so every one of the five rule
 * names is cut.
 */
const FIXTURE_NAME = "F4.129 fixture asset " + "N".repeat(229);

describe.skipIf(!ownerUrl)(
  "F4.129 — a long-code, long-name ESKOM electrical asset seeds five bounded ladder rules, twice",
  () => {
    let probePool: IntegrationPool | undefined;
    let seedPool: ReturnType<typeof createSeedPool> | undefined;
    let seedDb: ReturnType<typeof createDb> | undefined;
    let eskomOrgId = "";
    let rsmocWcId = "";

    beforeAll(async () => {
      const url = ownerUrl as string;
      // A plain fleet pool to resolve ids — `bms.organizations`/`bms.locations`
      // reads outside the seed's own transaction, same split as
      // `tests/f3.67-site-control-room-views-seed.integration.test.ts`.
      probePool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "fleet", process.env),
        "F4.129",
      );
      seedPool = createSeedPool(url);
      seedDb = createDb(seedPool);

      assert(FIXTURE_CODE.length === 60, `fixture code must be 60 characters, got ${FIXTURE_CODE.length}`);
      assert(FIXTURE_NAME.length === 250, `fixture name must be 250 characters, got ${FIXTURE_NAME.length}`);

      const org = await probePool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
      );
      eskomOrgId = org.rows[0]?.id ?? "";
      assert(eskomOrgId !== "", "F4.129: the ESKOM organization is not seeded — run pnpm db:seed.");

      const location = await probePool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`,
      );
      rsmocWcId = location.rows[0]?.id ?? "";
      assert(rsmocWcId !== "", "F4.129: RSMOC-WC is not seeded — run pnpm db:seed.");
    }, 60_000);

    afterAll(async () => {
      await seedPool?.end();
      await probePool?.end();
    }, 60_000);

    it("run 1 writes five rules with the helpers' code and name; run 2 is a stable no-op", async () => {
      if (!seedPool || !seedDb) throw new Error("F4.129: pool not initialised");
      const pool = seedPool;
      const db = seedDb;

      const expected = ESKOM_LADDER_RULES.map((rule) => ({
        code: ladderRuleCode(FIXTURE_CODE, rule.suffix),
        name: ladderRuleName(FIXTURE_NAME, rule.nameSuffix),
      })).sort((a, b) => (a.code < b.code ? -1 : 1));
      for (const { code, name } of expected) {
        assert(code.length <= 64, `${code} must be <= 64 characters, got ${code.length}`);
        assert(name.length <= 255, `the rule name must be <= 255 characters, got ${name.length}`);
      }
      expect(new Set(expected.map((row) => row.code)).size, "the five expected codes must be distinct").toBe(5);

      await pool.query("BEGIN");
      try {
        // `is_local = true` — scoped to this transaction only, same form
        // `withOrganization` uses (`seed-tenant.ts`).
        await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);

        // The seed inserts rules for every ESKOM electrical asset it reads,
        // including other suites' live fixtures. Lock the ones that exist
        // now: a suite that deletes one of them between the seed's read and
        // its insert would otherwise fail this test with 23503, and its
        // delete now waits for the ROLLBACK below instead. An asset another
        // suite commits after this lock is not covered; that window is one
        // statement wide.
        const locked = await pool.query(
          `SELECT a.id FROM bms.assets a
             JOIN bms.organizations o ON o.id = a.organization_id
            WHERE o.code = 'ESKOM' AND a.domain = 'electrical'
            FOR KEY SHARE OF a`,
        );
        assert((locked.rowCount ?? 0) > 0, "the lock must take the seeded ESKOM electrical assets");

        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
           VALUES ($1, $2, $3, $4, 'F4.129 fixture', 'electrical')
           RETURNING id`,
          [eskomOrgId, rsmocWcId, FIXTURE_CODE, FIXTURE_NAME],
        );
        const assetId = inserted.rows[0]?.id;
        assert(!!assetId, "the fixture asset insert must return an id");

        const readRules = async (): Promise<{ code: string; name: string }[]> => {
          const { rows } = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM bms.automation_rules WHERE asset_id = $1 ORDER BY code`,
            [assetId],
          );
          return rows;
        };

        // Run 1. Mutations that redden here: M1 (the call site back to the
        // raw code template) and M4 (the raw name template) — Postgres
        // refuses the INSERT with 22001.
        await seedEskomLadderRules(db, eskomOrgId);
        const firstPass = await readRules();
        expect(firstPass, "run 1 must write exactly the five ladder rules, at the expected codes and names").toEqual(
          expected,
        );

        // Run 2 — the next boot's re-seed, a no-op through the
        // condition-tuple guard and, since `F4.169`, the asset-and-suffix
        // match as well. M3 (the condition-tuple guard removed) no longer
        // reddens here: the second guard still skips all five rules. I7 in
        // `tests/f4.169-ladder-rule-match-by-asset-and-suffix.integration.test.ts`
        // is its gate now.
        await seedEskomLadderRules(db, eskomOrgId);
        const secondPass = await readRules();
        expect(secondPass, "run 2 must leave the same five rules run 1 wrote").toEqual(expected);
      } finally {
        await pool.query("ROLLBACK");
      }
    }, 60_000);
  },
);
