import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.1a` — what migration `0050_configurable_dashboard_tables.sql` guarantees, against a real
 * database.
 *
 * **In `tests/`, not `packages/db`, and that is load-bearing.** `vitest.config.ts` lists
 * `apps/api`, `apps/web`, `apps/ingest`, `packages/shared` and the root `repo` project;
 * `packages/db` is in **none** of them, so a `packages/db/src/*.integration.spec.ts` would
 * never run and `tests/repo-invariants.test.ts` would not catch it — it fails a `.spec` with no
 * wrapper, not a wrapper nothing collects. `tests/f3.8-notification-schema.integration.test.ts`
 * records the same fact and is the shape followed here. Not `apps/api` either: `F3.1b` owns
 * every service, so there is nothing there for this suite to construct.
 *
 * The sibling `tests/f3.1a-dashboard-schema.test.ts` asserts the migration's *text*. This
 * asserts what Postgres actually enforces, which no source scan can reach: a `CHECK` that is
 * written but never applied, a policy whose predicate parses differently than it reads, and a
 * grant that silently did not fire all look identical in the file.
 *
 * ---
 *
 * **Isolation.** Everything happens inside one transaction that is rolled back, so no row is
 * ever visible to another connection. That is the strongest property available and it settles
 * four recorded traps at once rather than defending against them one at a time:
 *
 *  - `F4.67` / `F4.68`: this suite **never reads `bms.assets`**, positionally or by pattern. It
 *    creates its own asset and point. Having no such read is stronger than having a careful
 *    one.
 *  - `F4.53`: no unordered `LIMIT`. `bms.organizations` is read `ORDER BY code`, the one
 *    documented-safe read — `apps/api/src/testing/integration-fixtures.ts:70-77` records that
 *    nothing under `apps/**`, `packages/**` or `tests/**` writes that table from a test.
 *  - `F4.65`: every code and slug carries a per-run `randomUUID()` suffix, so two instances of
 *    this file cannot collide even if the rollback were to fail.
 *  - `F4.66`: no assertion on a count over a whole table. Every assertion is over rows this
 *    suite created, addressed by id.
 *
 * **The pool is the superuser URL**, because the suite has to *change role* to prove the
 * boundary: `bms_owner` holds neither `BYPASSRLS` nor membership in `bms_tenant` (deliberately
 * — the gate's own docblock records it), so `SET LOCAL ROLE bms_tenant` from `DATABASE_URL`
 * fails. `SET LOCAL` confines both the role and the GUC to the transaction.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.1a",
  label: "dashboard schema tests",
  because:
    "the widget-type CHECK, the scope CHECK, the grid bounds, the org-scoped slug key, the " +
    "asset_points foreign key, the pool-role grants and FORCE RLS are all things Postgres " +
    "enforces, so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

/**
 * The pool type is derived from `openIntegrationPool` rather than imported from `pg`, which is
 * not a root dependency — a `pg` type import compiles here and fails `typecheck:tests`.
 *
 * **A HELD CLIENT IS REQUIRED, AND `pool.query` CANNOT SUBSTITUTE FOR ONE.** This suite runs
 * inside a transaction, and `SET LOCAL ROLE`, `SET LOCAL app.current_organization` and the
 * transaction itself are all connection-scoped. A `max: 1` pool was tried first, on the
 * reasoning that one connection must serialise every query. It does not survive a *deliberate*
 * failure: `pg-pool` DESTROYS the client when a query errors rather than returning it to the
 * idle pool, so the first refusal this suite is built to provoke takes the open transaction
 * with it, and the next statement lands on a fresh connection with no transaction at all. The
 * symptom is a cascade of `ROLLBACK TO SAVEPOINT can only be used in transaction blocks` that
 * names nothing about the real cause.
 *
 * `IntegrationClient` is written structurally rather than imported: `pool.connect()` cannot be
 * typed through `ReturnType`, because TypeScript resolves an overloaded method to its LAST
 * overload — pg's callback form, returning `void`. The cast is confined to one line and the
 * surface it describes is two methods, both used here.
 */
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  release: () => void;
};

describe.skipIf(!has)("F3.1a — dashboard schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.1a",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query<{ id: string }>(
      // ORDER BY code, never a bare LIMIT — F4.53.
      `SELECT id FROM bms.organizations ORDER BY code`,
    );
    if (orgs.rows.length < 2) {
      throw new Error(
        "F3.1a: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.",
      );
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /**
   * Runs `body` inside a rolled-back transaction, as `bms_owner` with org A's tenant GUC set.
   *
   * `bms_owner` rather than `bms_tenant` for the constraint cases: `FORCE` binds the owner too,
   * so the rows are still tenant-scoped, and the owner can create the fixture chain without
   * needing every intermediate grant. The role is switched explicitly where a case is *about*
   * the pool roles.
   */
  const inTx = async (
    body: (
      run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    ) => Promise<void>,
  ): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** Creates dashboard → widget, and (when asked) an asset + point to bind. */
  const seedFixture = async (
    run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    opts: { withPoint?: boolean } = {},
  ): Promise<{ dashboardId: string; widgetId: string; pointId?: string }> => {
    const dash = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgA, `f31a-${RUN}`, `F3.1a ${RUN}`],
    );
    const dashboardId = dash.rows[0]?.id as string;

    const widget = await run(
      `INSERT INTO bms.dashboard_widgets
         (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
       VALUES ($1, $2, 'radial_gauge', 0, 0, 3, 3) RETURNING id`,
      [orgA, dashboardId],
    );
    const widgetId = widget.rows[0]?.id as string;

    if (opts.withPoint !== true) return { dashboardId, widgetId };

    // Its OWN asset and point, never a read of bms.assets — F4.67/F4.68.
    const loc = await run(
      `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY code`,
      [orgA],
    );
    const locationId = loc.rows[0]?.id as string;
    const domain = await run(`SELECT code FROM bms.asset_domains ORDER BY code`);
    const asset = await run(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgA, locationId, `F31A-${RUN}`, `F3.1a ${RUN}`, "F3.1a", domain.rows[0]?.code],
    );
    const point = await run(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgA, asset.rows[0]?.id, `f31a_${RUN}`, `f31a_${RUN}`],
    );
    return { dashboardId, widgetId, pointId: point.rows[0]?.id as string };
  };

  const refuses = async (
    run: (sql: string, params?: unknown[]) => Promise<unknown>,
    sql: string,
    params: unknown[],
    constraint: string,
  ): Promise<void> => {
    // A SAVEPOINT, because a failed statement aborts the whole transaction and every later
    // case in the same `inTx` would then report "current transaction is aborted" — which is
    // how a real refusal and a broken suite become indistinguishable.
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

  it("closes the widget vocabulary to the four ADR 0047 types", async () => {
    await inTx(async (run) => {
      const { dashboardId } = await seedFixture(run);
      for (const type of ["radial_gauge", "tank_level", "value_tile", "chart"]) {
        const ok = await run(
          `INSERT INTO bms.dashboard_widgets
             (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
           VALUES ($1, $2, $3, 0, 0, 2, 2) RETURNING id`,
          [orgA, dashboardId, type],
        );
        expect(ok.rows.length, `${type} must be accepted`).toBe(1);
      }
      // The whole point of decision 2: a kind with no component cannot reach the database, so
      // it cannot become a blank rectangle in front of an operator.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'mimic', 0, 0, 2, 2)`,
        [orgA, dashboardId],
        "dashboard_widgets_widget_type_check",
      );
    });
  });

  it("permits one scope axis and refuses two", async () => {
    await inTx(async (run) => {
      const loc = await run(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY code`,
        [orgA],
      );
      const group = await run(
        `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY code`,
        [orgA],
      );
      const locationId = loc.rows[0]?.id;
      const groupId = group.rows[0]?.id;

      // Organization-wide: both NULL.
      expect(
        (
          await run(
            `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'wide') RETURNING id`,
            [orgA, `wide-${RUN}`],
          )
        ).rows.length,
      ).toBe(1);

      expect(
        (
          await run(
            `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
             VALUES ($1, $2, 'site', $3) RETURNING id`,
            [orgA, `site-${RUN}`, locationId],
          )
        ).rows.length,
      ).toBe(1);

      if (groupId !== undefined) {
        expect(
          (
            await run(
              `INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
               VALUES ($1, $2, 'area', $3) RETURNING id`,
              [orgA, `area-${RUN}`, groupId],
            )
          ).rows.length,
        ).toBe(1);

        // Both set can contradict each other, because asset_groups.location_id is already
        // NOT NULL — so the database refuses rather than leaving F3.1b to resolve it forever.
        await refuses(
          run,
          `INSERT INTO bms.dashboards (organization_id, slug, name, location_id, asset_group_id)
           VALUES ($1, $2, 'both', $3, $4)`,
          [orgA, `both-${RUN}`, locationId, groupId],
          "dashboards_scope_check",
        );
      }
    });
  });

  it("keys a slug per organization, not globally", async () => {
    await inTx(async (run) => {
      await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'A')`,
        [orgA, `shared-${RUN}`],
      );
      await refuses(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'A dupe')`,
        [orgA, `shared-${RUN}`],
        "dashboards_organization_slug_key",
      );

      // The `0048` property, and the reason locations.slug's global uniqueness was not copied:
      // the first tenant to create "overview" must not take the word from every other tenant.
      await run(`SET LOCAL app.current_organization = '${orgB}'`);
      const other = await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'B') RETURNING id`,
        [orgB, `shared-${RUN}`],
      );
      expect(other.rows.length, "the same slug in a second organization must be accepted").toBe(1);
    });
  });

  it("bounds a widget to the 12-column canvas", async () => {
    await inTx(async (run) => {
      const { dashboardId } = await seedFixture(run);
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'chart', 10, 0, 4, 3)`,
        [orgA, dashboardId],
        "dashboard_widgets_grid_bounds_check",
      );
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'chart', 0, 0, 0, 3)`,
        [orgA, dashboardId],
        "dashboard_widgets_grid_bounds_check",
      );
    });
  });

  it("binds points by foreign key, and a deleted point leaves the widget with none", async () => {
    await inTx(async (run) => {
      const { widgetId, pointId } = await seedFixture(run, { withPoint: true });

      await run(
        `INSERT INTO bms.dashboard_widget_points (organization_id, widget_id, point_id)
         VALUES ($1, $2, $3)`,
        [orgA, widgetId, pointId],
      );

      // An unknown point cannot be bound — the property a point id inside a jsonb blob could
      // never have (ADR 0047 decision 3).
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_points (organization_id, widget_id, point_id)
         VALUES ($1, $2, $3)`,
        [orgA, widgetId, randomUUID()],
        "dashboard_widget_points_point_id_fkey",
      );

      // The same point twice in the same role is a duplicate series, not a second binding.
      await refuses(
        run,
        `INSERT INTO bms.dashboard_widget_points (organization_id, widget_id, point_id)
         VALUES ($1, $2, $3)`,
        [orgA, widgetId, pointId],
        "dashboard_widget_points_widget_point_role_key",
      );

      await run(`DELETE FROM bms.asset_points WHERE id = $1`, [pointId]);

      const bindings = await run(
        `SELECT count(*)::int AS n FROM bms.dashboard_widget_points WHERE widget_id = $1`,
        [widgetId],
      );
      expect(bindings.rows[0]?.n, "the binding must cascade away").toBe(0);

      // And the widget SURVIVES with zero bindings. This is the state F3.1c must render as
      // "no data bound" rather than as a blank rectangle — recorded as a live fact here so the
      // note in the schema docblock is not the only place it exists.
      const widget = await run(`SELECT count(*)::int AS n FROM bms.dashboard_widgets WHERE id = $1`, [
        widgetId,
      ]);
      expect(widget.rows[0]?.n, "the widget must outlive its bindings").toBe(1);
    });
  });

  it("isolates tenants, and FORCE binds the owner", async () => {
    await inTx(async (run) => {
      await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'A')`,
        [orgA, `iso-${RUN}`],
      );
      await run(`SET LOCAL app.current_organization = '${orgB}'`);
      await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'B')`,
        [orgB, `iso-${RUN}`],
      );

      await run(`SET LOCAL app.current_organization = '${orgA}'`);
      const seenByA = await run(
        `SELECT count(*)::int AS n FROM bms.dashboards WHERE slug = $1`,
        [`iso-${RUN}`],
      );
      expect(seenByA.rows[0]?.n, "org A must see exactly its own row").toBe(1);

      // ENABLE alone exempts the owner; FORCE is the half that binds it. This is the check
      // that would have caught F4.16's no-op FORCE before ADR 0045.
      await run(`SET LOCAL app.current_organization = ''`);
      for (const table of ["dashboards", "dashboard_widgets", "dashboard_widget_points"]) {
        const blind = await run(`SELECT count(*)::int AS n FROM bms.${table}`);
        expect(blind.rows[0]?.n, `${table} must be invisible with no tenant GUC`).toBe(0);
      }
    });
  });

  it("refuses a cross-tenant write and accepts a correctly-stamped one", async () => {
    await inTx(async (run) => {
      // Both directions. That the boundary holds is half of it; that a correct write still
      // succeeds is the other half, and a policy that refused everything would pass the first.
      const ok = await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'A') RETURNING id`,
        [orgA, `stamp-${RUN}`],
      );
      expect(ok.rows.length, "a correctly-stamped write must succeed").toBe(1);

      await refuses(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'B')`,
        [orgB, `cross-${RUN}`],
        "row-level security policy",
      );
    });
  });

  it("reaches the pool roles, which proves 0041's default privileges fired", async () => {
    // The one failure the SET ROLE bracket exists to prevent, and the one that would otherwise
    // surface inside F3.1b one endpoint at a time: tables owned by bms_app get no default
    // privileges, so no pool role can read them and nothing in the migration looks wrong.
    for (const table of ["dashboards", "dashboard_widgets", "dashboard_widget_points"]) {
      for (const role of ["bms_tenant", "bms_fleet"]) {
        const granted = await pool.query<{ ok: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`,
          [role, `bms.${table}`],
        );
        expect(granted.rows[0]?.ok, `${role} must reach bms.${table}`).toBe(true);
      }
    }

    const owner = await pool.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'dashboards'`,
    );
    expect(owner.rows[0]?.owner, "the SET ROLE bracket must have owned the tables").toBe(
      "bms_owner",
    );
  });
});
