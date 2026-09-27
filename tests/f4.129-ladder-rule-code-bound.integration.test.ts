import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Relative, not `@bms/db`: the workspace package is a dependency of `apps/*`,
// not of the repo root, so the bare specifier does not resolve from `tests/`.
import {
  ESKOM_LADDER_RULES,
  ladderRuleCode,
  seedEskomLadderRules,
} from "../packages/db/src/automation-rules-seed.js";
import { createDb } from "../packages/db/src/client.js";
import { assets } from "../packages/db/src/schema/index.js";
import { createSeedPool } from "../packages/db/src/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.129` U3 — what `ladderRuleCode` and its wiring into
 * `seedEskomLadderRules` guarantee against a real Postgres, which a unit spec
 * (`packages/db/src/automation-rules-seed.spec.ts`) cannot: a 42+ character
 * ESKOM electrical asset code no longer aborts `pnpm db:seed` with
 * `22001 value too long`, the five rule codes written match
 * `ladderRuleCode` exactly, and a second seed pass (`pnpm db:seed` calls
 * `seedEskomLadderRules` twice per boot — the module's own docblock) neither
 * throws nor doubles the rows.
 *
 * Connection `"owner"`: `pnpm db:seed` itself runs `seedEskomLadderRules` as
 * `bms_owner` (`seed-tenant.ts`), and `bms.assets`/`bms.automation_rules` are
 * `FORCE ROW LEVEL SECURITY`, so a fleet-role run would not exercise the
 * `WITH CHECK` path a real seed takes.
 *
 * **Nothing this suite writes survives it.** One transaction on one client
 * (the seed pool's `max: 1` connection): `BEGIN`, set
 * `app.current_organization` to ESKOM, insert the fixture asset, run the
 * seed twice, read the rule codes back after each run, `ROLLBACK` in a
 * `finally`. The fixture code is per-run (`F4129-<8 hex>-` + 45 `X`s, 60
 * characters) — never a catalog code.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.129",
  label: "seedEskomLadderRules against a 60-character ESKOM electrical asset code",
  because:
    "the 22001 abort on an unbounded code, the five bounded codes ladderRuleCode " +
    "produces, and idempotence across two seed passes are all things only a real " +
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

const runId = Math.random().toString(16).slice(2, 10);
/**
 * Exactly 60 characters. The raw template is `7 + n + s` long; at `n = 60`
 * every one of the five suffixes (6–17 characters) overflows the 64-character
 * bound, so this exercises the hash-suffix cut on all five, not just one.
 */
const FIXTURE_CODE = `F4129-${runId}-` + "X".repeat(45);

describe.skipIf(!ownerUrl)(
  "F4.129 — a 60-character ESKOM electrical asset seeds five bounded ladder rules, twice",
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

    it("run 1 writes five rows whose codes match ladderRuleCode; run 2 is a stable no-op", async () => {
      if (!seedPool || !seedDb) throw new Error("F4.129: pool not initialised");
      const pool = seedPool;
      const db = seedDb;

      const expectedCodes = ESKOM_LADDER_RULES.map((rule) =>
        ladderRuleCode(FIXTURE_CODE, rule.suffix),
      ).sort();
      for (const code of expectedCodes) {
        assert(code.length <= 64, `${code} must be <= 64 characters, got ${code.length}`);
      }
      expect(new Set(expectedCodes).size, "the five expected codes must be pairwise distinct").toBe(5);

      await pool.query("BEGIN");
      try {
        // `is_local = true` — scoped to this transaction only, same form
        // `withOrganization` uses (`seed-tenant.ts`).
        await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);

        const inserted = await db
          .insert(assets)
          .values({
            organizationId: eskomOrgId,
            locationId: rsmocWcId,
            code: FIXTURE_CODE,
            name: "F4.129 fixture asset",
            siteName: "F4.129 fixture",
            domain: "electrical",
          })
          .returning({ id: assets.id });
        const assetId = inserted[0]?.id;
        assert(!!assetId, "the fixture asset insert must return an id");

        const readCodes = async (): Promise<string[]> => {
          const { rows } = await pool.query<{ code: string }>(
            `SELECT code FROM bms.automation_rules WHERE asset_id = $1 ORDER BY code`,
            [assetId],
          );
          return rows.map((row) => row.code);
        };

        // Run 1 — M1 reddens here: the raw (unbounded) template on a
        // 60-character asset code overflows every suffix and Postgres
        // refuses the INSERT with 22001.
        await seedEskomLadderRules(db, eskomOrgId);
        const firstPass = await readCodes();
        expect(firstPass, "run 1 must write exactly the five ladder rules, at the expected codes").toEqual(
          expectedCodes,
        );

        // Run 2 — the module's own docblock: `pnpm db:seed` calls this
        // function a second time on its own, once every ESKOM electrical
        // asset exists (`seed.ts`). The condition-tuple skip is what makes
        // this a no-op. With that skip removed (M3) the suite reddened
        // earlier, in run 1, with `automation_rules_org_code_idx` on an
        // already-seeded ESKOM asset; these two assertions are the check
        // for the fixture asset itself.
        await seedEskomLadderRules(db, eskomOrgId);
        const secondPass = await readCodes();
        expect(secondPass.length, "run 2 must leave exactly five rows for the fixture asset").toBe(5);
        expect(secondPass, "run 2 must leave the same five codes run 1 wrote").toEqual(expectedCodes);
      } finally {
        await pool.query("ROLLBACK");
      }
    }, 60_000);
  },
);
