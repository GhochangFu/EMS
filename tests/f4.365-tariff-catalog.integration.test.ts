import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { upsertTariffCatalog } from "../packages/db/dist/tariff-catalog-seed.js";
import { tariffCatalogSnapshotSchema } from "../packages/shared/src/contracts/tariffs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.365` / ADR 0134 decision 2 — `db:seed` loads the committed snapshot, and
 * `upsertTariffCatalog` inserts, replaces slabs, and writes nothing when the
 * snapshot is unchanged. Every fixture case rolls back.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.365",
  label: "tariff catalog seed tests",
  because: "the upsert's insert, slab replacement and no-op-when-unchanged are database behaviour.",
  connection: "superuser",
});

const has = connectionString !== undefined && connectionString !== "";
const RUN = randomUUID().slice(0, 8);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const committed = tariffCatalogSnapshotSchema.parse(
  JSON.parse(readFileSync(join(repoRoot, "packages", "db", "src", "tariff-catalog.json"), "utf8")),
);

type Client = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release: () => void;
};

/** The upsert's own parameter type, from `dist` — the source-side zod type differs under this tsconfig. */
type Snapshot = Parameters<typeof upsertTariffCatalog>[1];

const fixture = (slabCount: number): Snapshot => {
  const base = committed.categories.find((c) => c.slabs.length >= 2)!;
  const make = (suffix: string) => ({
    ...base,
    key: `F4365-FIXTURE | ${RUN} | ${suffix}`,
    slabs: base.slabs.slice(0, slabCount).map((s, i, all) => (i === all.length - 1 ? { ...s, toUnits: null } : s)),
  });
  return { source: committed.source, categories: [make("one"), make("two")] } as Snapshot;
};

describe.skipIf(!has)("F4.365 — the tariff catalog in the database", () => {
  let pool: Awaited<ReturnType<typeof openIntegrationPool>>;
  let client: Client;

  beforeAll(async () => {
    pool = await openIntegrationPool(resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), "F4.365");
    client = (await pool.connect()) as unknown as Client;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  it("db:seed loaded the committed snapshot", async () => {
    const keys = committed.categories.map((c) => c.key);
    const cats = await client.query(`SELECT count(*)::int AS n FROM bms.tariff_categories WHERE key = ANY($1::varchar[])`, [keys]);
    const slabs = await client.query(
      `SELECT count(*)::int AS n FROM bms.tariff_slabs s JOIN bms.tariff_categories c ON c.id = s.category_id WHERE c.key = ANY($1::varchar[])`,
      [keys],
    );
    expect(cats.rows[0]?.n).toBe(committed.categories.length);
    expect(slabs.rows[0]?.n).toBe(committed.categories.reduce((n, c) => n + c.slabs.length, 0));
  });

  it("upserts, replaces a removed slab, and writes nothing on an unchanged run", async () => {
    await client.query("BEGIN");
    try {
      const first = await upsertTariffCatalog(client, fixture(2));
      expect(first.categories).toBe(2);
      expect(first.slabs).toBe(4);
      const shrunk = await upsertTariffCatalog(client, fixture(1));
      expect(shrunk.categories, "the category rows themselves are unchanged").toBe(0);
      const left = await client.query(
        `SELECT count(*)::int AS n FROM bms.tariff_slabs s JOIN bms.tariff_categories c ON c.id = s.category_id WHERE c.key LIKE $1`,
        [`F4365-FIXTURE | ${RUN}%`],
      );
      expect(left.rows[0]?.n, "each category keeps one slab").toBe(2);

      // Inside one transaction `now()` is frozen, so an `updated_at` stamp cannot show a write.
      // A row's `ctid` can: any UPDATE (a no-op one too) or delete-and-reinsert writes a new tuple
      // at a new physical address, so unchanged addresses mean the unchanged run wrote nothing.
      const tuples = async () =>
        (
          await client.query(
            `SELECT c.ctid::text || '/' || coalesce(string_agg(s.ctid::text, ',' ORDER BY s.slab_no), '') AS t
               FROM bms.tariff_categories c LEFT JOIN bms.tariff_slabs s ON s.category_id = c.id
              WHERE c.key LIKE $1 GROUP BY c.id, c.ctid ORDER BY c.key`,
            [`F4365-FIXTURE | ${RUN}%`],
          )
        ).rows.map((r: { t: string }) => r.t);
      const before = await tuples();
      expect(before).toHaveLength(2);

      const again = await upsertTariffCatalog(client, fixture(1));
      expect(again).toEqual({ categories: 0, slabs: 0 });
      expect(await tuples(), "no row was rewritten").toEqual(before);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
