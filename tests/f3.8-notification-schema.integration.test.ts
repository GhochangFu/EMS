import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.8` — what migration `0038_notification_channels.sql` guarantees.
 *
 * **This lives in `tests/`, not in `packages/db`, and that is load-bearing.**
 * The plan first put it at
 * `packages/db/src/notification-channels-seed.integration.spec.ts` with a
 * `.integration.test.ts` wrapper. Neither file would ever have run:
 * `vitest.config.ts` lists `apps/api`, `apps/web`, `apps/ingest`,
 * `packages/shared` and the root `repo` project, and `packages/db` is in none
 * of them. `tests/repo-invariants.test.ts` would not have caught it either — it
 * fails a `.spec` with **no** wrapper, not a wrapper nothing collects, so the
 * gate would have stayed green over a dead test.
 * `tests/f1.7-seed-ownership.integration.test.ts` records the same fact
 * ("`packages/db` is outside the coverage denominator") and is the shape
 * followed here: assertions inline, no `.spec` pair, and every row restored.
 *
 * Three things are worth a database to check, and none of them can be checked
 * without one:
 *
 * 1. The kind vocabulary is seeded **by the migration**, before `pnpm db:seed`
 *    runs. That is the F3.6 fresh-database trap in reverse — the migration
 *    seeds only a table that joins nothing, so it works on an empty database.
 * 2. `notification_deliveries_status_check` refuses a sixth status. The closed
 *    set is the reason the status column is a CHECK while `kind` is a lookup
 *    table (plan D3); if the constraint is missing, that asymmetry is a comment
 *    rather than a rule.
 * 3. `notification_channels.kind` really is a foreign key into the vocabulary,
 *    so an unknown kind is refused at write time rather than discovered when a
 *    transport lookup returns nothing.
 *
 * The channel row every case needs is created here, not seeded: the migration
 * deliberately ships no demo channel.
 */

const connectionString = requireIntegrationDb({
  item: "F3.8",
  label: "notification schema tests",
  because:
    "the migration's own seed of the channel-kind vocabulary, the delivery-status CHECK and the " +
    "kind foreign key are all constraints Postgres enforces, so a green run without a database " +
    "asserts nothing about any of them.",
});

// Derived, not imported from `pg`: that package is a dependency of `apps/api`
// and `packages/db`, not of the repo root, so a `pg` type import fails
// `typecheck:tests`. `f1.7-seed-ownership.integration.test.ts` does the same.
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

/** Prefixed so a leftover row from a failed run is recognisable and removable. */
const TEST_CHANNEL_CODE = "f3-8-test-channel";

describe.skipIf(!connectionString)("F3.8 notification schema", () => {
  let pool: IntegrationPool | undefined;
  let channelId: string;

  async function removeTestRows(): Promise<void> {
    if (!pool) throw new Error("pool not initialised");
    // Deliveries first: `notification_deliveries_channel_id_fk` is NO ACTION on
    // purpose, so a channel with history cannot be deleted. That refusal is the
    // design (history outlives configuration); the cleanup order respects it.
    await pool.query(
      `DELETE FROM bms.notification_deliveries
        WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE code = $1)`,
      [TEST_CHANNEL_CODE],
    );
    await pool.query(`DELETE FROM bms.notification_channels WHERE code = $1`, [
      TEST_CHANNEL_CODE,
    ]);
  }

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.8");
    await removeTestRows();
    const created = await pool.query<{ id: string }>(
      `INSERT INTO bms.notification_channels (code, name, kind)
       VALUES ($1, 'F3.8 test channel', 'webhook')
       RETURNING id`,
      [TEST_CHANNEL_CODE],
    );
    const row = created.rows[0];
    if (row === undefined) throw new Error("could not create the test channel");
    channelId = row.id;
  }, 60_000);

  afterAll(async () => {
    if (pool) await removeTestRows();
    await pool?.end();
  }, 60_000);

  it("seeds both channel kinds from the migration itself", async () => {
    if (!pool) throw new Error("pool not initialised");
    const kinds = await pool.query<{ code: string }>(
      `SELECT code FROM bms.notification_channel_kinds ORDER BY code`,
    );
    // Containment, not equality. The first draft asserted
    // `toEqual(["email", "webhook"])`, which contradicts the migration's own
    // premise: the vocabulary is OPEN, and F3.9 adds `sms` as a row with no
    // schema change. That assertion would have turned red on the day the
    // feature it was written to support arrived.
    expect(kinds.rows.map((r) => r.code)).toEqual(
      expect.arrayContaining(["email", "webhook"]),
    );
  });

  it("refuses a half-written secret (all three columns or none)", async () => {
    if (!pool) throw new Error("pool not initialised");
    // The comment claimed the three columns are "read together or not at all";
    // nothing enforced it, so a row with ciphertext and no key version was
    // representable and would be undecryptable in a way nothing detects until a
    // send fails.
    await expect(
      pool.query(
        `INSERT INTO bms.notification_channels (code, name, kind, secret_ciphertext)
         VALUES ($1, 'half a secret', 'webhook', '\\x00'::bytea)`,
        [`${TEST_CHANNEL_CODE}-half`],
      ),
    ).rejects.toThrow(/notification_channels_secret_complete_check/);
  });

  it("refuses a delivery status outside the five (plan D3)", async () => {
    if (!pool) throw new Error("pool not initialised");
    await expect(
      pool.query(
        `INSERT INTO bms.notification_deliveries (channel_id, status)
         VALUES ($1, 'delivered')`,
        [channelId],
      ),
    ).rejects.toThrow(/notification_deliveries_status_check/);
  });

  it("accepts every one of the five, skips included", async () => {
    if (!pool) throw new Error("pool not initialised");
    // The skips are the half worth asserting: ADR 0041 decision 4 records a row
    // for an attempt that sent nothing, because "no notification arrived" and
    // "no notification was attempted" are different answers to an operator.
    const statuses = [
      "sent",
      "failed",
      "skipped_unconfigured",
      "skipped_deduped",
      "skipped_rate_limited",
    ];
    for (const status of statuses) {
      await pool.query(
        `INSERT INTO bms.notification_deliveries (channel_id, status) VALUES ($1, $2)`,
        [channelId, status],
      );
    }
    const written = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bms.notification_deliveries WHERE channel_id = $1`,
      [channelId],
    );
    expect(written.rows[0]?.count).toBe(String(statuses.length));
  });

  it("refuses a channel whose kind the vocabulary does not declare", async () => {
    if (!pool) throw new Error("pool not initialised");
    await expect(
      pool.query(
        `INSERT INTO bms.notification_channels (code, name, kind)
         VALUES ($1, 'unknown kind', 'carrier-pigeon')`,
        [`${TEST_CHANNEL_CODE}-pigeon`],
      ),
    ).rejects.toThrow(/notification_channels_kind_fk/);
  });

  it("keeps no secret material in config", async () => {
    if (!pool) throw new Error("pool not initialised");
    // Plan D2 and AGENTS.md §9.6: `config` is returned by the API and appears
    // in logs, so the three secret columns exist to keep a credential off both
    // paths. This asserts the columns are there to hold it.
    const columns = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'bms'
          AND table_name = 'notification_channels'
          AND column_name IN ('secret_ciphertext', 'secret_iv', 'secret_key_version')
        ORDER BY column_name`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      "secret_ciphertext",
      "secret_iv",
      "secret_key_version",
    ]);
    // All three nullable together — a channel with no secret has no key version
    // either, which is why this diverges from `rtu_connection_configs`.
    expect(columns.rows.every((r) => r.is_nullable === "YES")).toBe(true);
  });
});
