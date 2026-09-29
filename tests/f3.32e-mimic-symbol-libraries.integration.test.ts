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
 * `F3.32e` / ADR 0084 decisions 1, 3 and 8 — what migration `0090` guarantees against a real
 * database (plan U1). The static twin `tests/f3.32e-mimic-symbol-libraries.test.ts` asserts the
 * migration's text; this asserts what Postgres enforces.
 *
 * The `tests/f3.32d-mimic-domain-symbols-and-roles.integration.test.ts` lifecycle: superuser
 * pool, one held client, every case inside a transaction that is always rolled back — nothing
 * commits. The fixture organization is written by the superuser inside that transaction; the
 * probes then run as `bms_tenant` under the tenant GUC, the role the API writes layouts as.
 * A case about a superuser or `bms_fleet` action says so and `RESET ROLE`s first.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.32e",
  label: "mimic symbol libraries tests",
  because:
    "the symbol foreign key, the symbol_libraries CHECK, the bms_tenant REVOKE and the 438 " +
    "library rows are things only a migrated database holds or enforces, so a green run " +
    "without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** The 29 core keys, read from `mimicCoreSymbolSchema`'s source text (never `@bms/shared`,
 * which resolves to `dist`). */
const CORE_KEYS: string[] = (() => {
  const source = readFileSync(join(repoRoot, "packages/shared/src/contracts/mimic-layouts.ts"), "utf8");
  const start = source.indexOf("export const mimicCoreSymbolSchema = z.enum([");
  if (start < 0) throw new Error("no mimicCoreSymbolSchema");
  return [...source.slice(start, source.indexOf("]);", start)).matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1] as string);
})();

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.32e — migration 0090 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.32e",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /**
   * Runs `body` inside a transaction that is always rolled back: a fixture organization and
   * layout, then `bms_tenant` under that organization's GUC.
   */
  const inTx = async (body: (run: Run, org: string, layout: string) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = (
        await run(`INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`, [
          `F332E${RUN}`.toUpperCase(),
          `F3.32e fixture ${RUN}`,
        ])
      ).rows[0]?.id as string;
      await run("SET LOCAL ROLE bms_tenant");
      await run(`SET LOCAL app.current_organization = '${org}'`);
      const layout = (
        await run(
          `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
           VALUES ($1, $2, $3, 120, 80) RETURNING id`,
          [org, `F3.32e ${RUN}`, `f332e-${RUN}`],
        )
      ).rows[0]?.id as string;
      await body(run, org, layout);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const INSERT_UNIT = `INSERT INTO bms.mimic_layout_nodes
     (organization_id, layout_id, key, kind, symbol, label, role_code, x, y, w, h)
     VALUES ($1, $2, $3, 'unit', $4, $5, NULL, 0, 0, 10, 10)`;

  /** Runs `sql` under a SAVEPOINT and returns the error it raised (empty if none). Probed without
   * `RETURNING`, which can report an RLS refusal for a write that succeeded. */
  const probe = async (run: Run, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    try {
      await run(sql, params);
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message };
  };

  // These reads name the four rows and filter on nothing else: a fifth library must not redden
  // them (the F4.157 rule), and a concurrent suite that deactivates a library for one committed
  // window must not either. 0090's DO block and the static twin hold "active".
  it("the tenant reads the four libraries, in sort order", async () => {
    await inTx(async (run) => {
      expect((await run("SELECT current_user AS u")).rows[0]?.u).toBe("bms_tenant");
      const rows = await run(`SELECT code FROM bms.mimic_symbol_libraries WHERE code = ANY($1::text[]) ORDER BY sort_order`, [
        ["core", "tabler", "lucide", "mdi"],
      ]);
      expect(rows.rows.map((r) => r.code)).toEqual(["core", "tabler", "lucide", "mdi"]);
    });
  });

  it("the tenant reads the 29 core symbols in mimicCoreSymbolSchema order", async () => {
    await inTx(async (run) => {
      expect(CORE_KEYS).toHaveLength(29);
      const rows = await run(
        `SELECT key FROM bms.mimic_symbols WHERE library_code = 'core' ORDER BY sort_order`,
      );
      expect(rows.rows.map((r) => r.key)).toEqual(CORE_KEYS);
    });
  });

  for (const symbol of ["tank", "tabler:bolt", "mdi:heat-pump"] as const) {
    it(`a unit with symbol '${symbol}' is written and reads back`, async () => {
      await inTx(async (run, org, layout) => {
        await run(INSERT_UNIT, [org, layout, "u", symbol, symbol]);
        const back = await run(`SELECT symbol FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
        expect(back.rows).toEqual([{ symbol }]);
      });
    });
  }

  it("a unit with symbol 'panel' is refused with 23503, naming mimic_layout_nodes_symbol_fkey", async () => {
    await inTx(async (run, org, layout) => {
      const { code, message } = await probe(run, INSERT_UNIT, [org, layout, "u", "panel", "Panel"]);
      expect(code, message).toBe("23503");
      expect(message).toContain("mimic_layout_nodes_symbol_fkey");
    });
  });

  it("pg_constraint holds mimic_layout_nodes_symbol_fkey as a foreign key (positive control)", async () => {
    const rows = await client.query(
      `SELECT contype FROM pg_constraint
        WHERE conrelid = 'bms.mimic_layout_nodes'::regclass AND conname = 'mimic_layout_nodes_symbol_fkey'`,
    );
    expect(rows.rows).toEqual([{ contype: "f" }]);
  });

  it("pg_constraint holds no mimic_layout_nodes_symbol_check", async () => {
    const rows = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'bms.mimic_layout_nodes'::regclass AND conname = 'mimic_layout_nodes_symbol_check'`,
    );
    expect(rows.rows).toEqual([]);
  });

  it("bms.mimic_layout_nodes.symbol is varchar(64)", async () => {
    const rows = await client.query(
      `SELECT data_type, character_maximum_length AS len FROM information_schema.columns
        WHERE table_schema = 'bms' AND table_name = 'mimic_layout_nodes' AND column_name = 'symbol'`,
    );
    expect(rows.rows).toEqual([{ data_type: "character varying", len: 64 }]);
  });

  it("a new layout reads symbol_libraries = {core}", async () => {
    await inTx(async (run, _org, layout) => {
      const rows = await run(`SELECT symbol_libraries::text[] AS libs FROM bms.mimic_layouts WHERE id = $1`, [layout]);
      expect(rows.rows).toEqual([{ libs: ["core"] }]);
    });
  });

  it("symbol_libraries = '{core,mdi}' is accepted (positive control for the refusal below)", async () => {
    await inTx(async (run, _org, layout) => {
      await run(`UPDATE bms.mimic_layouts SET symbol_libraries = '{core,mdi}' WHERE id = $1`, [layout]);
      const rows = await run(`SELECT symbol_libraries::text[] AS libs FROM bms.mimic_layouts WHERE id = $1`, [layout]);
      expect(rows.rows).toEqual([{ libs: ["core", "mdi"] }]);
    });
  });

  it("symbol_libraries = '{}' is refused with 23514, naming mimic_layouts_symbol_libraries_check", async () => {
    await inTx(async (run, _org, layout) => {
      const { code, message } = await probe(run, `UPDATE bms.mimic_layouts SET symbol_libraries = '{}' WHERE id = $1`, [
        layout,
      ]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_layouts_symbol_libraries_check");
    });
  });

  it("the superuser can delete a symbol no node uses (positive control for the refusal below)", async () => {
    await inTx(async (run) => {
      await run("RESET ROLE");
      const unused = (
        await run(
          `SELECT key FROM bms.mimic_symbols s
            WHERE library_code = 'lucide'
              AND NOT EXISTS (SELECT 1 FROM bms.mimic_layout_nodes n WHERE n.symbol = s.key)
            ORDER BY sort_order LIMIT 1`,
        )
      ).rows[0]?.key as string;
      expect(unused).toMatch(/^lucide:/);
      const { code, message } = await probe(run, `DELETE FROM bms.mimic_symbols WHERE key = $1`, [unused]);
      expect(message, `delete of unused '${unused}' (code ${code})`).toBe("");
    });
  });

  it("deleting a symbol a node uses is refused with 23503, naming mimic_layout_nodes_symbol_fkey", async () => {
    await inTx(async (run, org, layout) => {
      await run(INSERT_UNIT, [org, layout, "u", "mdi:heat-pump", "Heat pump"]);
      await run("RESET ROLE");
      const { code, message } = await probe(run, `DELETE FROM bms.mimic_symbols WHERE key = 'mdi:heat-pump'`);
      expect(code, message).toBe("23503");
      expect(message).toContain("mimic_layout_nodes_symbol_fkey");
    });
  });

  it("the tenant can SELECT a symbol's label (positive control for the refusal below)", async () => {
    await inTx(async (run) => {
      const rows = await run(`SELECT label FROM bms.mimic_symbols WHERE key = 'tank'`);
      expect(rows.rows).toEqual([{ label: "Tank" }]);
    });
  });

  it("the tenant's UPDATE of bms.mimic_symbols is refused: permission denied, 42501", async () => {
    await inTx(async (run) => {
      const { code, message } = await probe(run, `UPDATE bms.mimic_symbols SET label = 'x' WHERE key = 'tank'`);
      expect(code, message).toBe("42501");
      expect(message).toContain("permission denied for table mimic_symbols");
    });
  });

  for (const table of ["bms.mimic_symbol_libraries", "bms.mimic_symbols"] as const) {
    it(`bms_tenant holds SELECT on ${table} (positive control for the absences below)`, async () => {
      const rows = await client.query(`SELECT has_table_privilege('bms_tenant', $1, 'SELECT') AS ok`, [table]);
      expect(rows.rows[0]?.ok).toBe(true);
    });

    for (const verb of ["INSERT", "UPDATE", "DELETE"] as const) {
      it(`bms_tenant holds no ${verb} on ${table}`, async () => {
        const rows = await client.query(`SELECT has_table_privilege('bms_tenant', $1, $2) AS ok`, [table, verb]);
        expect(rows.rows[0]?.ok).toBe(false);
      });
    }

    it(`bms_fleet still holds UPDATE on ${table}`, async () => {
      const rows = await client.query(`SELECT has_table_privilege('bms_fleet', $1, 'UPDATE') AS ok`, [table]);
      expect(rows.rows[0]?.ok).toBe(true);
    });
  }
});
