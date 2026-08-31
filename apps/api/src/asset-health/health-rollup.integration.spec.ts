import { randomUUID } from "node:crypto";

import type pg from "pg";

import { createDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import type { AggregateLevel } from "../telemetry/point-aggregates";
import { AssetHealthService } from "./asset-health.service";
import { levelRollupSql, rawRollupSql } from "./health-rollup-sql";

/**
 * `E1.3` (ADR 0050 + Amendment 1) — the SQL half of the health roll-up
 * (`health-rollup-sql.ts`) is only ever asserted as generated *text* by
 * `health-rollup-sql.spec.ts`. Nothing runs the statements against a real
 * database, so the `max`-versus-`sum` split, the tenant joins and the
 * `ELSE`-less `CASE`'s zero-write are unverified. This suite runs them.
 *
 * Fixtures are throwaway: two organizations, one asset each, minted here with
 * `randomUUID()` codes and deleted in `afterAll`. Nothing is read off the seed
 * — `bms.organizations`/`bms.locations`/`bms.assets`/`bms.automation_rules`
 * are only ever referenced here by the id this suite's own INSERT returned,
 * so none of the fixture-sharing hazards in `tests/integration-fixture-isolation.test.ts`
 * or `tests/f4.53-fixture-reads-prefer-seeded-rows.test.ts` apply — there is
 * no positional or pattern read of any of those four tables to race.
 *
 * `bms.assets` and `bms.automation_rules` are FORCE ROW LEVEL SECURITY
 * (migration 0047), so every write to either needs `app.current_organization`
 * set to the row's own `organization_id` inside the same transaction —
 * {@link withOrgWrite} below is the local equivalent of `withTenant` for
 * fixture writes. `telemetry.*` carries none (migration 0052's own header),
 * so those tables are written and read with a plain pooled query.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

interface Range {
  readonly from: Date;
  readonly to: Date;
}

/** Point keys, one per numbered requirement so no two fixtures can collide. */
const TAG_A = "e13hr_tagA"; // items 1, 2, 5 — a real firing rule plus a skipped one
const TAG_B = "e13hr_tagB"; // item 3 — the ONLY matching rule is skipped
const TAG_C = "e13hr_tagC"; // item 4 — telemetry, no rule at all
const TAG_D = "e13hr_tagD"; // item 6 — five 1m buckets rolled into one 5m bucket
const TAG_X = "e13hr_tagX"; // item 7a — an org-A rule pointing at org B's asset
const TAG_X_CONTROL = "e13hr_tagX_ctrl"; // item 7a positive control, on org A's own asset
const TAG_Y = "e13hr_tagY"; // item 7b — a materialized 1m row already sitting on org B's asset
const TAG_Y_CONTROL = "e13hr_tagY_ctrl"; // item 7b positive control, on org A's own asset
const TAG_Z_FOREIGN = "e13hr_tagZ_foreign"; // item 8 — org B's row INSIDE org A's tested window

/**
 * Far enough from any other suite's fixture window (`F4.1`'s is 2026-06-01)
 * that a shared Postgres instance cannot collide on time alone — though the
 * real isolation is that every row here also carries its own random
 * `asset_id`, so the composite primary keys below never collide regardless.
 */
const BASE = new Date("2031-03-01T00:00:00.000Z");
const HOUR = 3_600_000;
const MINUTE = 60_000;

const WINDOW_1: Range = { from: BASE, to: new Date(BASE.getTime() + MINUTE) };
const WINDOW_6: Range = {
  from: new Date(BASE.getTime() + HOUR),
  to: new Date(BASE.getTime() + HOUR + 5 * MINUTE),
};
const WINDOW_7_RAW: Range = {
  from: new Date(BASE.getTime() + 2 * HOUR),
  to: new Date(BASE.getTime() + 2 * HOUR + MINUTE),
};
const WINDOW_7_LEVEL: Range = {
  from: new Date(BASE.getTime() + 3 * HOUR),
  to: new Date(BASE.getTime() + 3 * HOUR + 5 * MINUTE),
};

export interface Fixtures {
  readonly orgAId: string;
  readonly orgBId: string;
  readonly assetAId: string;
  readonly assetBId: string;
  readonly ruleAId: string;
}

/** Runs `run` inside a transaction with `app.current_organization` set — the FORCE RLS bracket. */
async function withOrgWrite<T>(
  pool: pg.Pool,
  organizationId: string,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization', $1, true)", [organizationId]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** A vocabulary read, not a fixture read — `bms.asset_domains` is nobody's fixture row. */
async function anyAssetDomain(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1",
  );
  const code = rows[0]?.code;
  if (!code) {
    throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  }
  return code;
}

async function createOrganization(pool: pg.Pool, label: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO bms.organizations (code, name) VALUES ($1, $2) RETURNING id",
    [`E13HR-${label}-${randomUUID()}`, `E1.3 health-rollup fixture org ${label}`],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to insert fixture organization ${label}`);
  return id;
}

async function createLocationAndAsset(
  pool: pg.Pool,
  organizationId: string,
  label: string,
): Promise<{ locationId: string; assetId: string }> {
  const domain = await anyAssetDomain(pool);
  return withOrgWrite(pool, organizationId, async (client) => {
    const locResult = await client.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, 'site', 0, 0) RETURNING id`,
      [
        organizationId,
        `E13HR-${label}-LOC-${randomUUID()}`,
        `e13hr-${label}-loc-${randomUUID()}`,
        `E1.3 fixture location ${label}`,
      ],
    );
    const locationId = locResult.rows[0]?.id;
    if (!locationId) throw new Error(`failed to insert fixture location ${label}`);

    const assetResult = await client.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        organizationId,
        `E13HR-${label}-AST-${randomUUID()}`,
        `E1.3 fixture asset ${label}`,
        `E1.3 fixture site ${label}`,
        locationId,
        domain,
      ],
    );
    const assetId = assetResult.rows[0]?.id;
    if (!assetId) throw new Error(`failed to insert fixture asset ${label}`);
    return { locationId, assetId };
  });
}

interface RuleSpec {
  readonly organizationId: string;
  readonly assetId: string;
  readonly pointKey: string;
  readonly operator: string | null;
  readonly thresholdValue: number | null;
  readonly label: string;
}

/**
 * `rule.assetId` need not belong to `rule.organizationId` — nothing in the
 * schema requires it, since the FK on `asset_id` targets `bms.assets.id`
 * globally and FOREIGN KEY validation is not subject to row security
 * (PostgreSQL docs, "Row Security Policies"). Item 7a below relies on that:
 * a rule this insert is happy to create is exactly the shape the raw
 * roll-up's `JOIN bms.assets` has to defend against.
 */
async function createRule(pool: pg.Pool, rule: RuleSpec): Promise<string> {
  return withOrgWrite(pool, rule.organizationId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bms.automation_rules
         (organization_id, code, name, rule_type, enabled, asset_id, point_key,
          operator, threshold_value, lifecycle_status)
       VALUES ($1, $2, $3, 'threshold', true, $4, $5, $6, $7, 'published')
       RETURNING id`,
      [
        rule.organizationId,
        `E13HR-${rule.label}-${randomUUID()}`,
        `E1.3 fixture rule ${rule.label}`,
        rule.assetId,
        rule.pointKey,
        rule.operator,
        rule.thresholdValue,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`failed to insert fixture rule ${rule.label}`);
    return id;
  });
}

async function updateRuleThreshold(
  pool: pg.Pool,
  organizationId: string,
  ruleId: string,
  thresholdValue: number,
): Promise<void> {
  await withOrgWrite(pool, organizationId, async (client) => {
    await client.query("UPDATE bms.automation_rules SET threshold_value = $1 WHERE id = $2", [
      thresholdValue,
      ruleId,
    ]);
  });
}

async function insertSamples(
  pool: pg.Pool,
  assetId: string,
  pointKey: string,
  samples: ReadonlyArray<{ time: Date; value: number }>,
): Promise<void> {
  for (const s of samples) {
    await pool.query(
      "INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit) VALUES ($1, $2, $3, $4, NULL)",
      [s.time.toISOString(), assetId, pointKey, s.value],
    );
  }
}

/** Directly seeds an already-materialized `1m` row — item 7b needs one on org B's asset. */
async function insertInRange1mRow(
  pool: pg.Pool,
  row: {
    bucket: Date;
    assetId: string;
    pointKey: string;
    inRangeCount: number;
    sampleCount: number;
    ruleCount: number;
    skippedRuleCount: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO telemetry.point_in_range_1m
       (bucket, asset_id, point_key, in_range_count, sample_count, rule_count, skipped_rule_count, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      row.bucket.toISOString(),
      row.assetId,
      row.pointKey,
      row.inRangeCount,
      row.sampleCount,
      row.ruleCount,
      row.skippedRuleCount,
    ],
  );
}

async function runRawRollup(pool: pg.Pool, organizationId: string, range: Range): Promise<void> {
  const db = createDb(pool);
  await withTenant(db, organizationId, (tx) => tx.execute(rawRollupSql(range.from, range.to)));
}

async function runLevelRollup(
  pool: pg.Pool,
  organizationId: string,
  fromLevel: AggregateLevel,
  toLevel: AggregateLevel,
  range: Range,
): Promise<void> {
  const db = createDb(pool);
  await withTenant(db, organizationId, (tx) =>
    tx.execute(levelRollupSql(fromLevel, toLevel, range.from, range.to)),
  );
}

interface RangeRow {
  readonly bucket: Date;
  readonly asset_id: string;
  readonly point_key: string;
  readonly in_range_count: string;
  readonly sample_count: string;
  readonly rule_count: number;
  readonly skipped_rule_count: number;
}

/** `telemetry.point_in_range_*` carries no RLS, so any pool connection may read it. */
async function readInRangeRow(
  pool: pg.Pool,
  level: "1m" | "5m",
  assetId: string,
  pointKey: string,
): Promise<RangeRow | undefined> {
  const { rows } = await pool.query<RangeRow>(
    `SELECT * FROM telemetry.point_in_range_${level} WHERE asset_id = $1 AND point_key = $2`,
    [assetId, pointKey],
  );
  assert(rows.length <= 1, `expected at most 1 row for ${assetId}/${pointKey}, got ${rows.length}`);
  return rows[0];
}

/**
 * Builds every fixture this suite needs, and runs every roll-up call that is
 * NOT part of the mutation the "ON CONFLICT DO UPDATE" test (item 5) performs
 * itself. Item 5's own `it` reads the state this leaves behind, mutates a
 * rule, and reruns `rawRollupSql` over the identical window — so its `before`
 * state has to be exactly what items 1, 2 and 4 already asserted against.
 */
export async function setupFixtures(pool: pg.Pool): Promise<Fixtures> {
  const orgAId = await createOrganization(pool, "A");
  const orgBId = await createOrganization(pool, "B");
  const { assetId: assetAId } = await createLocationAndAsset(pool, orgAId, "A");
  const { assetId: assetBId } = await createLocationAndAsset(pool, orgBId, "B");

  // TAG_A: one real rule (gt 10) plus one unevaluatable rule on the same tag.
  const ruleAId = await createRule(pool, {
    organizationId: orgAId,
    assetId: assetAId,
    pointKey: TAG_A,
    operator: "gt",
    thresholdValue: 10,
    label: "R1",
  });
  await createRule(pool, {
    organizationId: orgAId,
    assetId: assetAId,
    pointKey: TAG_A,
    operator: null,
    thresholdValue: null,
    label: "R2-skip",
  });
  // TAG_B: the ONLY matching rule is unevaluatable.
  await createRule(pool, {
    organizationId: orgAId,
    assetId: assetAId,
    pointKey: TAG_B,
    operator: null,
    thresholdValue: null,
    label: "R3-skip",
  });
  // TAG_D: one rule that never fires, spread across five 1m buckets.
  await createRule(pool, {
    organizationId: orgAId,
    assetId: assetAId,
    pointKey: TAG_D,
    operator: "gt",
    thresholdValue: 1_000_000,
    label: "R4",
  });
  // TAG_X: an org-A rule whose asset_id points at org B's own asset — the data
  // anomaly the raw roll-up's `JOIN bms.assets` exists to contain.
  await createRule(pool, {
    organizationId: orgAId,
    assetId: assetBId,
    pointKey: TAG_X,
    operator: "gt",
    thresholdValue: 10,
    label: "RX-cross-org",
  });
  // TAG_X_CONTROL: the same shape, on org A's own asset — proves the sweep
  // actually ran and would have written TAG_X's row too, absent the join.
  await createRule(pool, {
    organizationId: orgAId,
    assetId: assetAId,
    pointKey: TAG_X_CONTROL,
    operator: "gt",
    thresholdValue: 10,
    label: "RX-control",
  });

  // TAG_A: 5 samples in one minute, 2 exceed 10 (11, 15).
  await insertSamples(pool, assetAId, TAG_A, [
    { time: new Date(WINDOW_1.from.getTime() + 1_000), value: 5 },
    { time: new Date(WINDOW_1.from.getTime() + 11_000), value: 8 },
    { time: new Date(WINDOW_1.from.getTime() + 21_000), value: 11 },
    { time: new Date(WINDOW_1.from.getTime() + 31_000), value: 15 },
    { time: new Date(WINDOW_1.from.getTime() + 41_000), value: 9 },
  ]);
  // TAG_B: 3 samples, value is irrelevant — its only rule is unevaluatable.
  await insertSamples(pool, assetAId, TAG_B, [
    { time: new Date(WINDOW_1.from.getTime() + 1_000), value: 1 },
    { time: new Date(WINDOW_1.from.getTime() + 2_000), value: 2 },
    { time: new Date(WINDOW_1.from.getTime() + 3_000), value: 3 },
  ]);
  // TAG_C: telemetry with NO rule at all — must get no row (ADR 0050 decision 3).
  await insertSamples(pool, assetAId, TAG_C, [
    { time: new Date(WINDOW_1.from.getTime() + 1_000), value: 1 },
    { time: new Date(WINDOW_1.from.getTime() + 2_000), value: 2 },
  ]);
  // TAG_D: one sample per minute across 5 distinct 1m buckets.
  for (let minute = 0; minute < 5; minute += 1) {
    await insertSamples(pool, assetAId, TAG_D, [
      { time: new Date(WINDOW_6.from.getTime() + minute * MINUTE + 1_000), value: 1 },
    ]);
  }
  // TAG_X on org B's asset, and TAG_X_CONTROL on org A's own asset, same window.
  await insertSamples(pool, assetBId, TAG_X, [
    { time: new Date(WINDOW_7_RAW.from.getTime() + 1_000), value: 5 },
  ]);
  await insertSamples(pool, assetAId, TAG_X_CONTROL, [
    { time: new Date(WINDOW_7_RAW.from.getTime() + 1_000), value: 5 },
  ]);

  // Item 7b's already-materialized 1m rows: one on org B's asset (the leak
  // this fixture must NOT propagate), one on org A's own asset (the control).
  await insertInRange1mRow(pool, {
    bucket: WINDOW_7_LEVEL.from,
    assetId: assetBId,
    pointKey: TAG_Y,
    inRangeCount: 1,
    sampleCount: 1,
    ruleCount: 1,
    skippedRuleCount: 0,
  });
  await insertInRange1mRow(pool, {
    bucket: WINDOW_7_LEVEL.from,
    assetId: assetAId,
    pointKey: TAG_Y_CONTROL,
    inRangeCount: 1,
    sampleCount: 1,
    ruleCount: 1,
    skippedRuleCount: 0,
  });

  // Every roll-up call except item 5's own rerun.
  await runRawRollup(pool, orgAId, WINDOW_1);
  await runRawRollup(pool, orgAId, WINDOW_6);
  await runLevelRollup(pool, orgAId, "1m", "5m", WINDOW_6);
  await runRawRollup(pool, orgAId, WINDOW_7_RAW);
  await runLevelRollup(pool, orgAId, "1m", "5m", WINDOW_7_LEVEL);

  return { orgAId, orgBId, assetAId, assetBId, ruleAId };
}

export async function teardownFixtures(pool: pg.Pool, fx: Fixtures): Promise<void> {
  await pool.query("DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])", [
    [fx.assetAId, fx.assetBId],
  ]);
  // **Four statements written out, not a loop over an interpolated table name.**
  // `tests/adr-0024-retention-bounds.test.ts` scans every `DELETE` against
  // `telemetry.*` for a `${` and fails on one, and it is right to: the ids here
  // are bound, but the scan cannot tell a closed-vocabulary table name from a
  // value, and the whole point of a blunt gate on this surface is that it does
  // not have to. §4.4 is parameterised queries only.
  const assetIds = [[fx.assetAId, fx.assetBId]];
  await pool.query("DELETE FROM telemetry.point_in_range_1m WHERE asset_id = ANY($1::uuid[])", assetIds);
  await pool.query("DELETE FROM telemetry.point_in_range_5m WHERE asset_id = ANY($1::uuid[])", assetIds);
  await pool.query("DELETE FROM telemetry.point_in_range_1h WHERE asset_id = ANY($1::uuid[])", assetIds);
  await pool.query("DELETE FROM telemetry.point_in_range_1d WHERE asset_id = ANY($1::uuid[])", assetIds);
  await withOrgWrite(pool, fx.orgAId, (client) =>
    client.query("DELETE FROM bms.automation_rules WHERE organization_id = $1", [fx.orgAId]),
  );
  await withOrgWrite(pool, fx.orgAId, (client) =>
    client.query("DELETE FROM bms.assets WHERE id = $1", [fx.assetAId]),
  );
  await withOrgWrite(pool, fx.orgBId, (client) =>
    client.query("DELETE FROM bms.assets WHERE id = $1", [fx.assetBId]),
  );
  await withOrgWrite(pool, fx.orgAId, (client) =>
    client.query("DELETE FROM bms.locations WHERE organization_id = $1", [fx.orgAId]),
  );
  await withOrgWrite(pool, fx.orgBId, (client) =>
    client.query("DELETE FROM bms.locations WHERE organization_id = $1", [fx.orgBId]),
  );
  await pool.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [
    [fx.orgAId, fx.orgBId],
  ]);
}

/** Item 1: one published `gt 10` rule, 5 samples, 2 exceed it → in_range_count = 3. */
export async function assertInRangeCountIsCorrect(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const row = await readInRangeRow(pool, "1m", fx.assetAId, TAG_A);
  assert(row !== undefined, "expected a point_in_range_1m row for TAG_A");
  assert(
    Number(row?.sample_count) === 5,
    `expected sample_count 5, got ${row?.sample_count}`,
  );
  assert(
    Number(row?.in_range_count) === 3,
    `expected in_range_count 3 (5 samples, 2 exceeding 10), got ${row?.in_range_count}`,
  );
}

/** Item 2: a second, unevaluatable rule on the same tag is skipped, not treated as not-firing. */
export async function assertMalformedRuleIsSkippedNotTreatedAsNotFiring(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const row = await readInRangeRow(pool, "1m", fx.assetAId, TAG_A);
  assert(row !== undefined, "expected a point_in_range_1m row for TAG_A");
  assert(row?.rule_count === 1, `expected rule_count 1, got ${row?.rule_count}`);
  assert(
    row?.skipped_rule_count === 1,
    `expected skipped_rule_count 1, got ${row?.skipped_rule_count}`,
  );
  assert(
    Number(row?.in_range_count) === 3,
    `a skipped rule must not change in_range_count — expected 3, got ${row?.in_range_count}`,
  );
}

/**
 * Item 3 — the most important assertion in this file. Before the fix this
 * statement wrote `in_range_count = sample_count`, a fabricated perfect
 * score, whenever every matching rule was unevaluatable.
 */
export async function assertAllSkippedStateWritesZero(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const row = await readInRangeRow(pool, "1m", fx.assetAId, TAG_B);
  assert(row !== undefined, "expected a point_in_range_1m row for TAG_B");
  assert(row?.rule_count === 0, `expected rule_count 0, got ${row?.rule_count}`);
  assert(
    row?.skipped_rule_count === 1,
    `expected skipped_rule_count 1, got ${row?.skipped_rule_count}`,
  );
  assert(
    Number(row?.in_range_count) === 0,
    `an all-skipped tag must write in_range_count = 0, got ${row?.in_range_count} ` +
      `(sample_count was ${row?.sample_count} — a fabricated perfect score looks like ` +
      "in_range_count === sample_count)",
  );
}

/** Item 4: a tag with telemetry but no matching rule at all gets no row (ADR 0050 decision 3). */
export async function assertUnruledTagGetsNoRow(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const row = await readInRangeRow(pool, "1m", fx.assetAId, TAG_C);
  assert(row === undefined, `expected no row for an unruled tag, got ${JSON.stringify(row)}`);
}

/**
 * Item 5: `ON CONFLICT ... DO UPDATE` must re-evaluate against the CURRENT
 * rule set. Widens TAG_A's rule from `gt 10` to `gt 100` — none of the 5
 * samples (max 15) now fire — and reruns the identical window. `DO NOTHING`
 * would leave `in_range_count` frozen at 3; this asserts it moved to 5.
 */
export async function assertOnConflictReEvaluatesOnRerun(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const before = await readInRangeRow(pool, "1m", fx.assetAId, TAG_A);
  assert(
    Number(before?.in_range_count) === 3,
    `precondition failed: expected the pre-mutation in_range_count to be 3, got ${before?.in_range_count}`,
  );

  await updateRuleThreshold(pool, fx.orgAId, fx.ruleAId, 100);
  await runRawRollup(pool, fx.orgAId, WINDOW_1);

  const after = await readInRangeRow(pool, "1m", fx.assetAId, TAG_A);
  assert(after !== undefined, "expected the row to still exist after the rerun");
  assert(
    Number(after?.in_range_count) === 5,
    `expected the rerun to re-evaluate against the widened threshold and write 5, got ` +
      `${after?.in_range_count} — a value still at 3 means ON CONFLICT DID NOTHING`,
  );
}

/**
 * Item 6: `levelRollupSql` sums `in_range_count`/`sample_count` but takes
 * `max` of `rule_count`/`skipped_rule_count`. Five `1m` buckets each with
 * `rule_count = 1` must roll into one `5m` bucket with `rule_count = 1`, not
 * `5` — summing all four columns is the shape that looks right and is wrong
 * on exactly these two.
 */
export async function assertLevelRollupSumsCountsAndMaxesRuleTallies(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const row = await readInRangeRow(pool, "5m", fx.assetAId, TAG_D);
  assert(row !== undefined, "expected a point_in_range_5m row for TAG_D");
  assert(
    Number(row?.sample_count) === 5,
    `expected sample_count summed to 5, got ${row?.sample_count}`,
  );
  assert(
    Number(row?.in_range_count) === 5,
    `expected in_range_count summed to 5 (nothing fires), got ${row?.in_range_count}`,
  );
  assert(
    row?.rule_count === 1,
    `expected rule_count maxed to 1, got ${row?.rule_count} — summing would give 5`,
  );
  assert(
    row?.skipped_rule_count === 0,
    `expected skipped_rule_count maxed to 0, got ${row?.skipped_rule_count}`,
  );
}

/**
 * Item 7: the tenant join actually contains, for BOTH statements.
 *
 * Raw: an org-A rule points at org B's own asset, which has matching
 * telemetry in range. `JOIN bms.assets` under org A's FORCE RLS context hides
 * that asset (it belongs to org B), so no row must exist for it — while the
 * identically-shaped control on org A's own asset proves the sweep ran at all.
 *
 * Level: a `1m` row already sits on org B's asset — as if org B's own sweep
 * had written it, since `telemetry.point_in_range_1m` carries no RLS of its
 * own. Org A's `levelRollupSql` must not fold it into a `5m` row, while the
 * control on org A's own asset again proves the statement executed.
 */
export async function assertTenantJoinContainsRawAndLevelRollups(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const rawLeak = await readInRangeRow(pool, "1m", fx.assetBId, TAG_X);
  assert(
    rawLeak === undefined,
    `rawRollupSql must not write a row for another organization's asset, got ${JSON.stringify(rawLeak)}`,
  );
  const rawControl = await readInRangeRow(pool, "1m", fx.assetAId, TAG_X_CONTROL);
  assert(
    rawControl !== undefined,
    "the raw roll-up positive control must have a row — otherwise the negative assertion above is vacuous",
  );

  const levelLeak = await readInRangeRow(pool, "5m", fx.assetBId, TAG_Y);
  assert(
    levelLeak === undefined,
    `levelRollupSql must not fold another organization's already-materialized row into a 5m ` +
      `bucket, got ${JSON.stringify(levelLeak)}`,
  );
  const levelControl = await readInRangeRow(pool, "5m", fx.assetAId, TAG_Y_CONTROL);
  assert(
    levelControl !== undefined,
    "the level roll-up positive control must have a row — otherwise the negative assertion above is vacuous",
  );
}

/**
 * Item 8 — `F4.72`: `coveredBuckets` is a union across the scope, executed.
 *
 * **The read half of the feature, asserted beside the writer that made its
 * rows.** `AssetHealthService.readCounters` groups by `(asset_id, point_key)`,
 * so its coverage subquery is the only place the bucket instants survive; it
 * runs against a real Postgres nowhere else, and `asset-health.service.spec.ts`
 * builds its rows by hand and therefore cannot see this at all. Two facts only
 * a database can settle:
 *
 * 1. **The statement is valid SQL.** A subquery in the select list of a grouped
 *    query is exactly the shape Postgres rejects when a column reference binds
 *    to the outer relation instead of the inner one. Rendering it to text
 *    proves nothing about that.
 * 2. **The count is a union, not a maximum and not a sum.** The fixtures above
 *    already separate the three, without being built for it:
 *
 *    | tag     | 1m buckets on asset A, inside `[BASE, BASE+2h)` |
 *    |---------|------------------------------------------------|
 *    | `TAG_A` | 1 — `BASE` (`WINDOW_1`)                        |
 *    | `TAG_B` | 1 — `BASE`, all-skipped, still a row           |
 *    | `TAG_D` | 5 — `BASE+1h` .. `+1h4m` (`WINDOW_6`)          |
 *
 *    So the maximum across tags is **5**, the sum of the per-tag counts is
 *    **7**, and the union — the answer Amendment 2 decision 1 defines — is
 *    **6**. `TAG_X_CONTROL` sits at `BASE+2h` exactly and `TAG_Y_CONTROL` at
 *    `BASE+3h`; both are outside the half-open window, which is itself worth
 *    asserting because `bucket < to` is what keeps them out.
 *
 * The service is constructed on this suite's own pool rather than through Nest.
 * `bms.assets` and `bms.asset_points` are FORCE ROW LEVEL SECURITY and this
 * pool sets no `app.current_organization`, so `healthForAssets` and
 * `catalogPoints` answer nothing — which is fine and deliberate. The window
 * fields under test come from `telemetry.point_in_range_1m`, which carries no
 * policy, and a scoreless response is the honest one for a caller with no
 * tenant context.
 */
export async function assertCoveredBucketsIsTheUnionAcrossTheScope(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const service = new AssetHealthService(createDb(pool));
  // `now` at BASE+2h with a 120-minute window gives `[BASE, BASE+2h)` at the
  // `1m` rung — `granularityFor(120)` is `1m`, and 2 hours is nowhere near the
  // retention horizon that could coarsen it.
  const result = await service.forAsset(fx.assetAId, 120, new Date(BASE.getTime() + 2 * HOUR));

  assert(
    result.bucketSeconds === 60,
    `a 120-minute window must be read at the 1m rung, got ${result.bucketSeconds}s buckets`,
  );
  assert(
    result.expectedBuckets === 120,
    `120 minutes of 1m buckets expects 120, got ${result.expectedBuckets}`,
  );
  assert(
    result.coveredBuckets === 6,
    `coveredBuckets must be the UNION of the scope's distinct bucket instants (6). ` +
      `5 would be the maximum across tags, 7 the sum of their per-tag counts. Got ` +
      `${result.coveredBuckets}.`,
  );
  assert(
    result.coveredBuckets <= result.expectedBuckets,
    `coverage may never exceed the window's own bucket count — ${result.coveredBuckets} > ` +
      `${result.expectedBuckets} means the level's bucket width and F3.35's ladder disagree`,
  );
  assert(
    result.computedAt !== null,
    "a covered window must report an instant — `telemetry.point_in_range_*` declares " +
      "`computed_at NOT NULL`, so coveredBuckets > 0 and computedAt: null cannot both be right",
  );

  // The other direction: a window the roll-up has not reached reports no
  // coverage AND no instant, together. `BASE - 2h` predates every fixture row.
  const uncovered = await service.forAsset(fx.assetAId, 120, new Date(BASE.getTime() - 2 * HOUR));
  assert(
    uncovered.coveredBuckets === 0,
    `an untouched window covers no bucket, got ${uncovered.coveredBuckets}`,
  );
  assert(
    uncovered.computedAt === null,
    `coveredBuckets: 0 and computedAt: null must arrive together, got ${String(uncovered.computedAt)}`,
  );
  assert(
    uncovered.expectedBuckets === 120,
    `the requested window still expects 120 buckets, got ${uncovered.expectedBuckets}`,
  );

  // **Cross-scope exclusion, and it needs a row INSIDE the window to mean
  // anything** (security review). Org B's own fixture row sits at `BASE+2h`,
  // which `bucket < to` already excludes — so without this insert, a subquery
  // whose predicate had been WIDENED to every asset would still read 6 and the
  // assertion above would stay green. This row is on org B's asset, at an
  // instant inside `[BASE, BASE+2h)` that is not one of asset A's six.
  const foreignBucket = new Date(BASE.getTime() + 30 * MINUTE);
  await insertInRange1mRow(pool, {
    bucket: foreignBucket,
    assetId: fx.assetBId,
    pointKey: TAG_Z_FOREIGN,
    inRangeCount: 1,
    sampleCount: 1,
    ruleCount: 1,
    skippedRuleCount: 0,
  });

  const stillContained = await service.forAsset(
    fx.assetAId,
    120,
    new Date(BASE.getTime() + 2 * HOUR),
  );
  assert(
    stillContained.coveredBuckets === 6,
    `coverage must count only the scope's own buckets. Org B has a row at an instant inside ` +
      `this window that org A does not, so a predicate widened past the asset restriction reads ` +
      `7 here. Got ${stillContained.coveredBuckets}.`,
  );
  // The positive control: the same relation, the same window, a different
  // scope, a different answer. Without it the assertion above could pass on a
  // subquery that counted nothing at all.
  const foreignScope = await service.forAsset(
    fx.assetBId,
    120,
    new Date(BASE.getTime() + 2 * HOUR),
  );
  assert(
    foreignScope.coveredBuckets === 1,
    `org B's own scope must see its own single bucket in this window, or the assertion above ` +
      `is vacuous. Got ${foreignScope.coveredBuckets}.`,
  );
}

/**
 * Item 9 — `F4.72` / ADR 0050 Amendment 3: a whole window is reachable, and it
 * is the read's bucket alignment that makes it so.
 *
 * **This is the test whose absence hid a shipped defect.** `alignedWindow`
 * ends the sweep at `floorToBucket(now)` (ADR 0050 decision 5), so the newest
 * bucket ever written is one width older than that. An unaligned read took
 * `to = now` and admitted the in-flight bucket, which the writer is forbidden
 * to write — so `coveredBuckets` could never equal `expectedBuckets` at any
 * rung, and the partial-window banner would have been permanently on.
 *
 * The jsdom fixture could not catch it: it asserts a complete window from a
 * hand-written `1 / 1`, a state the server arithmetic forbade. Only real rows
 * read through the real window arithmetic can tell the two apart.
 *
 * **`now` is deliberately off the bucket boundary** — `BASE + 1m + 30s`. That
 * is what makes this a test of the ALIGNMENT rather than of the fixtures:
 *
 * - unaligned, `to` would be `BASE+1m30s` and `from` `BASE+30s`, whose only
 *   aligned instant is `BASE+1m` — a bucket nothing wrote. Covered 0 of 1.
 * - aligned, `to` is `BASE+1m` and `from` `BASE`, whose only aligned instant is
 *   `BASE` — where `TAG_A` and `TAG_B` both have rows. Covered 1 of 1.
 */
export async function assertAWholeWindowIsReachable(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const service = new AssetHealthService(createDb(pool));
  const unaligned = new Date(BASE.getTime() + MINUTE + 30_000);
  const result = await service.forAsset(fx.assetAId, 1, unaligned);

  assert(
    result.expectedBuckets === 1,
    `a 1-minute window at the 1m rung expects exactly 1 bucket, got ${result.expectedBuckets}`,
  );
  assert(
    result.coveredBuckets === 1,
    `the read must align its window to the bucket boundary the SWEEP writes to. Unaligned, this ` +
      `window covers the in-flight bucket that the roll-up is forbidden to write, and reads 0. ` +
      `Got ${result.coveredBuckets}.`,
  );
  assert(
    result.windowTo === new Date(BASE.getTime() + MINUTE).toISOString(),
    `windowTo must be the aligned instant, so the pair on the wire describes the window the two ` +
      `integers were counted over. Got ${result.windowTo}.`,
  );
  assert(
    result.computedAt !== null,
    "a covered window reports an instant",
  );
}
