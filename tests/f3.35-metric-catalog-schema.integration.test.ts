import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.35` Stage C — what migration `0054_dashboard_widget_sources.sql` guarantees, against a
 * real database.
 *
 * **In `tests/`, not `packages/db`, and that is load-bearing.** `vitest.config.ts` lists
 * `apps/api`, `apps/web`, `apps/ingest`, `packages/shared` and the root `repo` project;
 * `packages/db` is in **none** of them, so a `packages/db/src/*.integration.spec.ts` would never
 * run and `tests/repo-invariants.test.ts` would not catch it — it fails a `.spec` with no
 * wrapper, not a wrapper nothing collects. `tests/f3.1a-dashboard-schema.integration.test.ts`
 * and `tests/f3.8-notification-schema.integration.test.ts` record the same fact and are the
 * shape followed here.
 *
 * The sibling `tests/f3.35-metric-catalog-schema.test.ts` asserts the migration's *text*. This
 * asserts what Postgres actually enforces, which no source scan can reach: a `CHECK` that is
 * written but never applied, a `jsonb_typeof` predicate that parses differently than it reads,
 * a `varchar` too narrow for its own vocabulary, and a policy whose subquery names a column
 * that does not exist all look identical in the file.
 *
 * **Why this file exists at all, when the static half is already green.** `F3.1a`'s High
 * finding — a foreign key never consults its parent's policy, so a correctly-stamped row could
 * bind another tenant's parent — was proved on the running stack and could not have been
 * reasoned out of the migration text. This table has the same shape and one org-bearing parent,
 * so it inherits the same exposure. A green local suite says nothing about it.
 *
 * ---
 *
 * **Isolation.** Everything happens inside one transaction that is rolled back, so no row is
 * ever visible to another connection. The four recorded traps are settled the same way
 * `F3.1a`'s file settles them: this suite never reads `bms.assets` (it needs no point at all);
 * `bms.organizations` is read `ORDER BY code`, the one documented-safe unordered read; every
 * slug carries a per-run `randomUUID()` suffix; and no assertion counts over a whole table.
 *
 * **The pool is the superuser URL**, because the suite has to change role to prove the
 * boundary: `bms_owner` holds neither `BYPASSRLS` nor membership in `bms_tenant`, so
 * `SET LOCAL ROLE bms_tenant` from `DATABASE_URL` fails.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.35",
  label: "metric catalog source table tests",
  because:
    "the catalog_key CHECK, the params jsonb_typeof floor, the (widget_id, catalog_key) unique " +
    "key, the widget cascade, the pool-role grants and FORCE RLS with its parent-org EXISTS " +
    "are all things Postgres enforces, so a green run without a database asserts nothing " +
    "about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

/**
 * The five keys `metricCatalogKeySchema` declares, restated rather than parsed.
 *
 * The sibling static test already gates CHECK-against-enum drift by parsing both; repeating
 * that parse here would make this file red for a reason it does not own. What this list is for
 * is the live half — every key the vocabulary claims must actually survive an `INSERT`, which
 * catches a `varchar` too narrow or a `CHECK` that never applied.
 */
const CATALOG_KEYS = [
  "alarms.active.count",
  "alarms.active",
  "workorders.open.count",
  "workorders.open",
  "assets.health.score",
] as const;

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  release: () => void;
};

describe.skipIf(!has)("F3.35 Stage C — bms.dashboard_widget_sources against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.35",
    );
    // A HELD CLIENT, never `pool.query`: `SET LOCAL ROLE`, `SET LOCAL app.current_organization`
    // and the transaction are all connection-scoped, and `pg-pool` DESTROYS a client whose query
    // errors rather than returning it — so a `max: 1` pool loses the open transaction on the
    // first refusal this suite is built to provoke. `F3.1a`'s docblock records the symptom.
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query<{ id: string }>(
      // ORDER BY code, never a bare LIMIT — F4.53.
      `SELECT id FROM bms.organizations ORDER BY code`,
    );
    if (orgs.rows.length < 2) {
      throw new Error(
        "F3.35: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.",
      );
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Runs `body` inside a rolled-back transaction, as `bms_owner` with org A's tenant GUC set. */
  const inTx = async (
    body: (
      run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    ) => Promise<void>,
  ): Promise<void> => {
    await client.query("BEGIN");
    try {
      // `bms_owner` rather than `bms_tenant`: FORCE binds the owner too, so the rows are still
      // tenant-scoped, and the owner can build the fixture chain without every intermediate
      // grant. The role is switched explicitly where a case is *about* the pool roles.
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** Creates dashboard → `value_tile` widget in the organization whose GUC is currently set. */
  const seedWidget = async (
    run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    org: string,
    tag: string,
  ): Promise<string> => {
    const dash = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [org, `f335-${tag}-${RUN}`, `F3.35 ${tag} ${RUN}`],
    );
    // `value_tile` because that is the type Unit 1 gave a source cardinality of `{0,1}`.
    // Deliberately NOT `table` — the fifth type ships in Stage B, and an insert of it here would
    // be red against the very CHECK migration 0054 must not widen.
    const widget = await run(
      `INSERT INTO bms.dashboard_widgets
         (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
       VALUES ($1, $2, 'value_tile', 0, 0, 3, 3) RETURNING id`,
      [org, dash.rows[0]?.id],
    );
    return widget.rows[0]?.id as string;
  };

  const refuses = async (
    run: (sql: string, params?: unknown[]) => Promise<unknown>,
    sql: string,
    params: unknown[],
    constraint: string,
  ): Promise<void> => {
    // A SAVEPOINT, because a failed statement aborts the whole transaction and every later case
    // in the same `inTx` would then report "current transaction is aborted" — which is how a
    // real refusal and a broken suite become indistinguishable.
    await run("SAVEPOINT probe");
    let message = "";
    try {
      await run(sql, params);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(message, `expected a refusal naming ${constraint}`).toContain(constraint);
  };

  it("accepts every key the shared vocabulary declares, and refuses one it does not", async () => {
    await inTx(async (run) => {
      const widgetId = await seedWidget(run, orgA, "keys");

      // Every key, not a sample. A `varchar(64)` too narrow or a CHECK that silently never
      // applied would show up on exactly one of them, and the picker offers all five.
      for (const key of CATALOG_KEYS) {
        const ok = await run(
          `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
           VALUES ($1, $2, $3) RETURNING id`,
          [orgA, widgetId, key],
        );
        expect(ok.rows.length, `${key} must be accepted`).toBe(1);
      }

      // The whole point of ADR 0048 decision 1: an entry with no SQL query behind it cannot
      // reach the database, so it cannot become a tile that resolves to nothing in front of an
      // operator with a green console.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'energy.consumption.total')`,
        [orgA, widgetId],
        "dashboard_widget_sources_catalog_key_check",
      );

      // The prefix case, asserted because the static test's own gate had to be written around
      // it: `alarms.active` is a prefix of `alarms.active.count`, and a CHECK holding only the
      // longer key would still accept... nothing shorter. Proving the short one lands is what
      // separates a correct IN list from one that reads right.
      const short = await run(
        `SELECT count(*)::int AS n FROM bms.dashboard_widget_sources
         WHERE widget_id = $1 AND catalog_key = 'alarms.active'`,
        [widgetId],
      );
      expect(short.rows[0]?.n).toBe(1);
    });
  });

  it("floors params at a jsonb object and refuses a scalar or an array", async () => {
    await inTx(async (run) => {
      const widgetId = await seedWidget(run, orgA, "params");

      const ok = await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
         VALUES ($1, $2, 'alarms.active', '{"severity":"critical","limit":6}'::jsonb) RETURNING id`,
        [orgA, widgetId],
      );
      expect(ok.rows.length, "a record of scalars must be accepted").toBe(1);

      // The floor, and only the floor. A row the contract's
      // `z.record(z.union([string, number, boolean]))` could never read is refused at the
      // database rather than reaching the resolve endpoint's query builder.
      for (const bad of ["'[1,2]'::jsonb", `'"critical"'::jsonb`, "'7'::jsonb", "'null'::jsonb"]) {
        await refuses(
          run,
          `INSERT INTO bms.dashboard_widget_sources
             (organization_id, widget_id, catalog_key, params)
           VALUES ($1, $2, 'workorders.open', ${bad})`,
          [orgA, widgetId],
          "dashboard_widget_sources_params_object_check",
        );
      }

      // And what the floor does NOT catch, asserted so the limit is a recorded fact rather than
      // an assumption: a nested array as a VALUE passes here. The contract stays the authority
      // on the shape.
      const nested = await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
         VALUES ($1, $2, 'workorders.open', '{"severity":["a","b"]}'::jsonb) RETURNING id`,
        [orgA, widgetId],
      );
      expect(nested.rows.length, "the check is a floor, not the contract").toBe(1);
    });
  });

  it("keys one binding per (widget, catalog key) and not one per widget", async () => {
    await inTx(async (run) => {
      const widgetId = await seedWidget(run, orgA, "unique");

      await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'alarms.active.count')`,
        [orgA, widgetId],
      );

      // The one duplicate that is meaningless under any cardinality.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'alarms.active.count')`,
        [orgA, widgetId],
        "dashboard_widget_sources_widget_key_key",
      );

      // AND THE OTHER DIRECTION, which is the actual decision: a SECOND key on the same widget
      // is accepted by the database. `WIDGET_SOURCE_CARDINALITY` maxes at 1 today and the API
      // enforces that on write; a `UNIQUE (widget_id)` here would have frozen it, turning a
      // one-line change to that shared record into a forward migration. If this assertion ever
      // goes red, someone tightened the key — read the migration header before "fixing" it.
      const second = await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'workorders.open.count') RETURNING id`,
        [orgA, widgetId],
      );
      expect(second.rows.length, "cardinality is the API's, not the unique key's").toBe(1);
    });
  });

  it("cascades away with its widget, and the dashboard outlives neither less", async () => {
    await inTx(async (run) => {
      const widgetId = await seedWidget(run, orgA, "cascade");
      await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'assets.health.score')`,
        [orgA, widgetId],
      );

      await run(`DELETE FROM bms.dashboard_widgets WHERE id = $1`, [widgetId]);

      const left = await run(
        `SELECT count(*)::int AS n FROM bms.dashboard_widget_sources WHERE widget_id = $1`,
        [widgetId],
      );
      expect(left.rows[0]?.n, "the binding must cascade away with its widget").toBe(0);
    });
  });

  it("refuses a source bound to another tenant's widget", async () => {
    await inTx(async (run) => {
      const mine = await seedWidget(run, orgA, "own");

      // THE `F3.1a` HIGH FINDING, one table over. Postgres runs a referential-integrity check
      // with row security OFF, so the foreign key never consults `bms.dashboard_widgets`' own
      // policy: without the parent-org EXISTS in WITH CHECK, an org-A-stamped row pointing at
      // an org-B widget returns `INSERT 0 1`.
      await run(`SET LOCAL app.current_organization = '${orgB}'`);
      const theirs = await seedWidget(run, orgB, "foreign");
      await run(`SET LOCAL app.current_organization = '${orgA}'`);

      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'alarms.active.count')`,
        [orgA, theirs],
        "row-level security policy",
      );

      // A nonexistent widget is refused by the POLICY rather than by the key, because WITH
      // CHECK runs before the foreign key's AFTER trigger. The key is unchanged and still
      // enforced; the policy simply gets there first.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'alarms.active.count')`,
        [orgA, randomUUID()],
        "row-level security policy",
      );

      // Both directions. A policy that refused everything would pass every case above.
      const ok = await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'alarms.active.count') RETURNING id`,
        [orgA, mine],
      );
      expect(ok.rows.length, "a correctly-stamped write must succeed").toBe(1);

      // And a correctly-parented row stamped with the WRONG organization is refused by the
      // own-column half. The two halves fail independently and both are asserted.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'workorders.open.count')`,
        [orgB, mine],
        "row-level security policy",
      );
    });
  });

  it("isolates tenants, and FORCE binds the owner", async () => {
    await inTx(async (run) => {
      const widgetId = await seedWidget(run, orgA, "iso");
      await run(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, 'alarms.active')`,
        [orgA, widgetId],
      );

      const seen = await run(
        `SELECT count(*)::int AS n FROM bms.dashboard_widget_sources WHERE widget_id = $1`,
        [widgetId],
      );
      expect(seen.rows[0]?.n, "org A must see its own row").toBe(1);

      // The table must hold a row BEFORE the GUC is blanked, or this returns 0 whether FORCE is
      // set or not and proves nothing. ENABLE alone exempts the owner; FORCE is the half that
      // binds it, and this is the check that would have caught F4.16's no-op FORCE.
      await run(`SET LOCAL app.current_organization = ''`);
      const blind = await run(
        `SELECT count(*)::int AS n FROM bms.dashboard_widget_sources WHERE widget_id = $1`,
        [widgetId],
      );
      expect(blind.rows[0]?.n, "the row must be invisible with no tenant GUC").toBe(0);
    });
  });

  it("reaches the pool roles, which proves 0041's default privileges fired", async () => {
    // The one failure the SET ROLE bracket exists to prevent, and the one that would otherwise
    // surface inside Unit 5's resolve service one endpoint at a time: a table owned by bms_app
    // gets no default privileges, so no pool role can read it and nothing in the migration
    // looks wrong.
    for (const role of ["bms_tenant", "bms_fleet"]) {
      const granted = await pool.query<{ ok: boolean }>(
        `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`,
        [role, "bms.dashboard_widget_sources"],
      );
      expect(granted.rows[0]?.ok, `${role} must reach bms.dashboard_widget_sources`).toBe(true);
    }

    // `relnamespace` is filtered, not assumed. `pg_class.relname` is unique per SCHEMA, not
    // per database, so a same-named table anywhere else makes `rows[0]` a coin toss and this
    // assertion nondeterministic — flagged by this item's migration review.
    const owner = await pool.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
       WHERE relname = $1 AND relnamespace = 'bms'::regnamespace`,
      ["dashboard_widget_sources"],
    );
    expect(owner.rows[0]?.owner, "the SET ROLE bracket must have owned the table").toBe("bms_owner");
  });

  /**
   * **This assertion was inverted by `F3.35` Stage B, and the inversion is the point.**
   *
   * It read "leaves the widget vocabulary at four types — `table` is Stage B's", and proved the
   * DATABASE still refused `'table'` after migration `0054`. That was correct while Stage C
   * stood alone: `0054` deliberately did not widen `dashboard_widgets_widget_type_check`,
   * because a `widget_type` the database accepts and no component draws is ADR 0047 decision
   * 2's whole justification arriving through the door the constraint holds shut.
   *
   * Stage B shipped that component, and migration `0055` widened the constraint. So the
   * behaviour under test is now the opposite one — and it is still worth asserting behaviourally
   * rather than deleting, for the reason the original gave: a widened CHECK and an unwidened one
   * are indistinguishable from any insert of the types that already rendered. Only an insert of
   * `'table'` tells them apart, and only against a real database.
   *
   * `tests/f3.35-table-widget-schema.test.ts` is the static half — it holds `0055`'s IN list
   * equal to `widgetTypeSchema`. This is the half that proves the migration actually RAN.
   */
  it("accepts `table` now that Stage B's 0055 widened the vocabulary", async () => {
    await inTx(async (run) => {
      const dash = await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name)
         VALUES ($1, $2, 'vocab') RETURNING id`,
        [orgA, `f335-vocab-${RUN}`],
      );

      const inserted = await run(
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'table', 0, 0, 3, 3) RETURNING widget_type`,
        [orgA, dash.rows[0]?.id],
      );
      expect(
        inserted.rows[0]?.widget_type,
        "0055 must have run — an unwidened CHECK refuses this insert",
      ).toBe("table");

      // The other half, and it is not symmetry: a constraint DROPPED rather than widened would
      // pass the assertion above and accept anything at all. `0055` replaces a four-value list
      // with a five-value one, so an unlisted type must still be refused.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'donut', 0, 0, 3, 3)`,
        [orgA, dash.rows[0]?.id],
        "dashboard_widgets_widget_type_check",
      );
    });
  });
});
