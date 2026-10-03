import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.78` / ADR 0089 — what migration `0098` guarantees against a real
 * database (plan U1, I1-I19). `tests/f3.78-user-administration-schema.test.ts`
 * asserts the migration's text; this asserts what Postgres enforces.
 *
 * The `tests/f3.74-point-key-states-schema.integration.test.ts` lifecycle:
 * superuser pool, one held client, a `SAVEPOINT`-protected probe per refusal,
 * and every case inside a `BEGIN` … `ROLLBACK` that always rolls back — nothing
 * commits, and no seeded row is updated (a row lock would stall another
 * session's sign-in). Each case inserts its own user.
 *
 * `42501` is both "permission denied" and "row-level security", so every
 * refusal asserts the message as well as the code; a constraint refusal
 * asserts the constraint by name.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.78",
  label: "user administration schema tests",
  because:
    "the admin/organization CHECK, the case-insensitive email index, the subject index, the subject " +
    "trigger, the column INSERT grant and the grant-table policies are things Postgres enforces, so a " +
    "green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Result = { rows: Array<Record<string, unknown>>; rowCount: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Result>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Result>;
  release: () => void;
};
type Refusal = { code?: string; constraint?: string; message: string };

const TRIGGER_MESSAGE = "bms.users.oidc_subject is fixed once set (ADR 0089 decision 4)";

describe.skipIf(!has)("F3.78 — migration 0098 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let eskomLocation = "";
  let eskomGroup = "";
  let wcAdminId = "";
  let wcHvacAdminId = "";
  let seq = 0;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.78",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    // By code: a shared database can carry leaked fixture organizations.
    const orgs = await client.query(`SELECT code, id FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F3.78: needs the ESKOM and PHEWB organizations — run pnpm db:seed.");

    const users = await client.query(
      `SELECT email, id FROM bms.users WHERE email IN ('wc-admin@bms.local', 'wc-hvac-admin@bms.local')`,
    );
    wcAdminId = users.rows.find((r) => r.email === "wc-admin@bms.local")?.id as string;
    wcHvacAdminId = users.rows.find((r) => r.email === "wc-hvac-admin@bms.local")?.id as string;
    if (!wcAdminId || !wcHvacAdminId) {
      throw new Error("F3.78: needs the seeded wc-admin and wc-hvac-admin users — run pnpm db:seed.");
    }

    const loc = await client.query(
      `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`,
      [eskom],
    );
    eskomLocation = loc.rows[0]?.id as string;
    const group = await client.query(
      `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`,
      [eskom],
    );
    eskomGroup = group.rows[0]?.id as string;
    if (!eskomLocation || !eskomGroup) throw new Error("F3.78: needs an ESKOM location and asset group — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const email = (label: string): string => `f378-${label}-${RUN}-${++seq}@bms.local`;

  /** A transaction that is always rolled back, as the connection's superuser. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const asRole = async (run: Run, role: "bms_owner" | "bms_tenant" | "bms_auth", org?: string): Promise<void> => {
    await run(`SET LOCAL ROLE ${role}`);
    if (org !== undefined) await run(`SELECT set_config('app.current_organization', $1, true)`, [org]);
  };

  const probe = async (run: Run, sql: string, params: unknown[] = []): Promise<Refusal> => {
    await run("SAVEPOINT probe");
    const out: Refusal = { message: "" };
    try {
      await run(sql, params);
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      out.code = e.code;
      out.constraint = e.constraint;
      out.message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return out;
  };

  /** A user inserted as the superuser, returning its id. */
  const superInsertUser = async (
    run: Run,
    opts: { email: string; role: string; org: string | null; subject?: string | null },
  ): Promise<string> => {
    const { rows } = await run(
      `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id, oidc_subject)
       VALUES ($1, 'x', 'F3.78 schema probe', $2, $3, $4) RETURNING id`,
      [opts.email, opts.role, opts.org, opts.subject ?? null],
    );
    return rows[0]?.id as string;
  };

  const SUPER_INSERT = `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
                        VALUES ($1, 'x', 'F3.78 schema probe', $2, $3)`;

  describe("the admin/organization CHECK, as the superuser", () => {
    it("I1 refuses a viewer with organization_id NULL (users_role_organization_check)", async () => {
      await inTx(async (run) => {
        const r = await probe(run, SUPER_INSERT, [email("i1"), "viewer", null]);
        expect(r.code).toBe("23514");
        expect(r.constraint).toBe("users_role_organization_check");
      });
    });

    it("I2 refuses an admin with an organization (users_role_organization_check)", async () => {
      await inTx(async (run) => {
        const r = await probe(run, SUPER_INSERT, [email("i2"), "admin", eskom]);
        expect(r.code).toBe("23514");
        expect(r.constraint).toBe("users_role_organization_check");
      });
    });
  });

  describe("the unique indexes, as the superuser", () => {
    it("I3 refuses Admin@BMS.local beside admin@bms.local (users_email_lower_uidx)", async () => {
      await inTx(async (run) => {
        const base = email("i3");
        await superInsertUser(run, { email: base, role: "viewer", org: eskom });
        const r = await probe(run, SUPER_INSERT, [base.toUpperCase(), "viewer", eskom]);
        expect(r.code).toBe("23505");
        expect(r.constraint).toBe("users_email_lower_uidx");
      });
    });

    it("I4 refuses two rows with one oidc_subject (users_oidc_subject_uidx)", async () => {
      await inTx(async (run) => {
        const subject = `f378-sub-${RUN}`;
        await superInsertUser(run, { email: email("i4a"), role: "viewer", org: eskom, subject });
        const r = await probe(
          run,
          `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id, oidc_subject)
           VALUES ($1, 'x', 'F3.78 schema probe', 'viewer', $2, $3)`,
          [email("i4b"), eskom, subject],
        );
        expect(r.code).toBe("23505");
        expect(r.constraint).toBe("users_oidc_subject_uidx");
      });
    });
  });

  describe("the subject link and its trigger", () => {
    it("I5 lets bms_auth link a NULL subject once (one row changes)", async () => {
      await inTx(async (run) => {
        const id = await superInsertUser(run, { email: email("i5"), role: "viewer", org: eskom });
        await asRole(run, "bms_auth");
        const res = await run(
          `UPDATE bms.users SET oidc_subject = $1 WHERE id = $2 AND oidc_subject IS NULL`,
          [`f378-link-${RUN}`, id],
        );
        expect(res.rowCount).toBe(1);
      });
    });

    it("I6 refuses bms_auth re-pointing a non-NULL subject, with the trigger's message", async () => {
      await inTx(async (run) => {
        const id = await superInsertUser(run, { email: email("i6"), role: "viewer", org: eskom, subject: `f378-a-${RUN}` });
        await asRole(run, "bms_auth");
        const r = await probe(run, `UPDATE bms.users SET oidc_subject = $1 WHERE id = $2`, [`f378-b-${RUN}`, id]);
        expect(r.code).toBe("23000");
        expect(r.message).toContain(TRIGGER_MESSAGE);
      });
    });

    it("I7 lets the superuser (no SET ROLE) re-point a non-NULL subject", async () => {
      await inTx(async (run) => {
        const id = await superInsertUser(run, { email: email("i7"), role: "viewer", org: eskom, subject: `f378-c-${RUN}` });
        const res = await run(`UPDATE bms.users SET oidc_subject = $1 WHERE id = $2`, [`f378-d-${RUN}`, id]);
        expect(res.rowCount).toBe(1);
      });
    });
  });

  describe("bms.user_location_access is FORCE-policied by its location's organization", () => {
    it("I8 shows bms_owner with no GUC zero rows while the superuser sees some", async () => {
      await inTx(async (run) => {
        const asSuper = await run(`SELECT count(*)::int AS n FROM bms.user_location_access`);
        expect(asSuper.rows[0]?.n as number).toBeGreaterThan(0);
        await asRole(run, "bms_owner");
        const asOwner = await run(`SELECT count(*)::int AS n FROM bms.user_location_access`);
        expect(asOwner.rows[0]?.n).toBe(0);
      });
    });

    it("I9 shows bms_owner under GUC = ESKOM the wc-admin row", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_owner", eskom);
        const res = await run(`SELECT count(*)::int AS n FROM bms.user_location_access WHERE user_id = $1`, [wcAdminId]);
        expect(res.rows[0]?.n).toBe(1);
      });
    });

    it("I10 refuses, under GUC = PHEWB, a row for an ESKOM location (42501, row-level security)", async () => {
      await inTx(async (run) => {
        const id = await superInsertUser(run, { email: email("i10"), role: "viewer", org: eskom });
        const INSERT = `INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`;
        await asRole(run, "bms_owner", phewb);
        const refused = await probe(run, INSERT, [id, eskomLocation]);
        expect(refused.code).toBe("42501");
        expect(refused.message).toMatch(/row-level security/);
        // Positive control: the same insert under its own organization is accepted.
        await run(`SELECT set_config('app.current_organization', $1, true)`, [eskom]);
        const ok = await probe(run, INSERT, [id, eskomLocation]);
        expect(ok.message).toBe("");
      });
    });
  });

  describe("bms.user_asset_group_access is FORCE-policied by its group's organization", () => {
    it("I11 shows bms_owner with no GUC zero rows while the superuser sees some", async () => {
      await inTx(async (run) => {
        const asSuper = await run(`SELECT count(*)::int AS n FROM bms.user_asset_group_access`);
        expect(asSuper.rows[0]?.n as number).toBeGreaterThan(0);
        await asRole(run, "bms_owner");
        const asOwner = await run(`SELECT count(*)::int AS n FROM bms.user_asset_group_access`);
        expect(asOwner.rows[0]?.n).toBe(0);
      });
    });

    it("I12 shows bms_owner under GUC = ESKOM the wc-hvac-admin row", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_owner", eskom);
        const res = await run(`SELECT count(*)::int AS n FROM bms.user_asset_group_access WHERE user_id = $1`, [
          wcHvacAdminId,
        ]);
        expect(res.rows[0]?.n).toBe(1);
      });
    });

    it("I13 refuses, under GUC = PHEWB, a row for an ESKOM asset group (42501, row-level security)", async () => {
      await inTx(async (run) => {
        const id = await superInsertUser(run, { email: email("i13"), role: "viewer", org: eskom });
        const INSERT = `INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)`;
        await asRole(run, "bms_owner", phewb);
        const refused = await probe(run, INSERT, [id, eskomGroup]);
        expect(refused.code).toBe("42501");
        expect(refused.message).toMatch(/row-level security/);
        await run(`SELECT set_config('app.current_organization', $1, true)`, [eskom]);
        const ok = await probe(run, INSERT, [id, eskomGroup]);
        expect(ok.message).toBe("");
      });
    });
  });

  describe("bms_tenant creates a user through the column INSERT grant, bounded by the policy and the CHECK", () => {
    const TENANT_INSERT = `INSERT INTO bms.users (email, display_name, role, organization_id)
                           VALUES ($1, 'F3.78 tenant probe', $2, $3)`;

    it("I14 lets bms_tenant under GUC = ESKOM insert an ESKOM viewer with no password_hash", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_tenant", eskom);
        const r = await probe(run, TENANT_INSERT, [email("i14"), "viewer", eskom]);
        expect(r.message, "the positive control for I15-I19 must be accepted").toBe("");
      });
    });

    it("I15 refuses the same insert carrying password_hash (permission denied)", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_tenant", eskom);
        const r = await probe(
          run,
          `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
           VALUES ($1, 'x', 'F3.78 tenant probe', 'viewer', $2)`,
          [email("i15"), eskom],
        );
        expect(r.code).toBe("42501");
        expect(r.message).toMatch(/permission denied for table users/);
      });
    });

    it("I16 refuses bms_tenant a global admin (organization_id NULL) by row-level security", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_tenant", eskom);
        const r = await probe(run, TENANT_INSERT, [email("i16"), "admin", null]);
        expect(r.code).toBe("42501");
        expect(r.message).toMatch(/row-level security/);
      });
    });

    it("I17 refuses bms_tenant promoting its own row to a global admin by row-level security", async () => {
      await inTx(async (run) => {
        const target = email("i17");
        await asRole(run, "bms_tenant", eskom);
        await run(TENANT_INSERT, [target, "viewer", eskom]);
        const r = await probe(run, `UPDATE bms.users SET role = 'admin', organization_id = NULL WHERE email = $1`, [
          target,
        ]);
        expect(r.code).toBe("42501");
        expect(r.message).toMatch(/row-level security/);
      });
    });

    it("I18 refuses bms_tenant under GUC = ESKOM a PHEWB viewer by row-level security", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_tenant", eskom);
        const r = await probe(run, TENANT_INSERT, [email("i18"), "viewer", phewb]);
        expect(r.code).toBe("42501");
        expect(r.message).toMatch(/row-level security/);
      });
    });

    it("I19 refuses bms_tenant an admin carrying ESKOM (users_role_organization_check)", async () => {
      await inTx(async (run) => {
        await asRole(run, "bms_tenant", eskom);
        const r = await probe(run, TENANT_INSERT, [email("i19"), "admin", eskom]);
        expect(r.code).toBe("23514");
        expect(r.constraint).toBe("users_role_organization_check");
      });
    });
  });
});
