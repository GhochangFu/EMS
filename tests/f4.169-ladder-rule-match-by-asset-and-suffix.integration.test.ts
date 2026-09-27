import { createHash, randomUUID } from "node:crypto";
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

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives: the
// non-strict `typecheck:tests` flags fail on the seed sources. After a source
// edit, run `pnpm --filter @bms/db build` before this suite, or it runs the
// last build.
const require_ = createRequire(import.meta.url);
const { ESKOM_LADDER_RULES, ladderRuleCode, seedAutomationRules, seedEskomLadderRules } = require_(
  "../packages/db/dist/automation-rules-seed.js",
) as typeof AutomationRulesSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.169` — `seedEskomLadderRules` decides "already seeded" by the rule's
 * `asset_id` and its code's suffix (`ladderSuffixOf`), never by the code
 * itself, and skips with one warning a code that a different row already
 * holds. Before this item the ladder path matched on code through
 * `upsertRuleByCode`, which upper-cases only the stored side, so a
 * lowercase asset code whose seeded rule an operator had edited aborted the
 * next `pnpm db:seed` with `23505` on `automation_rules_org_code_idx`.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs (`seed-tenant.ts`), so the
 * `FORCE ROW LEVEL SECURITY` `WITH CHECK` path is the real one.
 *
 * **Nothing this suite writes survives it.** Each `it` is one transaction on
 * the seed pool's single connection: `BEGIN`, set `app.current_organization`
 * to ESKOM, lock the ESKOM electrical assets, write the fixture, seed, read
 * back, `ROLLBACK` in a `finally`. The seed walks every ESKOM electrical
 * asset, so it writes for other suites' live fixtures too; the rollback
 * removes those rows as well. For the same reason the collected warnings are
 * filtered to this run's `runId` before any count.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.169",
  label: "seedEskomLadderRules matches a seeded ladder rule by asset and suffix",
  because:
    "the 23505 abort on a re-seed, the rows a re-seed adds or skips, and the " +
    "collision skip inside the seed's one transaction are all things only a real " +
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
type SeedPool = ReturnType<typeof createSeedPool>;
type SeedDb = ReturnType<typeof createDb>;

/** One stored rule, as the assertions below read it. */
type RuleRow = { id: string; code: string; threshold_value: number | null };

/** Lowercase hex from `randomUUID`, so a code built on it is lowercase. */
const runId = randomUUID().slice(0, 8);
const RUN_ID = runId.toUpperCase();

/** The five ladder codes the seed writes for `assetCode`, sorted. */
function expectedCodes(assetCode: string): string[] {
  return ESKOM_LADDER_RULES.map((rule) => ladderRuleCode(assetCode, rule.suffix)).sort();
}

describe.skipIf(!ownerUrl)(
  "F4.169 — the ladder seed matches a seeded rule by asset and suffix, and skips a code another rule holds",
  () => {
    let probePool: IntegrationPool | undefined;
    let seedPool: SeedPool | undefined;
    let seedDb: SeedDb | undefined;
    let eskomOrgId = "";
    let rsmocWcId = "";

    beforeAll(async () => {
      const url = ownerUrl as string;
      probePool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "fleet", process.env),
        "F4.169",
      );
      seedPool = createSeedPool(url);
      seedDb = createDb(seedPool);

      const org = await probePool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
      );
      eskomOrgId = org.rows[0]?.id ?? "";
      assert(eskomOrgId !== "", "F4.169: the ESKOM organization is not seeded — run pnpm db:seed.");

      const location = await probePool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`,
      );
      rsmocWcId = location.rows[0]?.id ?? "";
      assert(rsmocWcId !== "", "F4.169: RSMOC-WC is not seeded — run pnpm db:seed.");
    }, 60_000);

    afterAll(async () => {
      await seedPool?.end();
      await probePool?.end();
    }, 60_000);

    /** What one transaction hands its body. */
    type Tx = {
      pool: SeedPool;
      db: SeedDb;
      insertAsset: (code: string) => Promise<string>;
      readRules: (assetId: string) => Promise<RuleRow[]>;
      /** Runs the ladder seed, collecting its warnings into `lines`. */
      seed: () => Promise<void>;
      /** The warnings so far that name this run's fixtures. */
      runLines: () => string[];
    };

    /**
     * `BEGIN` … `ROLLBACK` around `body`, on the seed pool's one connection.
     * The `ROLLBACK` is in a `finally`, so a red assertion leaks nothing.
     */
    async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
      if (!seedPool || !seedDb) throw new Error("F4.169: pool not initialised");
      const pool = seedPool;
      const db = seedDb;
      const lines: string[] = [];
      await pool.query("BEGIN");
      try {
        await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
        // Lock the ESKOM electrical assets the seed will read, so another
        // suite's delete waits for this ROLLBACK rather than failing an
        // insert here with 23503 (the F4.129 suite's reasoning).
        const locked = await pool.query(
          `SELECT a.id FROM bms.assets a
             JOIN bms.organizations o ON o.id = a.organization_id
            WHERE o.code = 'ESKOM' AND a.domain = 'electrical'
            FOR KEY SHARE OF a`,
        );
        assert((locked.rowCount ?? 0) > 0, "the lock must take the seeded ESKOM electrical assets");

        await body({
          pool,
          db,
          insertAsset: async (code) => {
            const inserted = await pool.query<{ id: string }>(
              `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
               VALUES ($1, $2, $3, $4, 'F4.169 fixture', 'electrical')
               RETURNING id`,
              [eskomOrgId, rsmocWcId, code, `F4.169 fixture ${code}`],
            );
            const id = inserted.rows[0]?.id;
            assert(!!id, `the fixture asset insert for ${code} must return an id`);
            return id as string;
          },
          readRules: async (assetId) => {
            const { rows } = await pool.query<RuleRow>(
              `SELECT id, code, threshold_value FROM bms.automation_rules WHERE asset_id = $1`,
              [assetId],
            );
            // Sorted here, by code unit, to match `expectedCodes`: a
            // collation-aware `ORDER BY` can order `_` and mixed case apart
            // from `Array.prototype.sort`.
            return rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
          },
          seed: () => seedEskomLadderRules(db, eskomOrgId, (line) => lines.push(line)),
          runLines: () => lines.filter((line) => line.toLowerCase().includes(runId)),
        });
      } finally {
        await pool.query("ROLLBACK");
      }
    }

    it("I1: a lowercase asset code whose seeded rule was edited re-seeds without 23505 and adds nothing", async () => {
      await inRolledBackTransaction(async (tx) => {
        const assetCode = `f4169-${runId}-lower`;
        const assetId = await tx.insertAsset(assetCode);
        await tx.seed();
        const first = await tx.readRules(assetId);
        expect(first.map((row) => row.code), "run 1 must write the five ladder codes").toEqual(
          expectedCodes(assetCode),
        );
        const pfLow = first.find((row) => row.code.endsWith("_PF_LOW"));
        assert(!!pfLow, "run 1 must write a _PF_LOW rule");
        await tx.pool.query(`UPDATE bms.automation_rules SET threshold_value = 0.7 WHERE id = $1`, [
          pfLow?.id,
        ]);

        // Mutation: the ladder path back on `upsertRuleByCode` misses the
        // lowercase code by code, INSERTs it again, and throws 23505 here.
        await tx.seed();

        const second = await tx.readRules(assetId);
        expect(second, "run 2 must leave exactly five rules").toHaveLength(5);
        const pfLows = second.filter((row) => row.code.endsWith("_PF_LOW"));
        expect(pfLows, "run 2 must leave exactly one _PF_LOW rule").toHaveLength(1);
        expect(pfLows[0]?.id, "the _PF_LOW rule must keep its id").toBe(pfLow?.id);
        expect(pfLows[0]?.threshold_value, "the operator's threshold edit must survive").toBe(0.7);
        expect(tx.runLines(), "a match by asset and suffix must log nothing").toEqual([]);
      });
    }, 60_000);

    it("I2: a renamed asset keeps its five rules at their old codes", async () => {
      await inRolledBackTransaction(async (tx) => {
        const oldCode = `F4169-${RUN_ID}-OLD`;
        const newCode = `F4169-${RUN_ID}-NEW`;
        const assetId = await tx.insertAsset(oldCode);
        await tx.seed();
        await tx.pool.query(`UPDATE bms.assets SET code = $1 WHERE id = $2`, [newCode, assetId]);
        await tx.pool.query(
          `UPDATE bms.automation_rules SET threshold_value = 230
            WHERE asset_id = $1 AND code LIKE '%\\_VOLTAGE\\_WARN'`,
          [assetId],
        );

        await tx.seed();

        const rows = await tx.readRules(assetId);
        // Mutations: the ladder path back on `upsertRuleByCode` inserts the
        // edited rule again under the new code (6 rows); a rewrite of the
        // stored code to the new asset code leaves a new-code row.
        expect(rows, "the renamed asset must still carry exactly five rules").toHaveLength(5);
        expect(
          rows.map((row) => row.code),
          "every rule must keep the code it was seeded under",
        ).toEqual(expectedCodes(oldCode));
      });
    }, 60_000);

    it("I3: two assets whose codes differ only by case each get their own five rules", async () => {
      await inRolledBackTransaction(async (tx) => {
        const lowerCode = `f4169-${runId}-case-x`;
        const upperCode = `F4169-${RUN_ID}-CASE-X`;
        const lowerId = await tx.insertAsset(lowerCode);
        const upperId = await tx.insertAsset(upperCode);

        await tx.seed();

        // Mutation: dropping the `asset_id` term from the match skips every
        // suffix any asset already carries, and these read 0 rows.
        const lowerRows = await tx.readRules(lowerId);
        const upperRows = await tx.readRules(upperId);
        expect(lowerRows.map((row) => row.code), `${lowerCode} must get its five codes`).toEqual(
          expectedCodes(lowerCode),
        );
        expect(upperRows.map((row) => row.code), `${upperCode} must get its five codes`).toEqual(
          expectedCodes(upperCode),
        );
        expect(
          new Set([...lowerRows, ...upperRows].map((row) => row.code)).size,
          "the ten codes must be distinct",
        ).toBe(10);
      });
    }, 60_000);

    it("I4: an asset left with one edited ladder rule gets the other four back, and keeps that one", async () => {
      await inRolledBackTransaction(async (tx) => {
        const assetCode = `f4169-${runId}-part`;
        const assetId = await tx.insertAsset(assetCode);
        await tx.seed();
        const first = await tx.readRules(assetId);
        const pfLow = first.find((row) => row.code.endsWith("_PF_LOW"));
        assert(!!pfLow, "run 1 must write a _PF_LOW rule");
        await tx.pool.query(`UPDATE bms.automation_rules SET threshold_value = 0.7 WHERE id = $1`, [
          pfLow?.id,
        ]);
        await tx.pool.query(`DELETE FROM bms.automation_rules WHERE asset_id = $1 AND id <> $2`, [
          assetId,
          pfLow?.id,
        ]);

        await tx.seed();

        // Mutation: matching on `asset_id` + `source` alone reads the kept
        // `_PF_LOW` rule as "this asset is seeded", skips all four, and this
        // reads 1 row.
        const rows = await tx.readRules(assetId);
        expect(rows.map((row) => row.code), "the asset must carry all five ladder codes again").toEqual(
          expectedCodes(assetCode),
        );
        const pfLows = rows.filter((row) => row.code.endsWith("_PF_LOW"));
        expect(pfLows[0]?.id, "the kept _PF_LOW rule must keep its id").toBe(pfLow?.id);
        expect(pfLows[0]?.threshold_value, "the kept _PF_LOW rule must keep its edit").toBe(0.7);
      });
    }, 60_000);

    it("I5: a code another asset's rule holds is skipped with one warning naming both assets", async () => {
      await inRolledBackTransaction(async (tx) => {
        // The victim: 60 characters, so its `_PF_LOW` code is hash-cut. The
        // attacker is the victim's cut plus `_` plus the victim's hash — 51
        // characters, so its own raw `_PF_LOW` template is exactly 64 and
        // spells the victim's hashed code. Its other four codes overflow and
        // carry the attacker's own hash, so they collide with nothing.
        const victimCode = `F4169-${runId}-victim-` + "v".repeat(38);
        assert(victimCode.length === 60, `victim code must be 60 characters, got ${victimCode.length}`);
        const victimHash = createHash("sha256")
          .update(victimCode)
          .digest("hex")
          .toUpperCase()
          .slice(0, 8);
        const attackerCode = `${victimCode.replaceAll("-", "_").slice(0, 42)}_${victimHash}`;
        const heldCode = ladderRuleCode(victimCode, "PF_LOW");
        expect(ladderRuleCode(attackerCode, "PF_LOW"), "the fixture must make the two codes equal").toBe(
          heldCode,
        );

        const attackerId = await tx.insertAsset(attackerCode);
        await tx.seed();
        const victimId = await tx.insertAsset(victimCode);

        // Mutation: without the pre-read code check the victim's INSERT
        // throws 23505 here, and the transaction is aborted.
        await tx.seed();

        const attackerRows = await tx.readRules(attackerId);
        const victimRows = await tx.readRules(victimId);
        expect(attackerRows.map((row) => row.code), "the attacker keeps its five codes").toEqual(
          expectedCodes(attackerCode),
        );
        expect(
          victimRows.map((row) => row.code),
          "the victim gets the four codes nobody holds, and no _PF_LOW",
        ).toEqual(expectedCodes(victimCode).filter((code) => code !== heldCode));

        const holder = attackerRows.find((row) => row.code === heldCode);
        const lines = tx.runLines();
        // Mutation: dropping the `log` call leaves no line.
        expect(lines, "exactly one warning must name this run's fixtures").toHaveLength(1);
        const line = lines[0] ?? "";
        expect(line, "the warning must name the victim asset").toContain(`${victimCode} (${victimId})`);
        // Mutation: omitting the holder's asset code from the message.
        expect(line, "the warning must name the holder asset").toContain(`${attackerCode} (${attackerId})`);
        expect(line, "the warning must name the held code").toContain(heldCode);
        expect(line, "the warning must name the holder's rule id").toContain(holder?.id ?? "<no holder>");
      });
    }, 60_000);

    it("I7: an asset whose own rule already holds a ladder condition gets no ladder rule for it", async () => {
      await inRolledBackTransaction(async (tx) => {
        // The `UPS-A` `demand_ceiling_notify` case: a rule that is not a
        // ladder rule (default `source`, a code with no ladder suffix) with
        // `DEMAND_HIGH`'s condition tuple. Only the condition-tuple guard
        // skips `DEMAND_HIGH` here; the asset-and-suffix match does not.
        const assetCode = `f4169-${runId}-tuple`;
        const assetId = await tx.insertAsset(assetCode);
        const demandHigh = ESKOM_LADDER_RULES.find((rule) => rule.suffix === "DEMAND_HIGH");
        assert(!!demandHigh, "ESKOM_LADDER_RULES must hold DEMAND_HIGH");
        const ownCode = `F4169_${RUN_ID}_OWN_DEMAND`;
        await tx.pool.query(
          `INSERT INTO bms.automation_rules
             (organization_id, code, name, rule_type, asset_id, point_key, operator, threshold_value)
           VALUES ($1, $2, 'F4.169 fixture own demand rule', 'threshold', $3, $4, $5, $6)`,
          [eskomOrgId, ownCode, assetId, demandHigh?.pointKey, demandHigh?.operator, demandHigh?.thresholdValue],
        );

        await tx.seed();

        // Mutation: removing the condition-tuple guard inserts
        // `DEMAND_HIGH` beside the asset's own rule, and this reads 6 rows.
        const rows = await tx.readRules(assetId);
        expect(
          rows.map((row) => row.code),
          "the asset's own rule plus the four ladder rules whose condition it does not hold",
        ).toEqual(
          [ownCode, ...expectedCodes(assetCode).filter((code) => !code.endsWith("_DEMAND_HIGH"))].sort(),
        );
      });
    }, 60_000);

    it("I6: the control-room seeders still normalise a stray-case code rather than duplicate it", async () => {
      await inRolledBackTransaction(async (tx) => {
        const asset = await tx.pool.query<{ id: string }>(
          `SELECT id FROM bms.assets WHERE code = 'CR-Q1'`,
        );
        const assetId = asset.rows[0]?.id;
        assert(!!assetId, "F4.169: CR-Q1 is not seeded — run pnpm db:seed.");
        const rule = await tx.pool.query<{ id: string }>(
          `SELECT id FROM bms.automation_rules WHERE code = 'CR_Q1_CURRENT_WARNING'`,
        );
        const ruleId = rule.rows[0]?.id;
        assert(!!ruleId, "F4.169: CR_Q1_CURRENT_WARNING is not seeded — run pnpm db:seed.");
        await tx.pool.query(
          `UPDATE bms.automation_rules SET code = 'cr_q1_current_warning' WHERE id = $1`,
          [ruleId],
        );

        await seedAutomationRules(tx.db, [{ id: assetId as string, code: "CR-Q1" }], eskomOrgId);

        const rows = await tx.pool.query<{ id: string; code: string }>(
          `SELECT id, code FROM bms.automation_rules WHERE upper(code) = 'CR_Q1_CURRENT_WARNING'`,
        );
        expect(rows.rows, "one CR-Q1 rule, rewritten to its canonical code, same id").toEqual([
          { id: ruleId, code: "CR_Q1_CURRENT_WARNING" },
        ]);
      });
    }, 60_000);
  },
);
