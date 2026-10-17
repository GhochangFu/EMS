import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.263` — what migration `0112` does to real rows. The static twin
 * `tests/f4.263-network-demo-node-keys-migration.test.ts` asserts the file's text and its journal
 * entry; this executes the file's own bytes.
 *
 * The `tests/f4.258-committed-secrets-strip.integration.test.ts` lifecycle: a superuser pool, one
 * held client, every case inside a transaction that is always rolled back — nothing commits. Each
 * case writes two fixture organizations and four layouts as the superuser, with **no tenant GUC**,
 * then runs the migration text as the superuser — the role the migrator runs it as. A file that put
 * the UPDATE inside `SET ROLE bms_owner` would meet FORCE row security with no GUC, rename nothing,
 * and redden M1.
 *
 * `ctid` is the no-op proof: an UPDATE writes a new tuple version, so a row whose `ctid` is
 * unchanged was not updated, even inside one transaction.
 *
 * The pipes are read through their node ids, so M1's pipe strings prove that the pipes follow the
 * renamed nodes without a write of their own.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out (§4.6).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.263",
  label: "migration 0112 renames the seeded hyphen node keys",
  because:
    "which rows the 0112 UPDATE reaches depends on row security and the role it runs as, " +
    "so only a real database can show it renames the seeded keys and spares every other row.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_SQL = readFileSync(
  join(repoRoot, "packages/db/drizzle/0112_network_demo_node_keys.sql"),
  "utf8",
);

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

/** The four fixture layouts, by role in the case. */
type Fixture = { seeded: string; validKeys: string; otherSlug: string; collision: string };

describe.skipIf(!has)("F4.263 — migration 0112 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.263",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Writes the fixture, runs `body`, and always rolls back. */
  const inTx = async (body: (run: Run, fx: Fixture) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = async (suffix: string): Promise<string> =>
        (
          await run(
            `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
            [`F4263${suffix}${RUN}`.toUpperCase(), `F4.263 fixture ${suffix} ${RUN}`],
          )
        ).rows[0]?.id as string;
      const layout = async (
        orgId: string,
        slug: string,
        keys: readonly string[],
        pipes: ReadonlyArray<readonly [string, string]>,
      ): Promise<string> => {
        const id = (
          await run(
            `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
             VALUES ($1, $2, $3, 100, 60) RETURNING id`,
            [orgId, `F4.263 ${slug}`, slug],
          )
        ).rows[0]?.id as string;
        for (const [index, key] of keys.entries()) {
          await run(
            `INSERT INTO bms.mimic_layout_nodes (organization_id, layout_id, key, kind, symbol, label, x, y, w, h)
             VALUES ($1, $2, $3, 'unit', 'breaker', $3, $4, 0, 20, 25)`,
            [orgId, id, key, index * 20],
          );
        }
        for (const [from, to] of pipes) {
          await run(
            `INSERT INTO bms.mimic_layout_pipes (organization_id, layout_id, from_node_id, to_node_id)
             SELECT $1, $2, f.id, t.id FROM bms.mimic_layout_nodes f, bms.mimic_layout_nodes t
              WHERE f.layout_id = $2 AND f.key = $3 AND t.layout_id = $2 AND t.key = $4`,
            [orgId, id, from, to],
          );
        }
        return id;
      };
      const first = await org("A");
      const second = await org("B");
      const fx: Fixture = {
        seeded: await layout(
          first,
          "network-demo-ht-lt",
          ["grid-cb", "bus-a", "out-cb-a", "coupler"],
          [
            ["grid-cb", "bus-a"],
            ["bus-a", "out-cb-a"],
            ["bus-a", "coupler"],
          ],
        ),
        validKeys: await layout(first, "network-demo-flow", ["pump", "header"], [["pump", "header"]]),
        otherSlug: await layout(first, `f4263-other-${RUN}`, ["grid-cb", "bus-a"], [["grid-cb", "bus-a"]]),
        collision: await layout(second, "network-demo-ht-lt", ["tr-b", "tr_b"], []),
      };
      await body(run, fx);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** `key@ctid`, sorted by key. */
  const nodesOf = async (run: Run, layoutId: string): Promise<string[]> =>
    (
      await run(
        `SELECT key || '@' || ctid::text AS row FROM bms.mimic_layout_nodes WHERE layout_id = $1 ORDER BY key`,
        [layoutId],
      )
    ).rows.map((row) => row.row as string);

  const keysOf = async (run: Run, layoutId: string): Promise<string[]> =>
    (await nodesOf(run, layoutId)).map((row) => row.split("@")[0] as string);

  /** `from->to` through the two node-id joins, sorted. */
  const pipesOf = async (run: Run, layoutId: string): Promise<string[]> =>
    (
      await run(
        `SELECT f.key || '->' || t.key AS pipe FROM bms.mimic_layout_pipes p
           JOIN bms.mimic_layout_nodes f ON f.id = p.from_node_id
           JOIN bms.mimic_layout_nodes t ON t.id = p.to_node_id
          WHERE p.layout_id = $1`,
        [layoutId],
      )
    ).rows
      .map((row) => row.pipe as string)
      .sort();

  it("M1 renames the seeded layout's hyphen keys, and its pipes follow by node id", async () => {
    await inTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      expect(await keysOf(run, fx.seeded)).toEqual(["bus_a", "coupler", "grid_cb", "out_cb_a"]);
      expect(await pipesOf(run, fx.seeded)).toEqual(["bus_a->coupler", "bus_a->out_cb_a", "grid_cb->bus_a"]);
    });
  });

  it("M2 a second run updates nothing", async () => {
    await inTx(async (run, fx) => {
      await run(MIGRATION_SQL);
      const after = await nodesOf(run, fx.seeded);
      await run(MIGRATION_SQL);
      expect(await nodesOf(run, fx.seeded)).toEqual(after);
    });
  });

  it("M3 a seeded-slug layout whose keys are valid is not updated", async () => {
    await inTx(async (run, fx) => {
      const before = await nodesOf(run, fx.validKeys);
      await run(MIGRATION_SQL);
      expect(await nodesOf(run, fx.validKeys)).toEqual(before);
    });
  });

  it("M4 a layout under another slug keeps its hyphen keys", async () => {
    await inTx(async (run, fx) => {
      const before = await nodesOf(run, fx.otherSlug);
      await run(MIGRATION_SQL);
      expect(await nodesOf(run, fx.otherSlug)).toEqual(before);
    });
  });

  it("M5 a key whose underscore twin exists is kept, and the run does not throw", async () => {
    await inTx(async (run, fx) => {
      const before = await nodesOf(run, fx.collision);
      await run(MIGRATION_SQL);
      expect(await nodesOf(run, fx.collision)).toEqual(before);
    });
  });
});
