import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Relative, not `@bms/db`: the workspace package is a dependency of `apps/*`,
// not of the repo root, so the bare specifier does not resolve from `tests/`.
import { seedPointKeyHeadlineRanks } from "../packages/db/src/point-key-headline-ranks-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.68` U4 — what `seedPointKeyHeadlineRanks` (D8, OQ1, OQ3) guarantees
 * against a real Postgres. Model: `tests/f2.23-catalog-code-charset.integration.test.ts`
 * and `tests/f3.67-site-control-room-views-seed.integration.test.ts`.
 *
 * Three things a unit test cannot gate:
 *
 * 1. **I1** — after `pnpm db:seed`, the eight catalog codes OQ1 names hold
 *    the exact ranks it states. A static scan of `HEADLINE_RANK_SEED` cannot
 *    see whether the `LIKE` patterns actually match the real catalog rows.
 * 2. **I2** — OQ3: a rank a global admin (or, here, a fixture standing in for
 *    one) already set is never reverted by a later call, even though the
 *    matching row's code still satisfies the `LIKE` predicate — proved
 *    against a real `UPDATE … WHERE headline_rank IS NULL`, not reasoned
 *    about. The adjacent positive control is a fresh matching code in the
 *    SAME call, so "nothing changed" cannot pass by the call being a no-op.
 * 3. **I3** — the `_` in `%\_on` is a literal underscore, escaped, not the
 *    `LIKE` single-character wildcard. Only Postgres's own `LIKE` semantics
 *    can prove that; a string-contains check on the SQL text cannot.
 *
 * Connection `"owner"`: `pnpm db:seed` itself runs as `bms_owner`
 * (`seed-tenant.ts`), and `bms.point_keys` carries no policy or FORCE flag to
 * differ under fleet (`0057`/`0059`), so `owner` matches the real seed path
 * exactly.
 *
 * Per-run fixture codes only — `f368-<run>-*` — never a catalog code, and
 * every fixture code this suite inserts is deleted in `afterAll`.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.68 U4",
  label: "the seeded headline ranks (bms.point_keys.headline_rank)",
  because:
    "OQ1's eight seeded ranks, OQ3's NULL-only fill across a re-run, and the LIKE `_` escape " +
    "are all things Postgres holds, so a green run without a database asserts nothing about any of them.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

const runId = Math.random().toString(16).slice(2, 10);
/** Matches `%\_on` — the on/off pattern — by construction (OQ3, I2). */
const codeAlreadyRanked = `f368-${runId}-x_on`;
/** Matches the same pattern, but starts NULL — the positive control (I2). */
const codeFreshMatch = `f368-${runId}-y_on`;
/** Ends in "on" with no underscore before it — must match NOTHING (I3). */
const codeNoUnderscore = `f368-${runId}-xon`;
const fixtureCodes = [codeAlreadyRanked, codeFreshMatch, codeNoUnderscore];

describe.skipIf(!ownerUrl)("F3.68 U4 — seedPointKeyHeadlineRanks", () => {
  let pool: IntegrationPool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(ownerUrl as string, "F3.68 U4");
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM bms.point_keys WHERE code = ANY($1)`, [fixtureCodes]);
    }
    await pool?.end();
  }, 60_000);

  // I1
  it("holds the four catalogued on/off codes at rank 10 after pnpm db:seed", async () => {
    if (!pool) throw new Error("pool not initialised");
    const codes = ["breaker_main", "breaker_trip", "breaker_spring_charged", "chlorine_pump_on"];
    const { rows } = await pool.query<{ code: string; headline_rank: number | null }>(
      `SELECT code, headline_rank FROM bms.point_keys WHERE code = ANY($1)`,
      [codes],
    );
    expect(
      rows.length,
      "all four on/off codes must already be seeded — run pnpm db:seed first",
    ).toBe(4);
    for (const row of rows) {
      expect(row.headline_rank, `${row.code} must hold headline_rank 10`).toBe(10);
    }
  });

  // I1
  it("holds kw/kwh_total/pf/frequency_hz at 20/30/40/50 after pnpm db:seed", async () => {
    if (!pool) throw new Error("pool not initialised");
    const expected: Record<string, number> = { kw: 20, kwh_total: 30, pf: 40, frequency_hz: 50 };
    const { rows } = await pool.query<{ code: string; headline_rank: number | null }>(
      `SELECT code, headline_rank FROM bms.point_keys WHERE code = ANY($1)`,
      [Object.keys(expected)],
    );
    expect(
      rows.length,
      "kw, kwh_total, pf and frequency_hz must all already be seeded — run pnpm db:seed first",
    ).toBe(4);
    for (const row of rows) {
      expect(row.headline_rank, `${row.code} must hold headline_rank ${expected[row.code]}`).toBe(
        expected[row.code],
      );
    }
  });

  // I2 (OQ3)
  it("never overwrites a rank already set, and ranks a fresh matching code in the same call", async () => {
    if (!pool) throw new Error("pool not initialised");
    await pool.query(
      `INSERT INTO bms.point_keys (code, name, headline_rank) VALUES ($1, 'F3.68 fixture', 7), ($2, 'F3.68 fixture', NULL)`,
      [codeAlreadyRanked, codeFreshMatch],
    );

    await seedPointKeyHeadlineRanks(pool);

    const { rows } = await pool.query<{ code: string; headline_rank: number | null }>(
      `SELECT code, headline_rank FROM bms.point_keys WHERE code = ANY($1) ORDER BY code`,
      [[codeAlreadyRanked, codeFreshMatch]],
    );
    const byCode = new Map(rows.map((r) => [r.code, r.headline_rank]));
    expect(
      byCode.get(codeAlreadyRanked),
      `${codeAlreadyRanked} already held rank 7 — a re-seed must not revert it (OQ3)`,
    ).toBe(7);
    expect(
      byCode.get(codeFreshMatch),
      `${codeFreshMatch} started NULL and matches %_on — it must be ranked 10 (positive control)`,
    ).toBe(10);
  });

  // I3
  it("does not rank a code ending in 'on' with no underscore before it — proves the LIKE escape", async () => {
    if (!pool) throw new Error("pool not initialised");
    await pool.query(
      `INSERT INTO bms.point_keys (code, name, headline_rank) VALUES ($1, 'F3.68 fixture', NULL)`,
      [codeNoUnderscore],
    );

    await seedPointKeyHeadlineRanks(pool);

    const { rows } = await pool.query<{ headline_rank: number | null }>(
      `SELECT headline_rank FROM bms.point_keys WHERE code = $1`,
      [codeNoUnderscore],
    );
    expect(
      rows[0]?.headline_rank,
      `${codeNoUnderscore} must stay unranked — an unescaped %_on would wrongly match it`,
    ).toBeNull();
  });
});
