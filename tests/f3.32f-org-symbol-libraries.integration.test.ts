import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 1, 3 and 4 — what migration `0093` guarantees against a
 * real database (plan D4, unit U1). The static twin `tests/f3.32f-org-symbol-libraries.test.ts`
 * asserts the migration's text; this asserts what Postgres enforces.
 *
 * The `tests/f3.32e-mimic-symbol-libraries.integration.test.ts` lifecycle: superuser pool, one
 * held client, every case inside a transaction that is always rolled back — nothing commits.
 * Two fixture organizations A and B are written by the superuser inside that transaction; the
 * probes then run as `bms_tenant` under the tenant GUC, the role an administrator uploads as.
 * A case that plants a row as the superuser says so and `RESET ROLE`s first.
 *
 * Every refusal asserts the SQLSTATE and, where Postgres names one, the constraint.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.32f",
  label: "organization symbol library tests",
  because:
    "the three tenant tables' row security, the composite foreign keys, the kind CHECK and the " +
    "core-library CHECK are things only a migrated database enforces, so a green run without a " +
    "database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const SHA = "a".repeat(64);
const VIEW_BOX = "{0,0,24,24}";
const SHAPES = '[["path",{"d":"M0 0"}]]';

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};
type Fixture = { run: Run; a: string; b: string };

describe.skipIf(!has)("F3.32f — migration 0093 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.32f",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Switches the transaction to `bms_tenant` under `org`'s GUC. */
  const asTenant = async (run: Run, org: string): Promise<void> => {
    await run("SET LOCAL ROLE bms_tenant");
    await run(`SET LOCAL app.current_organization = '${org}'`);
  };

  /** Back to the superuser, for a plant the tenant could not write. */
  const asSuperuser = async (run: Run): Promise<void> => {
    await run("RESET ROLE");
  };

  /**
   * Runs `body` inside a transaction that is always rolled back: organizations A and B written by
   * the superuser, then `bms_tenant` under A's GUC.
   */
  const inTx = async (body: (f: Fixture) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = async (tag: string): Promise<string> =>
        (
          await run(`INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`, [
            `F332F${tag}${RUN}`.toUpperCase(),
            `F3.32f fixture ${tag} ${RUN}`,
          ])
        ).rows[0]?.id as string;
      const a = await org("A");
      const b = await org("B");
      await asTenant(run, a);
      await body({ run, a, b });
    } finally {
      await client.query("ROLLBACK");
    }
  };

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

  const INSERT_LIBRARY = `INSERT INTO bms.mimic_org_symbol_libraries (id, organization_id, code, label, style, licence)
     VALUES ($1, $2, $3, 'Plant', 'stroke', 'Proprietary')`;
  const INSERT_SYMBOL = `INSERT INTO bms.mimic_org_symbols
     (organization_id, library_id, key, label, group_code, view_box, shapes, source_filename, sha256)
     VALUES ($1, $2, $3, 'Inlet', 'general', $4::double precision[], $5::jsonb, 'inlet.svg', $6)`;
  const INSERT_LAYOUT = `INSERT INTO bms.mimic_layouts (id, organization_id, name, slug, canvas_w, canvas_h)
     VALUES ($1, $2, $3, $4, 120, 80)`;
  const INSERT_NODE = `INSERT INTO bms.mimic_layout_nodes
     (organization_id, layout_id, key, kind, symbol, org_symbol_key, label, role_code, tone, x, y, w, h)
     VALUES ($1, $2, $3, $4, $5, $6, 'Node', NULL, $7, 0, 0, 10, 10)`;

  /** Writes a library `plant` and its symbol `org.plant:inlet` for `org`, as the current role. */
  const seedLibrary = async (run: Run, org: string): Promise<{ library: string; key: string }> => {
    const library = randomUUID();
    const key = "org.plant:inlet";
    await run(INSERT_LIBRARY, [library, org, "plant"]);
    await run(INSERT_SYMBOL, [org, library, key, VIEW_BOX, SHAPES, SHA]);
    return { library, key };
  };

  /** Writes a layout for `org`, as the current role. */
  const seedLayout = async (run: Run, org: string): Promise<string> => {
    const layout = randomUUID();
    await run(INSERT_LAYOUT, [layout, org, `F3.32f ${RUN}`, `f332f-${RUN}-${layout.slice(0, 8)}`]);
    return layout;
  };

  it("as bms_tenant under A, a library and a symbol are written (default privileges reach the tenant)", async () => {
    await inTx(async ({ run, a }) => {
      expect((await run("SELECT current_user AS u")).rows[0]?.u).toBe("bms_tenant");
      const { library } = await seedLibrary(run, a);
      const back = await run(`SELECT key FROM bms.mimic_org_symbols WHERE library_id = $1`, [library]);
      expect(back.rows).toEqual([{ key: "org.plant:inlet" }]);
    });
  });

  for (const table of ["mimic_org_symbol_libraries", "mimic_org_symbols", "mimic_library_settings"] as const) {
    it(`under B, SELECT count(*) of bms.${table} is 0 while A reads its own row (policy USING)`, async () => {
      await inTx(async ({ run, a, b }) => {
        await seedLibrary(run, a);
        await run(`INSERT INTO bms.mimic_library_settings (organization_id, library_code, enabled) VALUES ($1, 'tabler', false)`, [
          a,
        ]);
        const count = async (): Promise<number> =>
          Number((await run(`SELECT count(*) AS n FROM bms.${table} WHERE organization_id = ANY($1::uuid[])`, [[a, b]])).rows[0]?.n);
        // Positive control: A sees the row it wrote, so B's 0 is the policy and not an empty table.
        expect(await count()).toBeGreaterThanOrEqual(1);
        await asTenant(run, b);
        expect(await count()).toBe(0);
      });
    });
  }

  it("under B, a library stamped organization_id = A is refused with 42501 (policy WITH CHECK)", async () => {
    await inTx(async ({ run, a, b }) => {
      await asTenant(run, b);
      const { code, message } = await probe(run, INSERT_LIBRARY, [randomUUID(), a, "plant"]);
      expect(code, message).toBe("42501");
      expect(message).toContain("row-level security policy");
      expect(message).toContain("mimic_org_symbol_libraries");
    });
  });

  it("under A, a symbol whose library_id is B's library is refused by the policy's library leg: 42501", async () => {
    await inTx(async ({ run, a, b }) => {
      await asSuperuser(run);
      const bLibrary = randomUUID();
      await run(INSERT_LIBRARY, [bLibrary, b, "other"]);
      await asTenant(run, a);
      const { code, message } = await probe(run, INSERT_SYMBOL, [a, bLibrary, "org.other:inlet", VIEW_BOX, SHAPES, SHA]);
      expect(code, message).toBe("42501");
      expect(message).toContain("row-level security policy");
      expect(message).toContain("mimic_org_symbols");
    });
  });

  /**
   * Row security binds the tenant before the foreign key can fire (the case above), so the key
   * itself is proved as the superuser, whom no policy binds: A's symbol naming B's library.
   */
  it("as the superuser, A's symbol whose library_id is B's library is refused with 23503, naming mimic_org_symbols_library_fkey", async () => {
    await inTx(async ({ run, a, b }) => {
      await asSuperuser(run);
      const bLibrary = randomUUID();
      await run(INSERT_LIBRARY, [bLibrary, b, "other"]);
      const { code, message } = await probe(run, INSERT_SYMBOL, [a, bLibrary, "org.other:inlet", VIEW_BOX, SHAPES, SHA]);
      expect(code, message).toBe("23503");
      expect(message).toContain("mimic_org_symbols_library_fkey");
    });
  });

  it("under A, a unit naming A's own org_symbol_key is written (positive control for the refusal below)", async () => {
    await inTx(async ({ run, a }) => {
      const { key } = await seedLibrary(run, a);
      const layout = await seedLayout(run, a);
      await run(INSERT_NODE, [a, layout, "u", "unit", null, key, null]);
      const back = await run(`SELECT org_symbol_key FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
      expect(back.rows).toEqual([{ org_symbol_key: key }]);
    });
  });

  /**
   * THE COMPOSITE-KEY PROOF for the security review (ADR 0086 decision 3). A foreign key check
   * does not apply row security, so a single-column key on `org_symbol_key` would let B's unit
   * name A's symbol by its key. The organization is in the key, so B's unit finds no
   * `(B, org.plant:inlet)` row and Postgres refuses it — the key, not the policy, stops it.
   */
  it("a unit under B naming A's org_symbol_key is refused with 23503, naming mimic_layout_nodes_org_symbol_fkey", async () => {
    await inTx(async ({ run, a, b }) => {
      const { key } = await seedLibrary(run, a);
      await asTenant(run, b);
      const layout = await seedLayout(run, b);
      const { code, message } = await probe(run, INSERT_NODE, [b, layout, "u", "unit", null, key, null]);
      expect(code, message).toBe("23503");
      expect(message).toContain("mimic_layout_nodes_org_symbol_fkey");
    });
  });

  it("a unit with both symbol 'tank' and an org_symbol_key is refused with 23514, naming mimic_layout_nodes_kind_fields_check", async () => {
    await inTx(async ({ run, a }) => {
      const { key } = await seedLibrary(run, a);
      const layout = await seedLayout(run, a);
      const { code, message } = await probe(run, INSERT_NODE, [a, layout, "u", "unit", "tank", key, null]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_layout_nodes_kind_fields_check");
    });
  });

  it("a unit with neither symbol nor org_symbol_key is refused with 23514, naming mimic_layout_nodes_kind_fields_check", async () => {
    await inTx(async ({ run, a }) => {
      const layout = await seedLayout(run, a);
      const { code, message } = await probe(run, INSERT_NODE, [a, layout, "u", "unit", null, null, null]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_layout_nodes_kind_fields_check");
    });
  });

  it("a panel with tone 'info' and no org_symbol_key is written (positive control for the refusal below)", async () => {
    await inTx(async ({ run, a }) => {
      const layout = await seedLayout(run, a);
      await run(INSERT_NODE, [a, layout, "p", "panel", null, null, "info"]);
      const back = await run(`SELECT kind FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
      expect(back.rows).toEqual([{ kind: "panel" }]);
    });
  });

  it("a panel with tone 'info' and an org_symbol_key is refused with 23514, naming mimic_layout_nodes_kind_fields_check", async () => {
    await inTx(async ({ run, a }) => {
      const { key } = await seedLibrary(run, a);
      const layout = await seedLayout(run, a);
      const { code, message } = await probe(run, INSERT_NODE, [a, layout, "p", "panel", null, key, "info"]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_layout_nodes_kind_fields_check");
    });
  });

  it("a setting (A, 'core', false) is refused with 23514, naming mimic_library_settings_core_check", async () => {
    await inTx(async ({ run, a }) => {
      const { code, message } = await probe(
        run,
        `INSERT INTO bms.mimic_library_settings (organization_id, library_code, enabled) VALUES ($1, 'core', false)`,
        [a],
      );
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_library_settings_core_check");
    });
  });

  it("a setting (A, 'tabler', false) is written", async () => {
    await inTx(async ({ run, a }) => {
      await run(`INSERT INTO bms.mimic_library_settings (organization_id, library_code, enabled) VALUES ($1, 'tabler', false)`, [a]);
      const back = await run(`SELECT library_code, enabled FROM bms.mimic_library_settings WHERE organization_id = $1`, [a]);
      expect(back.rows).toEqual([{ library_code: "tabler", enabled: false }]);
    });
  });

  it("a second symbol with the same (organization_id, key) is refused with 23505, naming mimic_org_symbols_organization_key_key", async () => {
    await inTx(async ({ run, a }) => {
      const { library, key } = await seedLibrary(run, a);
      const { code, message } = await probe(run, INSERT_SYMBOL, [a, library, key, VIEW_BOX, SHAPES, SHA]);
      expect(code, message).toBe("23505");
      expect(message).toContain("mimic_org_symbols_organization_key_key");
    });
  });

  it("deleting a symbol no unit names succeeds (positive control for the refusal below)", async () => {
    await inTx(async ({ run, a }) => {
      const { key } = await seedLibrary(run, a);
      const { code, message } = await probe(run, `DELETE FROM bms.mimic_org_symbols WHERE organization_id = $1 AND key = $2`, [
        a,
        key,
      ]);
      expect(message, `delete of unused '${key}' (code ${code})`).toBe("");
    });
  });

  it("deleting a symbol a unit names is refused with 23503, naming mimic_layout_nodes_org_symbol_fkey", async () => {
    await inTx(async ({ run, a }) => {
      const { key } = await seedLibrary(run, a);
      const layout = await seedLayout(run, a);
      await run(INSERT_NODE, [a, layout, "u", "unit", null, key, null]);
      const { code, message } = await probe(run, `DELETE FROM bms.mimic_org_symbols WHERE organization_id = $1 AND key = $2`, [
        a,
        key,
      ]);
      expect(code, message).toBe("23503");
      expect(message).toContain("mimic_layout_nodes_org_symbol_fkey");
    });
  });

  it("a symbol whose view_box holds three numbers is refused with 23514, naming mimic_org_symbols_view_box_check", async () => {
    await inTx(async ({ run, a }) => {
      const library = randomUUID();
      await run(INSERT_LIBRARY, [library, a, "plant"]);
      const { code, message } = await probe(run, INSERT_SYMBOL, [a, library, "org.plant:inlet", "{0,0,24}", SHAPES, SHA]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_org_symbols_view_box_check");
    });
  });

  it("a symbol whose shapes is a JSON object is refused with 23514, naming mimic_org_symbols_shapes_check", async () => {
    await inTx(async ({ run, a }) => {
      const library = randomUUID();
      await run(INSERT_LIBRARY, [library, a, "plant"]);
      const { code, message } = await probe(run, INSERT_SYMBOL, [
        a,
        library,
        "org.plant:inlet",
        VIEW_BOX,
        '{"path":{"d":"M0 0"}}',
        SHA,
      ]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_org_symbols_shapes_check");
    });
  });
});
